import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { allocateDesignModelSku } from '@/app/lib/design-model-sku';
import { hasServiceAccess } from '@/app/lib/service-access';
import { incrementSallaStock } from '@/app/lib/salla-stock';

const FABRIC_SERVICE: Array<'fabric-management' | 'fabric-warehouse'> = ['fabric-management', 'fabric-warehouse'];
const YARD_TO_METER = 0.9144;
const MAX_IMAGE_DATA_LENGTH = 3_000_000; // ~2.2MB base64 string

class BadRequestError extends Error {
  status = 400;
}

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toPositiveDecimal(value: unknown, field: string) {
  const numberValue = toNumber(value, NaN);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${field} يجب أن يكون أكبر من صفر`);
  }
  return new Prisma.Decimal(numberValue);
}

function toDecimal(value: unknown, fallback = 0) {
  return new Prisma.Decimal(toNumber(value, fallback));
}

function lengthToMeters(value: unknown, unit: unknown, field: string) {
  const length = toPositiveDecimal(value, field);
  return unit === 'yard' ? length.mul(YARD_TO_METER) : length;
}

function costToPerMeter(value: unknown, unit: unknown) {
  const cost = toDecimal(value);
  if (unit === 'yard') {
    return cost.div(YARD_TO_METER);
  }
  return cost;
}

function normalizeSupplier(value: unknown) {
  // Suppliers are now managed in the Supplier table and chosen from the picker,
  // so we store the supplier name as-is instead of validating against a fixed list.
  const supplier = typeof value === 'string' ? value.trim() : '';
  return supplier || null;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAuditUser(session: any) {
  return (
    session?.user?.username ||
    session?.user?.name ||
    session?.user?.email ||
    session?.user?.id ||
    'admin'
  );
}

function serializeIssue(issue: any) {
  const issued = toNumber(issue.issuedLength);
  const consumed = toNumber(issue.consumedLength);
  const returned = toNumber(issue.returnedLength);
  const unitCost = toNumber(issue.unitCostAtIssue);
  const tailoringCost = toNumber(issue.tailoringCost);
  const embroideryCost = toNumber(issue.embroideryCost);
  const extraCost = toNumber(issue.extraCost);
  const dressCount = Number(issue.deliveredDressCount || 0);
  const remainingAtTailor = Math.max(issued - consumed - returned, 0);
  const totalDressCost = consumed * unitCost + tailoringCost + embroideryCost + extraCost;

  return {
    ...issue,
    issuedLength: issued,
    unitCostAtIssue: unitCost,
    consumedLength: consumed,
    returnedLength: returned,
    tailoringCost,
    embroideryCost,
    extraCost,
    remainingAtTailor,
    totalDressCost,
    costPerDress: dressCount > 0 ? totalDressCost / dressCount : null,
    fabric: issue.fabric
      ? {
          ...issue.fabric,
          unitCost: toNumber(issue.fabric.unitCost),
          stockLength: toNumber(issue.fabric.stockLength),
          minStock: toNumber(issue.fabric.minStock),
        }
      : undefined,
  };
}

function serializeFabric(fabric: any) {
  const stockLength = toNumber(fabric.stockLength);
  const minStock = toNumber(fabric.minStock);
  return {
    ...fabric,
    unitCost: toNumber(fabric.unitCost),
    stockLength,
    minStock,
    isLowStock: stockLength <= minStock,
  };
}

function serializeAccessory(accessory: any) {
  const stockQty = toNumber(accessory.stockQty);
  const minStock = toNumber(accessory.minStock);
  return {
    ...accessory,
    unitPrice: toNumber(accessory.unitPrice),
    stockQty,
    minStock,
    isLowStock: stockQty <= minStock,
  };
}

function serializeSupplier(supplier: any) {
  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    contactPerson: supplier.contactPerson,
    address: supplier.address,
    notes: supplier.notes,
  };
}

function serializePurchaseInvoice(invoice: any) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    documentType: invoice.documentType,
    supplier: invoice.supplier,
    purchaseDate: invoice.purchaseDate,
    currency: invoice.currency,
    subtotalExclVat: toNumber(invoice.subtotalExclVat),
    vatAmount: toNumber(invoice.vatAmount),
    totalInclVat: toNumber(invoice.totalInclVat),
    sourceFile: invoice.sourceFile,
    notes: invoice.notes,
    items: Array.isArray(invoice.items)
      ? invoice.items.map((item: any) => ({
          id: item.id,
          itemType: item.itemType,
          fabricId: item.fabricId,
          accessoryId: item.accessoryId,
          productName: item.productName,
          productNumber: item.productNumber,
          unit: item.unit,
          quantity: toNumber(item.quantity),
          unitCost: toNumber(item.unitCost),
          vatRate: toNumber(item.vatRate),
          lineTotalExclVat: toNumber(item.lineTotalExclVat),
          vatAmount: toNumber(item.vatAmount),
          lineTotalInclVat: toNumber(item.lineTotalInclVat),
          extractionConfidence: item.extractionConfidence,
          notes: item.notes,
        }))
      : [],
  };
}

type AuditChange = { field: string; oldValue: unknown; newValue: unknown };

function normalizeAuditValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function writeAudit(
  client: Prisma.TransactionClient | typeof prisma,
  entityType: 'fabric' | 'accessory' | 'model',
  entityId: string,
  changes: AuditChange[],
  changedBy: string
) {
  const rows = changes
    .map((change) => ({
      field: change.field,
      oldValue: normalizeAuditValue(change.oldValue),
      newValue: normalizeAuditValue(change.newValue),
    }))
    .filter((row) => row.oldValue !== row.newValue)
    .map((row) => ({ entityType, entityId, changedBy, ...row }));

  if (rows.length) {
    await client.inventoryAuditLog.createMany({ data: rows });
  }
}

type RecipeRow = { role?: string; fabricId?: string; consumption?: unknown };
type AccessoryRecipeRow = { accessoryId?: string; consumption?: unknown; name?: unknown; cost?: unknown };

function consumptionToMeters(value: unknown, unit: string) {
  return toNumber(value) * (unit === 'yard' ? YARD_TO_METER : 1);
}

type ModelMetrics = { inProgressCount: number; reservedLength: number };

// Parse a model's accessory recipe into the new {accessoryId, consumption} shape.
// Tolerates the legacy {name, cost} shape by passing it through unchanged.
function parseAccessoryRecipe(raw: unknown) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map((row: any) => {
      const accessoryId = typeof row?.accessoryId === 'string' ? row.accessoryId.trim() : '';
      if (accessoryId) {
        return { accessoryId, consumption: toNumber(row?.consumption, 0) };
      }
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      return name ? { name, cost: toNumber(row?.cost) } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row: any) => row.accessoryId || row.name);
}

// Load fabric + accessory lookup maps needed to serialize a single model.
async function loadRecipeMaps(recipe: any[], accessories: any[]) {
  const fabricIds = recipe.map((row: any) => String(row?.fabricId || '')).filter(Boolean);
  const accessoryIds = accessories.map((row: any) => String(row?.accessoryId || '')).filter(Boolean);

  const [usedFabrics, usedAccessories] = await Promise.all([
    fabricIds.length ? prisma.fabric.findMany({ where: { id: { in: fabricIds } } }) : Promise.resolve([]),
    accessoryIds.length ? prisma.accessory.findMany({ where: { id: { in: accessoryIds } } }) : Promise.resolve([]),
  ]);

  const fabricMap = new Map(
    usedFabrics.map((fabric) => [
      fabric.id,
      { name: fabric.name, unitCost: toNumber(fabric.unitCost), stockLength: toNumber(fabric.stockLength) },
    ])
  );
  const accessoryMap = new Map(
    usedAccessories.map((accessory) => [
      accessory.id,
      { name: accessory.name, unitPrice: toNumber(accessory.unitPrice), stockQty: toNumber(accessory.stockQty) },
    ])
  );
  return { fabricMap, accessoryMap };
}

function serializeModel(
  model: any,
  fabricMap: Map<string, { name?: string; unitCost: number; stockLength: number }>,
  accessoryMap: Map<string, { name?: string; unitPrice: number; stockQty: number }>,
  metrics: ModelMetrics,
  autoCosts?: { tailoringCost: number; embroideryCost: number },
  tailors?: string[]
) {
  const unit = model.unit || 'meter';
  const recipe: RecipeRow[] = Array.isArray(model.recipe) ? model.recipe : [];
  const accessories: AccessoryRecipeRow[] = Array.isArray(model.accessories) ? model.accessories : [];

  const usableRows = recipe
    .map((row) => {
      const fabric = fabricMap.get(String(row.fabricId || ''));
      const consumptionMeters = consumptionToMeters(row.consumption, unit);
      return { row, fabric, consumptionMeters };
    })
    .filter((entry) => entry.fabric && entry.consumptionMeters > 0);

  const fabricCost = usableRows.reduce(
    (sum, entry) => sum + entry.consumptionMeters * (entry.fabric?.unitCost || 0),
    0
  );

  // Accessories support both the new {accessoryId, consumption} shape (real stock)
  // and the legacy {name, cost} shape (free text) for backward compatibility.
  const accessoriesResolved = accessories.map((row) => {
    const accessoryId = String(row.accessoryId || '');
    if (accessoryId) {
      const accessory = accessoryMap.get(accessoryId);
      const consumption = toNumber(row.consumption);
      const unitPrice = accessory?.unitPrice || 0;
      return {
        id: accessoryId,
        accessoryId,
        name: accessory?.name || '',
        consumption: String(row.consumption ?? ''),
        unitPrice,
        cost: consumption * unitPrice,
      };
    }
    // legacy free-text accessory
    return {
      id: Math.random().toString(36).slice(2),
      accessoryId: '',
      name: typeof row.name === 'string' ? row.name : '',
      consumption: '',
      unitPrice: null as number | null,
      cost: toNumber(row.cost),
    };
  });

  const accessoriesCost = accessoriesResolved.reduce((sum, row) => sum + row.cost, 0);
  // Tailoring & embroidery costs are auto-derived from the production cycle
  // (weighted per-dress average of the model's deliveries) when available.
  const tailoringCost = autoCosts ? autoCosts.tailoringCost : toNumber(model.tailoringCost);
  const embroideryCost = autoCosts ? autoCosts.embroideryCost : toNumber(model.embroideryCost);
  const extraCost = toNumber(model.extraCost);
  const totalCost = fabricCost + accessoriesCost + tailoringCost + embroideryCost + extraCost;

  const fabricLimits = usableRows.map((entry) =>
    Math.floor((entry.fabric?.stockLength || 0) / entry.consumptionMeters)
  );
  const accessoryLimits = accessoriesResolved
    .filter((row) => row.accessoryId && toNumber(row.consumption) > 0)
    .map((row) => {
      const accessory = accessoryMap.get(row.accessoryId);
      return accessory ? Math.floor(accessory.stockQty / toNumber(row.consumption)) : 0;
    });
  const limits = [...fabricLimits, ...accessoryLimits];
  const producible = limits.length ? Math.min(...limits) : 0;

  return {
    id: model.id,
    sku: model.sku,
    status: model.status,
    description: model.description || '',
    size: model.size || '',
    unit,
    colors: Array.isArray(model.colors) ? model.colors : [],
    imageData: model.imageData || null,
    sallaProductId: model.sallaProductId ?? null,
    sallaProductName: model.sallaProductName ?? null,
    sallaVariantId: model.sallaVariantId ?? null,
    sallaVariantName: model.sallaVariantName ?? null,
    sallaSku: model.sallaSku ?? null,
    fabrics: recipe.map((row) => ({
      id: String(row.fabricId || '') || Math.random().toString(36).slice(2),
      role: row.role || 'main',
      fabricId: String(row.fabricId || ''),
      consumption: String(row.consumption ?? ''),
    })),
    accessories: accessoriesResolved,
    tailors: tailors || [],
    tailoringCost,
    embroideryCost,
    extraCost,
    fabricCost,
    accessoriesCost,
    totalCost,
    producibleCount: Number.isFinite(producible) ? Math.max(producible, 0) : 0,
    producedCount: Number(model.producedCount || 0),
    inProgressCount: metrics.inProgressCount,
    reservedLength: metrics.reservedLength,
  };
}

function serializeRequest(request: any) {
  return {
    ...request,
    requestedLength: toNumber(request.requestedLength),
    purchaseUnitCost: request.purchaseUnitCost === null || request.purchaseUnitCost === undefined
      ? null
      : toNumber(request.purchaseUnitCost),
    fabric: request.fabric ? serializeFabric(request.fabric) : undefined,
  };
}

function serializeDeliveryNote(note: any) {
  return {
    ...note,
    dressCount: Number(note.dressCount || 0),
    tailoringCost: toNumber(note.tailoringCost),
    embroideryCost: toNumber(note.embroideryCost),
    extraCost: toNumber(note.extraCost),
    tailor: note.tailor ? { id: note.tailor.id, name: note.tailor.name, workshopName: note.tailor.workshopName } : undefined,
    designModel: note.designModel ? { id: note.designModel.id, sku: note.designModel.sku } : undefined,
  };
}

// Sum of signed ledger movements for a fabric at a location (WAREHOUSE, or a specific tailor).
// Legacy pre-migration rows (quantityDelta null) are excluded - they're read via the old
// open-issue math (`status !== 'closed'` + remainingAtTailor) in the GET summary instead.
async function getLedgerBalance(
  client: Prisma.TransactionClient | typeof prisma,
  fabricId: string,
  location: 'WAREHOUSE' | 'TAILOR',
  tailorId?: string | null
) {
  const agg = await client.tailorFabricIssue.aggregate({
    where: {
      fabricId,
      location,
      quantityDelta: { not: null },
      ...(location === 'TAILOR' ? { tailorId: tailorId || undefined } : {}),
    },
    _sum: { quantityDelta: true },
  });
  return toNumber(agg._sum.quantityDelta, 0);
}

// How much of a fabric's grand total is currently sitting at the main warehouse (not
// issued to any tailor). Grand total minus everything currently attributed to a tailor,
// whether via an open legacy issue (pre-migration) or a new-style ledger entry.
async function getWarehouseAvailable(client: Prisma.TransactionClient | typeof prisma, fabricId: string) {
  const [fabric, legacyOpenAgg, tailorLedgerBalance] = await Promise.all([
    client.fabric.findUnique({ where: { id: fabricId } }),
    client.tailorFabricIssue.aggregate({
      where: { fabricId, movementType: 'LEGACY_ISSUE', status: { not: 'closed' } },
      _sum: { issuedLength: true, consumedLength: true, returnedLength: true },
    }),
    getLedgerBalance(client, fabricId, 'TAILOR'),
  ]);
  if (!fabric) return 0;
  const legacyRemaining =
    toNumber(legacyOpenAgg._sum.issuedLength, 0) -
    toNumber(legacyOpenAgg._sum.consumedLength, 0) -
    toNumber(legacyOpenAgg._sum.returnedLength, 0);
  return toNumber(fabric.stockLength, 0) - legacyRemaining - tailorLedgerBalance;
}

// Expand a design model's bill of materials into the per-batch components snapshot
// stored on a delivery note (recipe fabrics + accessories × dress count).
async function buildDeliverySnapshot(model: any, dressCount: number) {
  const unit = model.unit || 'meter';
  const recipe: RecipeRow[] = Array.isArray(model.recipe) ? (model.recipe as any[]) : [];
  const accessoriesRecipe = parseAccessoryRecipe(model.accessories);
  const fabricIds = recipe.map((row) => String(row.fabricId || '')).filter(Boolean);
  const fabricsUsed = await prisma.fabric.findMany({ where: { id: { in: fabricIds } } });
  const fabricLookup = new Map(fabricsUsed.map((f) => [f.id, f]));
  const accessoryIds = (accessoriesRecipe as any[]).map((row) => row.accessoryId).filter(Boolean);
  const accessoriesUsed = await prisma.accessory.findMany({ where: { id: { in: accessoryIds } } });
  const accessoryLookup = new Map(accessoriesUsed.map((a) => [a.id, a]));

  const fabrics = recipe
    .map((row) => {
      const fabricId = String(row.fabricId || '');
      const fabric = fabricLookup.get(fabricId);
      const consumption = toNumber(row.consumption);
      const meters = consumptionToMeters(row.consumption, unit) * dressCount;
      if (!fabric || meters <= 0) return null;
      return {
        fabricId,
        name: fabric.name,
        consumption,
        meters,
        unitCost: toNumber(fabric.unitCost),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const accessories = (accessoriesRecipe as any[])
    .map((row) => {
      if (!row.accessoryId) return null;
      const accessory = accessoryLookup.get(row.accessoryId);
      const qty = toNumber(row.consumption) * dressCount;
      if (!accessory || qty <= 0) return null;
      return { accessoryId: row.accessoryId, name: accessory.name, qty, unitPrice: toNumber(accessory.unitPrice) };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return { fabrics, accessories };
}

async function requireWarehouseRole(session: any) {
  if (session?.user?.role === 'admin') return true;
  const roles: string[] = Array.isArray(session?.user?.roles) ? session.user.roles : [];
  return roles.includes('warehouse');
}

async function requireAccess() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى إدارة الأقمشة' },
        { status: 401 }
      ),
    };
  }

  // Manufacturer accounts are tailors: they always get the self-scoped tailor
  // surface (own requests / delivery notes), never the management one — even if
  // they also happen to hold fabric service keys.
  const isTailor =
    (session.user as any)?.userType === 'manufacturer' && (session.user as any)?.role !== 'admin';
  if (isTailor) {
    return { session, isTailor: true };
  }

  if (!hasServiceAccess(session, FABRIC_SERVICE)) {
    return {
      error: NextResponse.json(
        { error: 'لا تملك صلاحية لإدارة الأقمشة' },
        { status: 403 }
      ),
    };
  }

  return { session, isTailor: false };
}

// The Tailor row is still the FK anchor for the whole fabric ledger; manufacturer
// accounts get one lazily, bound via the unique orderUserId link.
async function resolveTailorForUser(session: any) {
  const userId = String(session?.user?.id || '');
  if (!userId) throw new Error('تعذر تحديد حساب الخياط');
  return prisma.tailor.upsert({
    where: { orderUserId: userId },
    update: {},
    create: {
      name: session?.user?.name || session?.user?.username || 'خياط',
      isActive: true,
      orderUserId: userId,
    },
  });
}

export async function GET() {
  try {
    const access = await requireAccess();
    if (access.error) return access.error;

    // Tailor-scoped payload: same response shape, but only the tailor's own
    // requests, delivery notes and purchase invoices. Fabrics/accessories/models
    // come through whole because his invoice form and dress-model builder need
    // them; other tailors' data and the movement ledger stay hidden.
    if (access.isTailor) {
      const tailor = await resolveTailorForUser(access.session);
      const [fabrics, accessories, suppliers, models, requests, deliveryNotes, purchaseInvoices, ledgerAgg, legacyOpenIssues] =
        await Promise.all([
          prisma.fabric.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
          prisma.accessory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
          prisma.supplier
            .findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })
            .catch(() => [] as Awaited<ReturnType<typeof prisma.supplier.findMany>>),
          prisma.designModel.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
          prisma.tailorFabricRequest.findMany({
            where: { tailorId: tailor.id },
            include: { fabric: true, tailor: true },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          prisma.deliveryNote.findMany({
            where: { tailorId: tailor.id },
            include: { tailor: true, designModel: true },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          prisma.purchaseInvoice
            .findMany({ where: { tailorId: tailor.id }, include: { items: true }, orderBy: { purchaseDate: 'desc' }, take: 200 })
            .catch(() => [] as Awaited<ReturnType<typeof prisma.purchaseInvoice.findMany>>),
          prisma.tailorFabricIssue.groupBy({
            by: ['fabricId'],
            where: { tailorId: tailor.id, location: 'TAILOR', quantityDelta: { not: null } },
            _sum: { quantityDelta: true },
          }),
          prisma.tailorFabricIssue.findMany({
            where: { tailorId: tailor.id, movementType: 'LEGACY_ISSUE', status: { not: 'closed' } },
          }),
        ]);

      const balanceByFabric = new Map<string, number>();
      for (const row of ledgerAgg) {
        balanceByFabric.set(row.fabricId, toNumber(row._sum.quantityDelta, 0));
      }
      for (const issue of legacyOpenIssues) {
        const remaining =
          toNumber(issue.issuedLength) - toNumber(issue.consumedLength) - toNumber(issue.returnedLength);
        balanceByFabric.set(issue.fabricId, (balanceByFabric.get(issue.fabricId) || 0) + remaining);
      }
      const tailorFabricBalances = Array.from(balanceByFabric.entries())
        .map(([fabricId, heldMeters]) => ({ fabricId, tailorId: tailor.id, heldMeters }))
        .filter((row) => Math.abs(row.heldMeters) > 0.001);

      const fabricMap = new Map(
        fabrics.map((fabric) => [
          fabric.id,
          { name: fabric.name, unitCost: toNumber(fabric.unitCost), stockLength: toNumber(fabric.stockLength) },
        ])
      );
      const accessoryMap = new Map(
        accessories.map((accessory) => [
          accessory.id,
          { name: accessory.name, unitPrice: toNumber(accessory.unitPrice), stockQty: toNumber(accessory.stockQty) },
        ])
      );

      return NextResponse.json({
        fabrics: fabrics.map(serializeFabric),
        accessories: accessories.map(serializeAccessory),
        issues: [],
        requests: requests.map(serializeRequest),
        models: models.map((model) =>
          serializeModel(
            model,
            fabricMap,
            accessoryMap,
            { inProgressCount: 0, reservedLength: 0 },
            { tailoringCost: 0, embroideryCost: 0 },
            []
          )
        ),
        suppliers: suppliers.map(serializeSupplier),
        purchaseInvoices: purchaseInvoices.map(serializePurchaseInvoice),
        deliveryNotes: deliveryNotes.map(serializeDeliveryNote),
        tailorFabricBalances,
        summary: {
          fabricsCount: 0,
          accessoriesCount: 0,
          stockMeters: 0,
          withTailorsMeters: 0,
          pendingRequestsCount: requests.filter((request) => request.status === 'pending').length,
          modelsCount: models.length,
          purchaseInvoicesCount: purchaseInvoices.length,
          lowStockFabricsCount: 0,
          lowStockAccessoriesCount: 0,
        },
      });
    }

    const [fabrics, accessories, issues, requests, models] = await Promise.all([
      prisma.fabric.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      prisma.accessory.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      prisma.tailorFabricIssue.findMany({
        include: { fabric: true, tailor: true },
        orderBy: { issueDate: 'desc' },
        take: 100,
      }),
      prisma.tailorFabricRequest.findMany({
        include: { fabric: true, tailor: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.designModel.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);

    // Defensive: keep the inventory page working even if the Supplier table or its
    // newer columns aren't migrated yet (run `prisma db push`). Falls back to empty.
    const suppliers = await prisma.supplier
      .findMany({ where: { isActive: true }, orderBy: { name: 'asc' } })
      .catch(() => [] as Awaited<ReturnType<typeof prisma.supplier.findMany>>);

    // Defensive: keep the page working even if PurchaseInvoice isn't migrated yet.
    const purchaseInvoices = await prisma.purchaseInvoice
      .findMany({ include: { items: true }, orderBy: { purchaseDate: 'desc' }, take: 200 })
      .catch(() => [] as Awaited<ReturnType<typeof prisma.purchaseInvoice.findMany>>);

    // Delivery notes: the tailor -> warehouse handoff queue + recent history.
    const deliveryNotes = await prisma.deliveryNote
      .findMany({
        include: { tailor: true, designModel: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      .catch(() => [] as Awaited<ReturnType<typeof prisma.deliveryNote.findMany>>);

    // Fabric location breakdown (grand total split into "at warehouse" vs "at tailors"),
    // combining pre-migration legacy open issues with the new movement ledger.
    const [legacyOpenAgg, ledgerLocationAgg, ledgerTailorFabricAgg] = await Promise.all([
      prisma.tailorFabricIssue.groupBy({
        by: ['fabricId'],
        where: { movementType: 'LEGACY_ISSUE', status: { not: 'closed' } },
        _sum: { issuedLength: true, consumedLength: true, returnedLength: true },
      }),
      prisma.tailorFabricIssue.groupBy({
        by: ['fabricId', 'location'],
        where: { quantityDelta: { not: null } },
        _sum: { quantityDelta: true },
      }),
      prisma.tailorFabricIssue.groupBy({
        by: ['fabricId', 'tailorId'],
        where: { location: 'TAILOR', quantityDelta: { not: null }, tailorId: { not: null } },
        _sum: { quantityDelta: true },
      }),
    ]);
    const legacyRemainingByFabric = new Map<string, number>();
    for (const row of legacyOpenAgg) {
      legacyRemainingByFabric.set(
        row.fabricId,
        toNumber(row._sum.issuedLength, 0) - toNumber(row._sum.consumedLength, 0) - toNumber(row._sum.returnedLength, 0)
      );
    }
    const ledgerAtTailorsByFabric = new Map<string, number>();
    for (const row of ledgerLocationAgg) {
      if (row.location !== 'TAILOR') continue;
      ledgerAtTailorsByFabric.set(row.fabricId, toNumber(row._sum.quantityDelta, 0));
    }
    const tailorFabricBalanceMap = new Map<string, number>(); // key `${fabricId}|${tailorId}`
    for (const row of ledgerTailorFabricAgg) {
      if (!row.tailorId) continue;
      tailorFabricBalanceMap.set(`${row.fabricId}|${row.tailorId}`, toNumber(row._sum.quantityDelta, 0));
    }
    // Fold legacy open issues (still tracked per-tailor via the old status field) into the
    // same per-tailor balance map so the warehouse UI sees one consistent number.
    for (const issue of issues) {
      if (issue.movementType !== 'LEGACY_ISSUE' || issue.status === 'closed' || !issue.tailorId) continue;
      const remaining =
        toNumber(issue.issuedLength) - toNumber(issue.consumedLength) - toNumber(issue.returnedLength);
      const key = `${issue.fabricId}|${issue.tailorId}`;
      tailorFabricBalanceMap.set(key, (tailorFabricBalanceMap.get(key) || 0) + remaining);
    }

    function fabricLocationBreakdown(fabricId: string, grandTotal: number) {
      const atTailors = (legacyRemainingByFabric.get(fabricId) || 0) + (ledgerAtTailorsByFabric.get(fabricId) || 0);
      return { atWarehouse: grandTotal - atTailors, atTailors };
    }

    const tailorFabricBalances = Array.from(tailorFabricBalanceMap.entries())
      .map(([key, heldMeters]) => {
        const [fabricId, tailorId] = key.split('|');
        return { fabricId, tailorId, heldMeters };
      })
      .filter((row) => Math.abs(row.heldMeters) > 0.001);

    const serializedIssues = issues.map(serializeIssue);
    const stockMeters = fabrics.reduce((sum, fabric) => sum + toNumber(fabric.stockLength), 0);
    const withTailorsMeters = serializedIssues
      .filter((issue) => issue.status !== 'closed')
      .reduce((sum, issue) => sum + issue.remainingAtTailor, 0);

    const fabricMap = new Map(
      fabrics.map((fabric) => [
        fabric.id,
        { name: fabric.name, unitCost: toNumber(fabric.unitCost), stockLength: toNumber(fabric.stockLength) },
      ])
    );
    const accessoryMap = new Map(
      accessories.map((accessory) => [
        accessory.id,
        { name: accessory.name, unitPrice: toNumber(accessory.unitPrice), stockQty: toNumber(accessory.stockQty) },
      ])
    );

    // Per-model production metrics from open issues.
    const metricsByModel = new Map<string, ModelMetrics>();
    // Per-model linked tailors, derived from the model's fabric issues. Issues are
    // ordered most-recent-first, so the first time we see a tailor for a model it is
    // the latest one; open (non-closed) issues take priority over closed history.
    const tailorsByModel = new Map<string, { open: string[]; all: string[] }>();
    for (const issue of issues) {
      const modelId = issue.designModelId;
      const tailorName = issue.tailor?.name?.trim();
      if (!modelId || !tailorName) continue;
      const entry = tailorsByModel.get(modelId) || { open: [], all: [] };
      if (!entry.all.includes(tailorName)) entry.all.push(tailorName);
      if (issue.status !== 'closed' && !entry.open.includes(tailorName)) entry.open.push(tailorName);
      tailorsByModel.set(modelId, entry);
    }
    // Per-model cost aggregation from delivered issues. Production-cycle costs are
    // batch totals, so we accumulate totals + dress counts to get a weighted
    // per-dress average for the models tab.
    const costAggByModel = new Map<string, { tailoring: number; embroidery: number; dresses: number }>();
    for (const issue of serializedIssues) {
      const modelId = (issue as any).designModelId;
      if (!modelId) continue;
      if (issue.status !== 'closed') {
        const current = metricsByModel.get(modelId) || { inProgressCount: 0, reservedLength: 0 };
        current.inProgressCount += Number((issue as any).plannedDressCount || 0);
        current.reservedLength += issue.remainingAtTailor;
        metricsByModel.set(modelId, current);
      }
      const dresses = Number((issue as any).deliveredDressCount || 0);
      if (dresses > 0) {
        const agg = costAggByModel.get(modelId) || { tailoring: 0, embroidery: 0, dresses: 0 };
        agg.tailoring += issue.tailoringCost;
        agg.embroidery += (issue as any).embroideryCost || 0;
        agg.dresses += dresses;
        costAggByModel.set(modelId, agg);
      }
    }

    const autoCostByModel = new Map<string, { tailoringCost: number; embroideryCost: number }>();
    for (const [modelId, agg] of costAggByModel) {
      autoCostByModel.set(modelId, {
        tailoringCost: agg.dresses > 0 ? agg.tailoring / agg.dresses : 0,
        embroideryCost: agg.dresses > 0 ? agg.embroidery / agg.dresses : 0,
      });
    }

    const serializedModels = models.map((model) => {
      const linked = tailorsByModel.get(model.id);
      // Prefer tailors holding open issues; fall back to the full history.
      const modelTailors = linked ? (linked.open.length ? linked.open : linked.all) : [];
      return serializeModel(
        model,
        fabricMap,
        accessoryMap,
        metricsByModel.get(model.id) || { inProgressCount: 0, reservedLength: 0 },
        autoCostByModel.get(model.id) || { tailoringCost: 0, embroideryCost: 0 },
        modelTailors
      );
    });

    return NextResponse.json({
      fabrics: fabrics.map((fabric) => ({
        ...serializeFabric(fabric),
        ...fabricLocationBreakdown(fabric.id, toNumber(fabric.stockLength)),
      })),
      accessories: accessories.map(serializeAccessory),
      issues: serializedIssues,
      requests: requests.map(serializeRequest),
      models: serializedModels,
      suppliers: suppliers.map(serializeSupplier),
      purchaseInvoices: purchaseInvoices.map(serializePurchaseInvoice),
      deliveryNotes: deliveryNotes.map(serializeDeliveryNote),
      tailorFabricBalances,
      summary: {
        fabricsCount: fabrics.length,
        accessoriesCount: accessories.length,
        stockMeters,
        withTailorsMeters,
        pendingRequestsCount: requests.filter((request) => request.status === 'pending').length,
        modelsCount: models.length,
        purchaseInvoicesCount: purchaseInvoices.length,
        lowStockFabricsCount: fabrics.filter((f) => toNumber(f.stockLength) <= toNumber(f.minStock)).length,
        lowStockAccessoriesCount: accessories.filter((a) => toNumber(a.stockQty) <= toNumber(a.minStock)).length,
      },
    });
  } catch (error) {
    console.error('Error fetching fabric management data:', error);
    return NextResponse.json({ error: 'فشل في جلب بيانات الأقمشة' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAccess();
    if (access.error) return access.error;

    const body = await request.json();
    const action = body.action;

    // Tailor accounts can only create — their own requests, delivery notes,
    // purchase bills (recorded in their name) and dress models. They can never
    // approve/accept anything or edit existing stock.
    const TAILOR_ALLOWED_ACTIONS = [
      'create-tailor-request',
      'create-delivery-request',
      'create-purchase-bill',
      'create-model',
      'create-fabric',
      'create-supplier',
    ];
    if (access.isTailor && !TAILOR_ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'لا تملك صلاحية لهذا الإجراء' }, { status: 403 });
    }

    if (action === 'create-tailor-request') {
      if (!access.isTailor) {
        return NextResponse.json({ error: 'هذا الإجراء مخصص لحسابات الخياطين' }, { status: 403 });
      }
      const tailor = await resolveTailorForUser(access.session);
      const requestType = body.requestType === 'purchase' ? 'purchase' : 'stock_request';
      const requestedLength = lengthToMeters(body.requestedLength, body.lengthUnit, 'الكمية المطلوبة');

      let fabricId: string | null = null;
      if (requestType === 'stock_request') {
        fabricId = String(body.fabricId || '');
        if (!fabricId) {
          return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });
        }
        const fabric = await prisma.fabric.findUnique({ where: { id: fabricId } });
        if (!fabric) {
          return NextResponse.json({ error: 'القماش غير موجود' }, { status: 404 });
        }
      }

      const purchaseName = cleanText(body.purchaseName);
      if (requestType === 'purchase' && !purchaseName) {
        return NextResponse.json({ error: 'اسم القماش المطلوب شراؤه مطلوب' }, { status: 400 });
      }

      const created = await prisma.tailorFabricRequest.create({
        data: {
          tailorId: tailor.id,
          fabricId,
          requestType,
          requestedLength,
          purchaseName: requestType === 'purchase' ? purchaseName : null,
          purchaseSku: requestType === 'purchase' ? cleanText(body.purchaseSku) || null : null,
          purchaseColor: requestType === 'purchase' ? cleanText(body.purchaseColor) || null : null,
          purchaseFabricType: requestType === 'purchase' ? cleanText(body.purchaseFabricType) || null : null,
          purchaseSupplier: requestType === 'purchase' ? normalizeSupplier(body.purchaseSupplier) : null,
          purchaseUnitCost:
            requestType === 'purchase' && body.purchaseUnitCost !== undefined && body.purchaseUnitCost !== null && body.purchaseUnitCost !== ''
              ? costToPerMeter(body.purchaseUnitCost, body.lengthUnit)
              : null,
          status: 'pending',
          notes: cleanText(body.notes) || null,
        },
        include: { fabric: true, tailor: true },
      });

      return NextResponse.json(serializeRequest(created), { status: 201 });
    }

    if (action === 'create-delivery-request') {
      if (!access.isTailor) {
        return NextResponse.json({ error: 'هذا الإجراء مخصص لحسابات الخياطين' }, { status: 403 });
      }
      const tailor = await resolveTailorForUser(access.session);
      const designModelId = String(body.designModelId || '');
      const dressCount = Math.max(1, Math.trunc(toNumber(body.dressCount, 1)));
      if (!designModelId) {
        return NextResponse.json({ error: 'الموديل مطلوب' }, { status: 400 });
      }
      const model = await prisma.designModel.findUnique({ where: { id: designModelId } });
      if (!model) {
        return NextResponse.json({ error: 'الموديل غير موجود' }, { status: 404 });
      }

      const snapshot = await buildDeliverySnapshot(model, dressCount);
      for (const line of snapshot.fabrics) {
        const balance = await getLedgerBalance(prisma, line.fabricId, 'TAILOR', tailor.id);
        if (balance < line.meters) {
          return NextResponse.json(
            { error: `كمية القماش "${line.name}" المتوفرة لديك غير كافية لهذه الدفعة` },
            { status: 409 }
          );
        }
      }

      const note = await prisma.deliveryNote.create({
        data: {
          noteNumber: `DN-${Date.now().toString(36).toUpperCase()}`,
          tailorId: tailor.id,
          designModelId,
          dressCount,
          size: body.size ? String(body.size) : model.size,
          status: 'SUBMITTED',
          submittedAt: new Date(),
          tailoringCost: toDecimal(body.tailoringCost ?? model.tailoringCost),
          embroideryCost: toDecimal(body.embroideryCost ?? model.embroideryCost),
          extraCost: toDecimal(body.extraCost ?? model.extraCost),
          componentsConsumed: snapshot,
          notes: cleanText(body.notes) || null,
        },
        include: { tailor: true, designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(note), { status: 201 });
    }

    if (action === 'create-fabric') {
      if (!body.name) {
        return NextResponse.json({ error: 'اسم القماش مطلوب' }, { status: 400 });
      }

      const fabric = await prisma.fabric.create({
        data: {
          name: body.name,
          sku: body.sku || null,
          color: body.color || null,
          fabricType: body.fabricType || null,
          supplier: normalizeSupplier(body.supplier),
          unitCost: costToPerMeter(body.unitCost, body.lengthUnit),
          stockLength: body.stockLength ? lengthToMeters(body.stockLength, body.lengthUnit, 'الطول في المخزون') : toDecimal(0),
          minStock: body.minStock ? lengthToMeters(body.minStock, body.lengthUnit, 'حد التنبيه') : toDecimal(0),
          notes: body.notes || null,
        },
      });

      return NextResponse.json(serializeFabric(fabric), { status: 201 });
    }

    if (action === 'create-supplier') {
      const name = cleanText(body.name);
      if (!name) {
        return NextResponse.json({ error: 'اسم المورّد مطلوب' }, { status: 400 });
      }

      const actor = getAuditUser(access.session);
      const optionalFields = {
        phone: cleanText(body.phone) || null,
        email: cleanText(body.email) || null,
        contactPerson: cleanText(body.contactPerson) || null,
        address: cleanText(body.address) || null,
        notes: cleanText(body.notes) || null,
      };

      // Create-or-return: a case-insensitive match prevents near-duplicate suppliers.
      const existing = await prisma.supplier.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });

      if (existing) {
        const supplier = await prisma.supplier.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            updatedBy: actor,
            // Only fill blanks so re-selecting an existing supplier doesn't wipe its data.
            phone: existing.phone || optionalFields.phone,
            email: existing.email || optionalFields.email,
            contactPerson: existing.contactPerson || optionalFields.contactPerson,
            address: existing.address || optionalFields.address,
            notes: existing.notes || optionalFields.notes,
          },
        });
        return NextResponse.json(serializeSupplier(supplier), { status: 200 });
      }

      const supplier = await prisma.supplier.create({
        data: { name, ...optionalFields, createdBy: actor, updatedBy: actor },
      });

      return NextResponse.json(serializeSupplier(supplier), { status: 201 });
    }

    if (action === 'create-tailor') {
      if (!body.name || !body.accessCode) {
        return NextResponse.json({ error: 'اسم الخياط ورمز الدخول مطلوبان' }, { status: 400 });
      }

      const tailor = await prisma.tailor.create({
        data: {
          name: body.name,
          workshopName: body.workshopName || null,
          phone: body.phone || null,
          accessCode: body.accessCode,
          notes: body.notes || null,
        },
      });

      return NextResponse.json(tailor, { status: 201 });
    }

    if (action === 'create-purchase-bill') {
      const billNumber = cleanText(body.billNumber);
      const purchaseDate = cleanText(body.purchaseDate);
      const lengthUnit = body.lengthUnit === 'yard' ? 'yard' : 'meter';
      const supplier = normalizeSupplier(body.supplier);
      const items = Array.isArray(body.items) ? body.items : [];
      // A tailor's bill is always recorded in his own name: the fabric he bought
      // lands on his balance (TAILOR_PURCHASE), never in the warehouse.
      const selfTailor = access.isTailor ? await resolveTailorForUser(access.session) : null;
      const enteredLocation = selfTailor || body.enteredLocation === 'TAILOR' ? 'TAILOR' : 'WAREHOUSE';
      const tailorId = selfTailor ? selfTailor.id : enteredLocation === 'TAILOR' ? cleanText(body.tailorId) : '';

      if (!billNumber) {
        return NextResponse.json({ error: 'رقم فاتورة الشراء مطلوب' }, { status: 400 });
      }
      if (!purchaseDate || Number.isNaN(new Date(purchaseDate).getTime())) {
        return NextResponse.json({ error: 'تاريخ الشراء مطلوب' }, { status: 400 });
      }
      if (!items.length) {
        return NextResponse.json({ error: 'أضف قماشاً واحداً على الأقل للفاتورة' }, { status: 400 });
      }
      if (enteredLocation === 'TAILOR' && !tailorId) {
        return NextResponse.json({ error: 'الخياط مطلوب عند إدخال فاتورة باسمه' }, { status: 400 });
      }

      const result = await prisma.$transaction(async (tx) => {
        if (tailorId) {
          const tailor = await tx.tailor.findUnique({ where: { id: tailorId } });
          if (!tailor) throw new Error('الخياط غير موجود');
        }

        const existingInvoice = await tx.purchaseInvoice.findUnique({
          where: { invoiceNumber_supplier: { invoiceNumber: billNumber, supplier: supplier || '' } },
        });
        if (existingInvoice) {
          throw new Error(`رقم الفاتورة ${billNumber} مستخدم بالفعل لهذا المورّد`);
        }

        const savedFabrics: any[] = [];
        const itemRows: Array<{
          fabricId: string;
          quantity: Prisma.Decimal;
          unitCost: Prisma.Decimal;
          data: Prisma.PurchaseInvoiceItemCreateManyInvoiceInput;
        }> = [];
        let subtotalExclVat = new Prisma.Decimal(0);
        let vatTotal = new Prisma.Decimal(0);
        let totalInclVat = new Prisma.Decimal(0);

        for (const [index, item] of items.entries()) {
          const rowLabel = `سطر ${index + 1}`;
          const fabricId = cleanText(item?.fabricId);
          const name = cleanText(item?.name);
          const sku = cleanText(item?.sku);
          const purchasedLength = lengthToMeters(item?.purchasedLength, lengthUnit, `كمية ${rowLabel}`);
          const unitCost =
            item?.unitCost !== undefined && item?.unitCost !== ''
              ? costToPerMeter(item.unitCost, lengthUnit)
              : new Prisma.Decimal(0);
          const minStock =
            item?.minStock !== undefined && item?.minStock !== ''
              ? lengthToMeters(item.minStock, lengthUnit, `حد التنبيه في ${rowLabel}`)
              : null;
          const vatRate =
            item?.vatRate !== undefined && item?.vatRate !== ''
              ? new Prisma.Decimal(toNumber(item.vatRate))
              : new Prisma.Decimal(0.15);

          const existingFabric = fabricId
            ? await tx.fabric.findUnique({ where: { id: fabricId } })
            : sku
              ? await tx.fabric.findUnique({ where: { sku } })
              : null;

          if (fabricId && !existingFabric) {
            throw new Error(`القماش المحدد في ${rowLabel} غير موجود`);
          }

          let fabric;
          if (existingFabric) {
            fabric = await tx.fabric.update({
              where: { id: existingFabric.id },
              data: {
                stockLength: { increment: purchasedLength },
                supplier: supplier || existingFabric.supplier,
                color: cleanText(item?.color) || existingFabric.color,
                unitCost: unitCost.greaterThan(0) ? unitCost : existingFabric.unitCost,
                minStock: minStock || existingFabric.minStock,
              },
            });
          } else {
            if (!name) throw new Error(`اسم القماش مطلوب في ${rowLabel}`);
            fabric = await tx.fabric.create({
              data: {
                name,
                sku: sku || null,
                color: cleanText(item?.color) || null,
                supplier,
                unitCost,
                stockLength: purchasedLength,
                minStock: minStock || toDecimal(0),
              },
            });
          }
          savedFabrics.push(fabric);

          const lineTotalExclVat = purchasedLength.mul(unitCost);
          const vatAmount = lineTotalExclVat.mul(vatRate);
          const lineTotalInclVat = lineTotalExclVat.plus(vatAmount);
          subtotalExclVat = subtotalExclVat.plus(lineTotalExclVat);
          vatTotal = vatTotal.plus(vatAmount);
          totalInclVat = totalInclVat.plus(lineTotalInclVat);

          itemRows.push({
            fabricId: fabric.id,
            quantity: purchasedLength,
            unitCost,
            data: {
              itemType: 'fabric',
              fabricId: fabric.id,
              productName: fabric.name,
              productNumber: fabric.sku,
              unit: 'meter',
              quantity: purchasedLength,
              unitCost,
              vatRate,
              lineTotalExclVat,
              vatAmount,
              lineTotalInclVat,
              notes: cleanText(item?.notes) || null,
            },
          });
        }

        const invoice = await tx.purchaseInvoice.create({
          data: {
            invoiceNumber: billNumber,
            supplier,
            purchaseDate: new Date(purchaseDate),
            subtotalExclVat,
            vatAmount: vatTotal,
            totalInclVat,
            notes: cleanText(body.notes) || null,
            enteredLocation,
            tailorId: tailorId || null,
            items: { createMany: { data: itemRows.map((row) => row.data) } },
          },
          include: { items: true },
        });

        for (const row of itemRows) {
          const invoiceItem = invoice.items.find((entry) => entry.fabricId === row.fabricId);
          await tx.tailorFabricIssue.create({
            data: {
              fabricId: row.fabricId,
              tailorId: tailorId || null,
              issuedLength: row.quantity,
              unitCostAtIssue: row.unitCost,
              movementType: enteredLocation === 'TAILOR' ? 'TAILOR_PURCHASE' : 'WAREHOUSE_PURCHASE',
              location: enteredLocation,
              quantityDelta: row.quantity,
              purchaseInvoiceItemId: invoiceItem?.id ?? null,
              reference: billNumber,
              status: 'closed',
              issueDate: new Date(purchaseDate),
              notes: cleanText(body.notes) || null,
            },
          });
        }

        return { fabrics: savedFabrics, invoice };
      });

      return NextResponse.json(
        {
          fabrics: result.fabrics.map(serializeFabric),
          invoice: serializePurchaseInvoice(result.invoice),
        },
        { status: 201 }
      );
    }

    if (action === 'add-fabric-stock') {
      // Warehouse stock-count adjustment/correction: a manual delta on the fabric's
      // total, recorded as a WAREHOUSE-location ledger entry (not tied to a bill).
      const fabricId = String(body.fabricId || '');
      const delta = lengthToMeters(body.purchasedLength, body.lengthUnit, 'الكمية المعدَّلة');

      if (!fabricId) {
        return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });
      }

      const existingFabric = await prisma.fabric.findUnique({ where: { id: fabricId } });
      if (!existingFabric) {
        return NextResponse.json({ error: 'القماش غير موجود' }, { status: 404 });
      }

      const note = cleanText(body.notes) || null;
      const actor = getAuditUser(access.session);

      const updatedFabric = await prisma.$transaction(async (tx) => {
        const updated = await tx.fabric.update({
          where: { id: fabricId },
          data: { stockLength: { increment: delta } },
        });
        await tx.tailorFabricIssue.create({
          data: {
            fabricId,
            issuedLength: delta,
            unitCostAtIssue: existingFabric.unitCost,
            movementType: 'STOCK_ADJUSTMENT',
            location: 'WAREHOUSE',
            quantityDelta: delta,
            status: 'closed',
            notes: note,
            reference: `تعديل جرد بواسطة ${actor}`,
          },
        });
        return updated;
      });

      return NextResponse.json(serializeFabric(updatedFabric));
    }

    if (action === 'tailor-stock-adjustment') {
      // A tailor's own stock-count correction on their held fabric.
      const fabricId = String(body.fabricId || '');
      const tailorId = String(body.tailorId || '');
      const delta = lengthToMeters(body.delta, body.lengthUnit, 'الكمية المعدَّلة');

      if (!fabricId || !tailorId) {
        return NextResponse.json({ error: 'القماش والخياط مطلوبان' }, { status: 400 });
      }

      const [fabric, tailor] = await Promise.all([
        prisma.fabric.findUnique({ where: { id: fabricId } }),
        prisma.tailor.findUnique({ where: { id: tailorId } }),
      ]);
      if (!fabric) return NextResponse.json({ error: 'القماش غير موجود' }, { status: 404 });
      if (!tailor) return NextResponse.json({ error: 'الخياط غير موجود' }, { status: 404 });

      await prisma.$transaction(async (tx) => {
        await tx.fabric.update({ where: { id: fabricId }, data: { stockLength: { increment: delta } } });
        await tx.tailorFabricIssue.create({
          data: {
            fabricId,
            tailorId,
            issuedLength: delta,
            unitCostAtIssue: fabric.unitCost,
            movementType: 'STOCK_ADJUSTMENT',
            location: 'TAILOR',
            quantityDelta: delta,
            status: 'closed',
            notes: cleanText(body.notes) || null,
          },
        });
      });

      const balance = await getLedgerBalance(prisma, fabricId, 'TAILOR', tailorId);
      return NextResponse.json({ fabricId, tailorId, heldBalance: balance });
    }

    if (action === 'issue-fabric') {
      const tailorId = String(body.tailorId || '');
      const designModelId = String(body.designModelId || '');
      if (!tailorId) {
        return NextResponse.json({ error: 'الخياط مطلوب' }, { status: 400 });
      }

      // Model-driven delivery: pick a dress model + dress count, deduct its full
      // bill of materials (all recipe fabrics + accessories) × count.
      if (designModelId) {
        const plannedDressCount = Math.max(1, Math.trunc(toNumber(body.plannedDressCount, 1)));

        const issue = await prisma.$transaction(async (tx) => {
          const model = await tx.designModel.findUnique({ where: { id: designModelId } });
          if (!model) throw new Error('الموديل غير موجود');

          const unit = model.unit || 'meter';
          const recipe: RecipeRow[] = Array.isArray(model.recipe) ? (model.recipe as any[]) : [];
          const accessories = parseAccessoryRecipe(model.accessories);

          const mainRow = recipe.find((row) => (row.role || 'main') === 'main') || recipe[0];
          if (!mainRow?.fabricId) throw new Error('لا يحتوي الموديل على قماش أساسي');

          const fabricsSnapshot: any[] = [];
          const mainFabricId = String(mainRow.fabricId);
          let mainUnitCost = new Prisma.Decimal(0);
          let mainIssuedLength = new Prisma.Decimal(0);

          // Deduct every recipe fabric. The main fabric becomes a net-zero custody
          // transfer to the tailor (paired ledger rows below, resolved later via
          // record-delivery); secondary materials are treated as consumed immediately,
          // matching the original behavior (they were never individually tracked as
          // "held by tailor").
          for (const row of recipe) {
            const rowFabricId = String(row.fabricId || '');
            if (!rowFabricId) continue;
            const consumptionMeters = consumptionToMeters(row.consumption, unit) * plannedDressCount;
            if (consumptionMeters <= 0) continue;
            const needed = new Prisma.Decimal(consumptionMeters);
            const fabric = await tx.fabric.findUnique({ where: { id: rowFabricId } });
            if (!fabric) throw new Error('أحد أقمشة الموديل غير موجود');
            const isMain = rowFabricId === mainFabricId;

            if (isMain) {
              const available = await getWarehouseAvailable(tx, rowFabricId);
              if (available < consumptionMeters) {
                throw new Error(`كمية القماش "${fabric.name}" في المستودع غير كافية`);
              }
              mainUnitCost = fabric.unitCost;
              mainIssuedLength = needed;
            } else {
              if (fabric.stockLength.lessThan(needed)) {
                throw new Error(`كمية القماش "${fabric.name}" في المخزون غير كافية`);
              }
              await tx.fabric.update({ where: { id: rowFabricId }, data: { stockLength: { decrement: needed } } });
            }

            fabricsSnapshot.push({
              fabricId: rowFabricId,
              name: fabric.name,
              role: row.role || 'main',
              consumption: toNumber(row.consumption),
              meters: consumptionMeters,
              unitCost: toNumber(fabric.unitCost),
            });
          }

          // Deduct accessories that reference real inventory.
          const accessoriesSnapshot: any[] = [];
          for (const row of accessories as any[]) {
            if (!row.accessoryId) continue;
            const qty = toNumber(row.consumption) * plannedDressCount;
            if (qty <= 0) continue;
            const needed = new Prisma.Decimal(qty);
            const accessory = await tx.accessory.findUnique({ where: { id: row.accessoryId } });
            if (!accessory) continue;
            if (accessory.stockQty.lessThan(needed)) {
              throw new Error(`كمية المستلزم "${accessory.name}" في المخزون غير كافية`);
            }
            await tx.accessory.update({ where: { id: row.accessoryId }, data: { stockQty: { decrement: needed } } });
            accessoriesSnapshot.push({
              accessoryId: row.accessoryId,
              name: accessory.name,
              qty,
              unitPrice: toNumber(accessory.unitPrice),
            });
          }

          const transferGroupId = `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();

          const created = await tx.tailorFabricIssue.create({
            data: {
              fabricId: mainFabricId,
              tailorId,
              designModelId,
              issuedLength: mainIssuedLength,
              unitCostAtIssue: mainUnitCost,
              plannedDressCount,
              size: body.size ? String(body.size) : null,
              componentsIssued: { fabrics: fabricsSnapshot, accessories: accessoriesSnapshot },
              issueDate,
              reference: body.reference || null,
              notes: body.notes || null,
              movementType: 'ISSUE_TO_TAILOR',
              location: 'TAILOR',
              quantityDelta: mainIssuedLength,
              transferGroupId,
            },
            include: { fabric: true, tailor: true },
          });

          // Warehouse-side leg of the custody transfer: net-zero on the fabric's grand total.
          await tx.tailorFabricIssue.create({
            data: {
              fabricId: mainFabricId,
              issuedLength: mainIssuedLength,
              unitCostAtIssue: mainUnitCost,
              movementType: 'ISSUE_TO_TAILOR',
              location: 'WAREHOUSE',
              quantityDelta: mainIssuedLength.neg(),
              transferGroupId,
              status: 'closed',
              issueDate,
              reference: body.reference || null,
            },
          });

          return created;
        });

        return NextResponse.json(serializeIssue(issue), { status: 201 });
      }

      // Legacy / manual single-fabric issue.
      const fabricId = String(body.fabricId || '');
      const issuedLength = lengthToMeters(body.issuedLength, body.lengthUnit, 'الكمية المسلمة');
      if (!fabricId) {
        return NextResponse.json({ error: 'القماش أو الموديل مطلوب' }, { status: 400 });
      }

      const issue = await prisma.$transaction(async (tx) => {
        const fabric = await tx.fabric.findUnique({ where: { id: fabricId } });
        if (!fabric) throw new Error('القماش غير موجود');
        const available = await getWarehouseAvailable(tx, fabricId);
        if (available < toNumber(issuedLength)) {
          throw new Error('كمية القماش في المستودع غير كافية');
        }

        const transferGroupId = `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();

        const created = await tx.tailorFabricIssue.create({
          data: {
            fabricId,
            tailorId,
            issuedLength,
            unitCostAtIssue: fabric.unitCost,
            size: body.size ? String(body.size) : null,
            issueDate,
            reference: body.reference || null,
            notes: body.notes || null,
            movementType: 'ISSUE_TO_TAILOR',
            location: 'TAILOR',
            quantityDelta: issuedLength,
            transferGroupId,
          },
          include: { fabric: true, tailor: true },
        });

        await tx.tailorFabricIssue.create({
          data: {
            fabricId,
            issuedLength,
            unitCostAtIssue: fabric.unitCost,
            movementType: 'ISSUE_TO_TAILOR',
            location: 'WAREHOUSE',
            quantityDelta: issuedLength.neg(),
            transferGroupId,
            status: 'closed',
            issueDate,
            reference: body.reference || null,
          },
        });

        return created;
      });

      return NextResponse.json(serializeIssue(issue), { status: 201 });
    }

    if (action === 'record-delivery') {
      const issueId = String(body.issueId || '');
      if (!issueId) {
        return NextResponse.json({ error: 'عملية التسليم مطلوبة' }, { status: 400 });
      }

      const deliveredDressCount = Math.max(0, Math.trunc(toNumber(body.deliveredDressCount)));
      const consumedLength = body.consumedLength
        ? lengthToMeters(body.consumedLength, body.lengthUnit, 'المستهلك من القماش')
        : toDecimal(0);
      const returnedLength = body.returnedLength
        ? lengthToMeters(body.returnedLength, body.lengthUnit, 'المرتجع للمخزون')
        : toDecimal(0);

      const issue = await prisma.$transaction(async (tx) => {
        const existing = await tx.tailorFabricIssue.findUnique({ where: { id: issueId } });
        if (!existing) throw new Error('سجل القماش المسلم غير موجود');

        const totalUsed = consumedLength.plus(returnedLength);
        if (totalUsed.greaterThan(existing.issuedLength)) {
          throw new Error('المستهلك والمرتجع لا يمكن أن يتجاوزا الكمية المسلمة');
        }

        if (existing.movementType === 'LEGACY_ISSUE') {
          // Pre-migration semantics: the full issuedLength was already subtracted from
          // Fabric.stockLength at issue time, so only the unused (returned) portion needs
          // crediting back. consumedLength was already accounted for by that original decrement.
          const previousReturned = existing.returnedLength || new Prisma.Decimal(0);
          const returnedDelta = returnedLength.minus(previousReturned);
          if (!returnedDelta.equals(0)) {
            await tx.fabric.update({
              where: { id: existing.fabricId },
              data: { stockLength: { increment: returnedDelta } },
            });
          }
        } else {
          // New custody-transfer semantics: issuing was net-zero on the grand total, so only
          // actual consumption permanently leaves it. Returning fabric to the warehouse is a
          // pure custody move (net zero), not a stock change.
          const previousConsumed = existing.consumedLength || new Prisma.Decimal(0);
          const consumedDelta = consumedLength.minus(previousConsumed);
          if (!consumedDelta.equals(0)) {
            await tx.fabric.update({
              where: { id: existing.fabricId },
              data: { stockLength: { decrement: consumedDelta } },
            });
          }
        }

        return tx.tailorFabricIssue.update({
          where: { id: issueId },
          data: {
            deliveredDressCount,
            consumedLength,
            returnedLength,
            tailoringCost: toDecimal(body.tailoringCost),
            embroideryCost: toDecimal(body.embroideryCost),
            extraCost: toDecimal(body.extraCost),
            deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : new Date(),
            status: body.status || 'delivered',
            size: body.size ? String(body.size) : existing.size,
            notes: body.notes || existing.notes,
          },
          include: { fabric: true, tailor: true },
        });
      });

      return NextResponse.json(serializeIssue(issue));
    }

    if (action === 'create-delivery-note') {
      const tailorId = String(body.tailorId || '');
      const designModelId = String(body.designModelId || '');
      const dressCount = Math.max(1, Math.trunc(toNumber(body.dressCount, 1)));
      if (!tailorId || !designModelId) {
        return NextResponse.json({ error: 'الخياط والموديل مطلوبان' }, { status: 400 });
      }

      const [tailor, model] = await Promise.all([
        prisma.tailor.findUnique({ where: { id: tailorId } }),
        prisma.designModel.findUnique({ where: { id: designModelId } }),
      ]);
      if (!tailor) return NextResponse.json({ error: 'الخياط غير موجود' }, { status: 404 });
      if (!model) return NextResponse.json({ error: 'الموديل غير موجود' }, { status: 404 });

      const snapshot = await buildDeliverySnapshot(model, dressCount);

      const note = await prisma.deliveryNote.create({
        data: {
          noteNumber: `DN-${Date.now().toString(36).toUpperCase()}`,
          tailorId,
          designModelId,
          dressCount,
          size: body.size ? String(body.size) : model.size,
          status: 'DRAFT',
          tailoringCost: toDecimal(body.tailoringCost ?? model.tailoringCost),
          embroideryCost: toDecimal(body.embroideryCost ?? model.embroideryCost),
          extraCost: toDecimal(body.extraCost ?? model.extraCost),
          componentsConsumed: snapshot,
          notes: cleanText(body.notes) || null,
        },
        include: { tailor: true, designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(note), { status: 201 });
    }

    if (action === 'submit-delivery-note') {
      const noteId = String(body.noteId || '');
      if (!noteId) return NextResponse.json({ error: 'مذكرة التسليم مطلوبة' }, { status: 400 });

      const note = await prisma.deliveryNote.findUnique({ where: { id: noteId } });
      if (!note) return NextResponse.json({ error: 'مذكرة التسليم غير موجودة' }, { status: 404 });
      if (note.status !== 'DRAFT') {
        return NextResponse.json({ error: 'لا يمكن تسليم مذكرة غير مسودة' }, { status: 409 });
      }

      const snapshot = (note.componentsConsumed as any) || { fabrics: [], accessories: [] };
      for (const line of snapshot.fabrics || []) {
        const balance = await getLedgerBalance(prisma, line.fabricId, 'TAILOR', note.tailorId);
        if (balance < line.meters) {
          return NextResponse.json(
            { error: `كمية القماش "${line.name}" المتوفرة لدى الخياط غير كافية لهذه الدفعة` },
            { status: 409 }
          );
        }
      }

      const updated = await prisma.deliveryNote.update({
        where: { id: noteId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          tailoringCost: body.tailoringCost !== undefined ? toDecimal(body.tailoringCost) : undefined,
          embroideryCost: body.embroideryCost !== undefined ? toDecimal(body.embroideryCost) : undefined,
          extraCost: body.extraCost !== undefined ? toDecimal(body.extraCost) : undefined,
        },
        include: { tailor: true, designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(updated));
    }

    if (action === 'accept-delivery-note') {
      if (!(await requireWarehouseRole(access.session))) {
        return NextResponse.json({ error: 'قبول التسليم من صلاحيات المستودع فقط' }, { status: 403 });
      }
      const noteId = String(body.noteId || '');
      if (!noteId) return NextResponse.json({ error: 'مذكرة التسليم مطلوبة' }, { status: 400 });
      const actor = getAuditUser(access.session);

      const note = await prisma.$transaction(async (tx) => {
        const existing = await tx.deliveryNote.findUnique({ where: { id: noteId }, include: { designModel: true } });
        if (!existing) throw new Error('مذكرة التسليم غير موجودة');
        if (existing.status !== 'SUBMITTED') throw new Error('لا يمكن قبول مذكرة غير مُسلَّمة');

        const snapshot = (existing.componentsConsumed as any) || { fabrics: [], accessories: [] };

        for (const line of snapshot.fabrics || []) {
          const balance = await getLedgerBalance(tx, line.fabricId, 'TAILOR', existing.tailorId);
          if (balance < line.meters) {
            throw new Error(`كمية القماش "${line.name}" المتوفرة لدى الخياط غير كافية لهذه الدفعة`);
          }
        }

        for (const line of snapshot.fabrics || []) {
          await tx.fabric.update({ where: { id: line.fabricId }, data: { stockLength: { decrement: line.meters } } });
          await tx.tailorFabricIssue.create({
            data: {
              fabricId: line.fabricId,
              tailorId: existing.tailorId,
              designModelId: existing.designModelId,
              issuedLength: new Prisma.Decimal(line.meters),
              unitCostAtIssue: toDecimal(line.unitCost),
              movementType: 'CONSUMPTION',
              location: 'TAILOR',
              quantityDelta: new Prisma.Decimal(-line.meters),
              status: 'closed',
              deliveryNoteId: existing.id,
              reference: existing.noteNumber,
            },
          });
        }

        for (const line of snapshot.accessories || []) {
          const accessory = await tx.accessory.findUnique({ where: { id: line.accessoryId } });
          if (accessory) {
            await tx.accessory.update({ where: { id: line.accessoryId }, data: { stockQty: { decrement: line.qty } } });
          }
        }

        await writeAudit(
          tx,
          'model',
          existing.designModelId,
          [{ field: 'دفعة مقبولة', oldValue: null, newValue: `${existing.dressCount} قطعة (${existing.noteNumber})` }],
          actor
        );

        return tx.deliveryNote.update({
          where: { id: noteId },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedBy: actor, sallaSyncStatus: 'pending' },
          include: { tailor: true, designModel: true },
        });
      });

      // Salla stock increment happens outside the DB transaction (external HTTP call).
      let sallaSyncStatus = 'success';
      let sallaSyncError: string | null = null;
      const model = note.designModel as any;
      if (model?.sallaProductId || model?.sallaVariantId) {
        const result = model.sallaVariantId
          ? await incrementSallaStock('variant_id', model.sallaVariantId, note.dressCount)
          : await incrementSallaStock('product_id', model.sallaProductId, note.dressCount);
        if (!result.ok) {
          sallaSyncStatus = 'failed';
          sallaSyncError = result.error;
        }
      } else {
        sallaSyncStatus = 'failed';
        sallaSyncError = 'الموديل غير مرتبط بمنتج سلة';
      }

      const finalNote = await prisma.deliveryNote.update({
        where: { id: noteId },
        data: { sallaSyncStatus, sallaSyncError, sallaSyncedAt: new Date() },
        include: { tailor: true, designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(finalNote));
    }

    if (action === 'reject-delivery-note') {
      if (!(await requireWarehouseRole(access.session))) {
        return NextResponse.json({ error: 'رفض التسليم من صلاحيات المستودع فقط' }, { status: 403 });
      }
      const noteId = String(body.noteId || '');
      const rejectionReason = cleanText(body.rejectionReason);
      if (!noteId) return NextResponse.json({ error: 'مذكرة التسليم مطلوبة' }, { status: 400 });

      const existing = await prisma.deliveryNote.findUnique({ where: { id: noteId } });
      if (!existing) return NextResponse.json({ error: 'مذكرة التسليم غير موجودة' }, { status: 404 });
      if (existing.status !== 'SUBMITTED') {
        return NextResponse.json({ error: 'لا يمكن رفض مذكرة غير مُسلَّمة' }, { status: 409 });
      }

      const updated = await prisma.deliveryNote.update({
        where: { id: noteId },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectedBy: getAuditUser(access.session),
          rejectionReason: rejectionReason || null,
        },
        include: { tailor: true, designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(updated));
    }

    if (action === 'resync-salla-stock') {
      if (!(await requireWarehouseRole(access.session))) {
        return NextResponse.json({ error: 'إعادة المزامنة من صلاحيات المستودع فقط' }, { status: 403 });
      }
      const noteId = String(body.noteId || '');
      if (!noteId) return NextResponse.json({ error: 'مذكرة التسليم مطلوبة' }, { status: 400 });

      const existing = await prisma.deliveryNote.findUnique({ where: { id: noteId }, include: { designModel: true } });
      if (!existing) return NextResponse.json({ error: 'مذكرة التسليم غير موجودة' }, { status: 404 });
      if (existing.status !== 'ACCEPTED') {
        return NextResponse.json({ error: 'لا يمكن مزامنة مذكرة غير مقبولة' }, { status: 409 });
      }

      const model = existing.designModel as any;
      let sallaSyncStatus = 'success';
      let sallaSyncError: string | null = null;
      if (model?.sallaProductId || model?.sallaVariantId) {
        const result = model.sallaVariantId
          ? await incrementSallaStock('variant_id', model.sallaVariantId, existing.dressCount)
          : await incrementSallaStock('product_id', model.sallaProductId, existing.dressCount);
        if (!result.ok) {
          sallaSyncStatus = 'failed';
          sallaSyncError = result.error;
        }
      } else {
        sallaSyncStatus = 'failed';
        sallaSyncError = 'الموديل غير مرتبط بمنتج سلة';
      }

      const updated = await prisma.deliveryNote.update({
        where: { id: noteId },
        data: { sallaSyncStatus, sallaSyncError, sallaSyncedAt: new Date() },
        include: { tailor: true, designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(updated));
    }

    if (action === 'update-request-status') {
      const requestId = String(body.requestId || '');
      const status = String(body.status || '');
      if (!requestId || !['pending', 'approved', 'fulfilled', 'rejected'].includes(status)) {
        return NextResponse.json({ error: 'حالة الطلب غير صالحة' }, { status: 400 });
      }

      const updatedRequest = await prisma.$transaction(async (tx) => {
        const existingRequest = await tx.tailorFabricRequest.findUnique({
          where: { id: requestId },
          include: { fabric: true, tailor: true },
        });
        if (!existingRequest) throw new Error('طلب القماش غير موجود');

        let fabricId = existingRequest.fabricId;
        const isFirstApproval =
          status === 'approved' && !['approved', 'fulfilled'].includes(existingRequest.status);
        const isPurchaseApproval = isFirstApproval && existingRequest.requestType === 'purchase';

        if (isPurchaseApproval) {
          const purchaseName = existingRequest.purchaseName?.trim();
          if (!purchaseName) throw new Error('اسم القماش المشترى مطلوب قبل الاعتماد');

          const purchaseSku = existingRequest.purchaseSku?.trim() || null;
          const matchingFabric = fabricId
            ? existingRequest.fabric
            : purchaseSku
              ? await tx.fabric.findUnique({ where: { sku: purchaseSku } })
              : null;

          const stockLength = existingRequest.requestedLength;
          const unitCost = existingRequest.purchaseUnitCost || new Prisma.Decimal(0);
          const purchaseSupplier = normalizeSupplier(existingRequest.purchaseSupplier);

          if (matchingFabric) {
            const notes = [
              matchingFabric.notes,
              `شراء معتمد من ${existingRequest.tailor.name}: ${existingRequest.notes || ''}`.trim(),
            ]
              .filter(Boolean)
              .join('\n');

            const updatedFabric = await tx.fabric.update({
              where: { id: matchingFabric.id },
              data: {
                stockLength: { increment: stockLength },
                unitCost,
                color: existingRequest.purchaseColor || matchingFabric.color,
                fabricType: existingRequest.purchaseFabricType || matchingFabric.fabricType,
                supplier: purchaseSupplier || matchingFabric.supplier,
                notes,
              },
            });
            fabricId = updatedFabric.id;
          } else {
            const createdFabric = await tx.fabric.create({
              data: {
                name: purchaseName,
                sku: purchaseSku,
                color: existingRequest.purchaseColor || null,
                fabricType: existingRequest.purchaseFabricType || null,
                supplier: purchaseSupplier,
                unitCost,
                stockLength,
                notes: existingRequest.notes || null,
              },
            });
            fabricId = createdFabric.id;
          }
        }

        // Approval hands the fabric over: move the requested quantity from the
        // warehouse to the tailor's ledger balance (paired custody-transfer rows,
        // same pattern as issue-fabric) so his delivery notes pass the stock
        // checks. Fires once — re-approving or fulfilling doesn't credit again.
        if (isFirstApproval) {
          if (!fabricId) throw new Error('القماش مطلوب لاعتماد الطلب');
          const fabric = await tx.fabric.findUnique({ where: { id: fabricId } });
          if (!fabric) throw new Error('القماش غير موجود');

          const requestedLength = existingRequest.requestedLength;
          // Purchase approvals just added this exact quantity to warehouse stock;
          // stock requests draw on what's already available.
          if (!isPurchaseApproval) {
            const available = await getWarehouseAvailable(tx, fabricId);
            if (available < toNumber(requestedLength)) {
              throw new Error('كمية القماش في المستودع غير كافية لاعتماد الطلب');
            }
          }

          const transferGroupId = `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const issueDate = new Date();
          const reference = `طلب قماش ${existingRequest.id}`;

          await tx.tailorFabricIssue.create({
            data: {
              fabricId,
              tailorId: existingRequest.tailorId,
              issuedLength: requestedLength,
              unitCostAtIssue: fabric.unitCost,
              issueDate,
              reference,
              movementType: 'ISSUE_TO_TAILOR',
              location: 'TAILOR',
              quantityDelta: requestedLength,
              transferGroupId,
            },
          });

          await tx.tailorFabricIssue.create({
            data: {
              fabricId,
              issuedLength: requestedLength,
              unitCostAtIssue: fabric.unitCost,
              movementType: 'ISSUE_TO_TAILOR',
              location: 'WAREHOUSE',
              quantityDelta: requestedLength.neg(),
              transferGroupId,
              status: 'closed',
              issueDate,
              reference,
            },
          });
        }

        return tx.tailorFabricRequest.update({
          where: { id: requestId },
          data: {
            fabricId,
            status,
            fulfilledAt: status === 'fulfilled' ? new Date() : existingRequest.fulfilledAt,
            approvedAt: status === 'approved' ? new Date() : existingRequest.approvedAt,
            approvedBy: status === 'approved' ? getAuditUser(access.session) : existingRequest.approvedBy,
          },
          include: { fabric: true, tailor: true },
        });
      });

      return NextResponse.json(serializeRequest(updatedRequest));
    }

    if (action === 'create-model') {
      const unit = body.unit === 'yard' ? 'yard' : 'meter';
      const rawRecipe = Array.isArray(body.recipe) ? body.recipe : [];
      const recipe = rawRecipe
        .map((row: any) => ({
          role: typeof row?.role === 'string' ? row.role : 'main',
          fabricId: String(row?.fabricId || ''),
          consumption: toNumber(row?.consumption),
        }))
        .filter((row: any) => row.fabricId && row.consumption > 0);

      if (!recipe.length) {
        return NextResponse.json({ error: 'أضف قماشاً واحداً على الأقل مع كمية استهلاك صحيحة' }, { status: 400 });
      }

      const accessories = parseAccessoryRecipe(body.accessories);

      const imageData = typeof body.imageData === 'string' && body.imageData.startsWith('data:image/')
        ? body.imageData
        : null;
      if (imageData && imageData.length > MAX_IMAGE_DATA_LENGTH) {
        return NextResponse.json({ error: 'حجم الصورة كبير جداً (الحد الأقصى ~2 ميجابايت)' }, { status: 400 });
      }

      const colors = Array.isArray(body.colors)
        ? body.colors.filter((color: unknown): color is string => typeof color === 'string' && color.trim().length > 0)
        : [];

      let lastSku = '';
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const model = await prisma.$transaction(async (tx) => {
            const sku = await allocateDesignModelSku(tx, access.session);
            lastSku = sku;
            return tx.designModel.create({
              data: {
                sku,
                status: ['active', 'paused', 'draft'].includes(body.status) ? body.status : 'active',
                description: typeof body.description === 'string' ? body.description : null,
                size: typeof body.size === 'string' && body.size.trim() ? body.size.trim() : null,
                unit,
                colors,
                imageData,
                recipe,
                accessories,
                tailoringCost: toDecimal(body.tailoringCost),
                embroideryCost: toDecimal(body.embroideryCost),
                extraCost: toDecimal(body.extraCost),
                sallaProductId: body.sallaProductId !== undefined ? toNumber(body.sallaProductId, 0) || null : null,
                sallaProductName: cleanText(body.sallaProductName) || null,
                sallaVariantId: cleanText(body.sallaVariantId) || null,
                sallaVariantName: cleanText(body.sallaVariantName) || null,
                sallaSku: cleanText(body.sallaSku) || null,
              },
            });
          });

          const { fabricMap, accessoryMap } = await loadRecipeMaps(recipe, accessories);
          return NextResponse.json(
            serializeModel(model, fabricMap, accessoryMap, { inProgressCount: 0, reservedLength: 0 }),
            { status: 201 }
          );
        } catch (createError: any) {
          if (createError?.code === 'P2002' && attempt < 2) continue;
          if (createError?.code === 'P2002') {
            return NextResponse.json({ error: `رقم الصنف ${lastSku} مستخدم بالفعل، يرجى المحاولة مرة أخرى` }, { status: 409 });
          }
          throw createError;
        }
      }

      return NextResponse.json({ error: 'تعذر إنشاء رقم صنف تلقائي، يرجى المحاولة مرة أخرى' }, { status: 409 });
    }

    if (action === 'update-model-status') {
      const modelId = String(body.modelId || '');
      const status = String(body.status || '');
      if (!modelId || !['active', 'paused', 'draft'].includes(status)) {
        return NextResponse.json({ error: 'حالة الموديل غير صالحة' }, { status: 400 });
      }
      const existingStatus = await prisma.designModel.findUnique({ where: { id: modelId }, select: { status: true } });
      const updated = await prisma.designModel.update({ where: { id: modelId }, data: { status } });
      await writeAudit(
        prisma,
        'model',
        modelId,
        [{ field: 'status', oldValue: existingStatus?.status, newValue: status }],
        getAuditUser(access.session)
      );
      const { fabricMap, accessoryMap } = await loadRecipeMaps(
        Array.isArray(updated.recipe) ? (updated.recipe as any[]) : [],
        Array.isArray(updated.accessories) ? (updated.accessories as any[]) : []
      );
      return NextResponse.json(serializeModel(updated, fabricMap, accessoryMap, { inProgressCount: 0, reservedLength: 0 }));
    }

    if (action === 'delete-model') {
      const modelId = String(body.modelId || '');
      if (!modelId) {
        return NextResponse.json({ error: 'الموديل مطلوب' }, { status: 400 });
      }
      await prisma.designModel.delete({ where: { id: modelId } });
      return NextResponse.json({ ok: true });
    }

    if (action === 'update-fabric') {
      const fabricId = String(body.fabricId || '');
      if (!fabricId) return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });

      const existing = await prisma.fabric.findUnique({ where: { id: fabricId } });
      if (!existing) return NextResponse.json({ error: 'القماش غير موجود' }, { status: 404 });

      const unit = body.lengthUnit === 'yard' ? 'yard' : 'meter';
      const name = cleanText(body.name) || existing.name;
      const sku = body.sku !== undefined ? cleanText(body.sku) || null : existing.sku;
      const color = body.color !== undefined ? cleanText(body.color) || null : existing.color;
      const fabricType = body.fabricType !== undefined ? cleanText(body.fabricType) || null : existing.fabricType;
      const unitCost = body.unitCost !== undefined && body.unitCost !== '' ? costToPerMeter(body.unitCost, unit) : existing.unitCost;
      const stockLength = body.stockLength !== undefined && body.stockLength !== '' ? lengthToMeters(body.stockLength, unit, 'المخزون') : existing.stockLength;
      const minStock = body.minStock !== undefined && body.minStock !== '' ? lengthToMeters(body.minStock, unit, 'حد التنبيه') : existing.minStock;
      const notes = body.notes !== undefined ? cleanText(body.notes) || null : existing.notes;

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.fabric.update({
          where: { id: fabricId },
          data: { name, sku, color, fabricType, unitCost, stockLength, minStock, notes },
        });
        await writeAudit(tx, 'fabric', fabricId, [
          { field: 'الاسم', oldValue: existing.name, newValue: name },
          { field: 'رقم المنتج', oldValue: existing.sku, newValue: sku },
          { field: 'اللون', oldValue: existing.color, newValue: color },
          { field: 'النوع', oldValue: existing.fabricType, newValue: fabricType },
          { field: 'تكلفة المتر', oldValue: existing.unitCost, newValue: unitCost },
          { field: 'المخزون', oldValue: existing.stockLength, newValue: stockLength },
          { field: 'حد التنبيه', oldValue: existing.minStock, newValue: minStock },
        ], getAuditUser(access.session));
        return result;
      });

      return NextResponse.json(serializeFabric(updated));
    }

    if (action === 'delete-fabric') {
      const fabricId = String(body.fabricId || '');
      if (!fabricId) return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });
      try {
        await prisma.fabric.delete({ where: { id: fabricId } });
      } catch (error: any) {
        if (error?.code === 'P2003') {
          return NextResponse.json({ error: 'لا يمكن حذف قماش مرتبط بحركات أو طلبات' }, { status: 409 });
        }
        throw error;
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'create-accessory') {
      const name = cleanText(body.name);
      if (!name) return NextResponse.json({ error: 'اسم المستلزم مطلوب' }, { status: 400 });
      const accessory = await prisma.accessory.create({
        data: {
          name,
          sku: cleanText(body.sku) || null,
          unitPrice: toDecimal(body.unitPrice),
          stockQty: toDecimal(body.stockQty),
          minStock: toDecimal(body.minStock),
          notes: cleanText(body.notes) || null,
        },
      });
      return NextResponse.json(serializeAccessory(accessory), { status: 201 });
    }

    if (action === 'update-accessory') {
      const accessoryId = String(body.accessoryId || '');
      if (!accessoryId) return NextResponse.json({ error: 'المستلزم مطلوب' }, { status: 400 });
      const existing = await prisma.accessory.findUnique({ where: { id: accessoryId } });
      if (!existing) return NextResponse.json({ error: 'المستلزم غير موجود' }, { status: 404 });

      const name = cleanText(body.name) || existing.name;
      const sku = body.sku !== undefined ? cleanText(body.sku) || null : existing.sku;
      const unitPrice = body.unitPrice !== undefined && body.unitPrice !== '' ? toDecimal(body.unitPrice) : existing.unitPrice;
      const stockQty = body.stockQty !== undefined && body.stockQty !== '' ? toDecimal(body.stockQty) : existing.stockQty;
      const minStock = body.minStock !== undefined && body.minStock !== '' ? toDecimal(body.minStock) : existing.minStock;
      const notes = body.notes !== undefined ? cleanText(body.notes) || null : existing.notes;

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.accessory.update({
          where: { id: accessoryId },
          data: { name, sku, unitPrice, stockQty, minStock, notes },
        });
        await writeAudit(tx, 'accessory', accessoryId, [
          { field: 'الاسم', oldValue: existing.name, newValue: name },
          { field: 'رقم المنتج', oldValue: existing.sku, newValue: sku },
          { field: 'السعر', oldValue: existing.unitPrice, newValue: unitPrice },
          { field: 'المخزون', oldValue: existing.stockQty, newValue: stockQty },
          { field: 'حد التنبيه', oldValue: existing.minStock, newValue: minStock },
        ], getAuditUser(access.session));
        return result;
      });

      return NextResponse.json(serializeAccessory(updated));
    }

    if (action === 'delete-accessory') {
      const accessoryId = String(body.accessoryId || '');
      if (!accessoryId) return NextResponse.json({ error: 'المستلزم مطلوب' }, { status: 400 });
      await prisma.accessory.delete({ where: { id: accessoryId } });
      return NextResponse.json({ ok: true });
    }

    if (action === 'create-accessory-purchase-bill') {
      const billNumber = cleanText(body.billNumber);
      const purchaseDate = cleanText(body.purchaseDate);
      const items = Array.isArray(body.items) ? body.items : [];

      if (!billNumber) return NextResponse.json({ error: 'رقم فاتورة الشراء مطلوب' }, { status: 400 });
      if (!purchaseDate || Number.isNaN(new Date(purchaseDate).getTime())) {
        return NextResponse.json({ error: 'تاريخ الشراء مطلوب' }, { status: 400 });
      }
      if (!items.length) return NextResponse.json({ error: 'أضف مستلزماً واحداً على الأقل للفاتورة' }, { status: 400 });

      const saved = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const [index, item] of items.entries()) {
          const rowLabel = `سطر ${index + 1}`;
          const accessoryId = cleanText(item?.accessoryId);
          const name = cleanText(item?.name);
          const sku = cleanText(item?.sku);
          const purchasedQty = toPositiveDecimal(item?.purchasedQty, `كمية ${rowLabel}`);
          const unitPrice = item?.unitPrice !== undefined && item?.unitPrice !== '' ? toDecimal(item.unitPrice) : null;
          const minStock = item?.minStock !== undefined && item?.minStock !== '' ? toDecimal(item.minStock) : null;
          const purchaseNote = [`فاتورة شراء ${billNumber}`, `تاريخ الشراء: ${purchaseDate}`, body.notes ? cleanText(body.notes) : null]
            .filter(Boolean)
            .join(' - ');

          const existing = accessoryId
            ? await tx.accessory.findUnique({ where: { id: accessoryId } })
            : sku
              ? await tx.accessory.findUnique({ where: { sku } })
              : null;

          if (accessoryId && !existing) throw new Error(`المستلزم المحدد في ${rowLabel} غير موجود`);

          if (existing) {
            const updated = await tx.accessory.update({
              where: { id: existing.id },
              data: {
                stockQty: { increment: purchasedQty },
                unitPrice: unitPrice || existing.unitPrice,
                minStock: minStock || existing.minStock,
                notes: [existing.notes, `توريد جديد: ${purchaseNote}`].filter(Boolean).join('\n'),
              },
            });
            results.push(updated);
            continue;
          }

          if (!name) throw new Error(`اسم المستلزم مطلوب في ${rowLabel}`);
          const created = await tx.accessory.create({
            data: {
              name,
              sku: sku || null,
              unitPrice: unitPrice || toDecimal(0),
              stockQty: purchasedQty,
              minStock: minStock || toDecimal(0),
              notes: purchaseNote,
            },
          });
          results.push(created);
        }
        return results;
      });

      return NextResponse.json({ accessories: saved.map(serializeAccessory) }, { status: 201 });
    }

    if (action === 'update-model') {
      const modelId = String(body.modelId || '');
      if (!modelId) return NextResponse.json({ error: 'الموديل مطلوب' }, { status: 400 });
      const existing = await prisma.designModel.findUnique({ where: { id: modelId } });
      if (!existing) return NextResponse.json({ error: 'الموديل غير موجود' }, { status: 404 });

      const unit = body.unit === 'yard' ? 'yard' : 'meter';
      const recipe = (Array.isArray(body.recipe) ? body.recipe : [])
        .map((row: any) => ({
          role: typeof row?.role === 'string' ? row.role : 'main',
          fabricId: String(row?.fabricId || ''),
          consumption: toNumber(row?.consumption),
        }))
        .filter((row: any) => row.fabricId && row.consumption > 0);
      if (!recipe.length) {
        return NextResponse.json({ error: 'أضف قماشاً واحداً على الأقل مع كمية استهلاك صحيحة' }, { status: 400 });
      }
      const accessories = parseAccessoryRecipe(body.accessories);

      const imageData =
        body.imageData === null
          ? null
          : typeof body.imageData === 'string' && body.imageData.startsWith('data:image/')
            ? body.imageData
            : existing.imageData;
      if (imageData && imageData.length > MAX_IMAGE_DATA_LENGTH) {
        return NextResponse.json({ error: 'حجم الصورة كبير جداً (الحد الأقصى ~2 ميجابايت)' }, { status: 400 });
      }

      const status = ['active', 'paused', 'draft'].includes(body.status) ? body.status : existing.status;
      const colors = Array.isArray(body.colors)
        ? body.colors.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
        : (existing.colors as string[]);
      const tailoringCost = toDecimal(body.tailoringCost);
      const embroideryCost = toDecimal(body.embroideryCost);
      const extraCost = toDecimal(body.extraCost);
      const description = typeof body.description === 'string' ? body.description : existing.description;
      const size =
        body.size === null
          ? null
          : typeof body.size === 'string'
            ? (body.size.trim() || null)
            : existing.size;
      const sallaProductId =
        body.sallaProductId === null ? null : body.sallaProductId !== undefined ? toNumber(body.sallaProductId, 0) || null : existing.sallaProductId;
      const sallaProductName = body.sallaProductName !== undefined ? cleanText(body.sallaProductName) || null : existing.sallaProductName;
      const sallaVariantId = body.sallaVariantId !== undefined ? cleanText(body.sallaVariantId) || null : existing.sallaVariantId;
      const sallaVariantName = body.sallaVariantName !== undefined ? cleanText(body.sallaVariantName) || null : existing.sallaVariantName;
      const sallaSku = body.sallaSku !== undefined ? cleanText(body.sallaSku) || null : existing.sallaSku;

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.designModel.update({
          where: { id: modelId },
          data: {
            status, description, size, unit, colors, imageData, recipe, accessories,
            tailoringCost, embroideryCost, extraCost,
            sallaProductId, sallaProductName, sallaVariantId, sallaVariantName, sallaSku,
          },
        });
        await writeAudit(tx, 'model', modelId, [
          { field: 'الحالة', oldValue: existing.status, newValue: status },
          { field: 'تكلفة الخياطة', oldValue: existing.tailoringCost, newValue: tailoringCost },
          { field: 'تكلفة التطريز', oldValue: existing.embroideryCost, newValue: embroideryCost },
          { field: 'تكلفة إضافية', oldValue: existing.extraCost, newValue: extraCost },
        ], getAuditUser(access.session));
        return result;
      });

      const { fabricMap, accessoryMap } = await loadRecipeMaps(recipe, accessories);
      return NextResponse.json(serializeModel(updated, fabricMap, accessoryMap, { inProgressCount: 0, reservedLength: 0 }));
    }

    if (action === 'fetch-audit') {
      const entityType = String(body.entityType || '');
      const entityId = String(body.entityId || '');
      if (!['fabric', 'accessory', 'model'].includes(entityType) || !entityId) {
        return NextResponse.json({ error: 'نوع أو معرّف السجل غير صالح' }, { status: 400 });
      }
      const logs = await prisma.inventoryAuditLog.findMany({
        where: { entityType, entityId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return NextResponse.json({ logs });
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error: any) {
    console.error('Error saving fabric management data:', error);
    const status = error instanceof BadRequestError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'فشل في حفظ بيانات الأقمشة' },
      { status }
    );
  }
}
