import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

const FABRIC_SERVICE = 'fabric-management';
const YARD_TO_METER = 0.9144;
const MAX_IMAGE_DATA_LENGTH = 3_000_000; // ~2.2MB base64 string
const SUPPLIER_VALUES = [
  'جملة بفاتورة',
  'استيراد الصين',
  'مخزون سابق',
  'مكتب محلي',
  'طلب خاص',
] as const;

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
  const supplier = typeof value === 'string' ? value.trim() : '';
  if (!supplier) return null;
  if (!(SUPPLIER_VALUES as readonly string[]).includes(supplier)) {
    throw new BadRequestError(`المورد يجب أن يكون أحد الخيارات التالية: ${SUPPLIER_VALUES.join('، ')}`);
  }
  return supplier;
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

  if (!hasServiceAccess(session, FABRIC_SERVICE)) {
    return {
      error: NextResponse.json(
        { error: 'لا تملك صلاحية لإدارة الأقمشة' },
        { status: 403 }
      ),
    };
  }

  return { session };
}

export async function GET() {
  try {
    const access = await requireAccess();
    if (access.error) return access.error;

    const [fabrics, accessories, tailors, issues, requests, models] = await Promise.all([
      prisma.fabric.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      prisma.accessory.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      prisma.tailor.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
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
      fabrics: fabrics.map(serializeFabric),
      accessories: accessories.map(serializeAccessory),
      tailors,
      issues: serializedIssues,
      requests: requests.map(serializeRequest),
      models: serializedModels,
      summary: {
        fabricsCount: fabrics.length,
        accessoriesCount: accessories.length,
        activeTailorsCount: tailors.filter((tailor) => tailor.isActive).length,
        stockMeters,
        withTailorsMeters,
        pendingRequestsCount: requests.filter((request) => request.status === 'pending').length,
        modelsCount: models.length,
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

      if (!billNumber) {
        return NextResponse.json({ error: 'رقم فاتورة الشراء مطلوب' }, { status: 400 });
      }

      if (!purchaseDate || Number.isNaN(new Date(purchaseDate).getTime())) {
        return NextResponse.json({ error: 'تاريخ الشراء مطلوب' }, { status: 400 });
      }

      if (!items.length) {
        return NextResponse.json({ error: 'أضف قماشاً واحداً على الأقل للفاتورة' }, { status: 400 });
      }

      const savedFabrics = await prisma.$transaction(async (tx) => {
        const results = [];

        for (const [index, item] of items.entries()) {
          const rowLabel = `سطر ${index + 1}`;
          const fabricId = cleanText(item?.fabricId);
          const name = cleanText(item?.name);
          const sku = cleanText(item?.sku);
          const purchasedLength = lengthToMeters(item?.purchasedLength, lengthUnit, `كمية ${rowLabel}`);
          const unitCost =
            item?.unitCost !== undefined && item?.unitCost !== ''
              ? costToPerMeter(item.unitCost, lengthUnit)
              : null;
          const minStock =
            item?.minStock !== undefined && item?.minStock !== ''
              ? lengthToMeters(item.minStock, lengthUnit, `حد التنبيه في ${rowLabel}`)
              : null;
          const purchaseNote = [
            `فاتورة شراء ${billNumber}`,
            `تاريخ الشراء: ${purchaseDate}`,
            item?.notes ? cleanText(item.notes) : null,
            body.notes ? cleanText(body.notes) : null,
          ]
            .filter(Boolean)
            .join(' - ');

          const existingFabric = fabricId
            ? await tx.fabric.findUnique({ where: { id: fabricId } })
            : sku
              ? await tx.fabric.findUnique({ where: { sku } })
              : null;

          if (fabricId && !existingFabric) {
            throw new Error(`القماش المحدد في ${rowLabel} غير موجود`);
          }

          if (existingFabric) {
            const updatedFabric = await tx.fabric.update({
              where: { id: existingFabric.id },
              data: {
                stockLength: { increment: purchasedLength },
                supplier: supplier || existingFabric.supplier,
                color: cleanText(item?.color) || existingFabric.color,
                unitCost: unitCost || existingFabric.unitCost,
                minStock: minStock || existingFabric.minStock,
                notes: [existingFabric.notes, `توريد جديد: ${purchaseNote}`].filter(Boolean).join('\n'),
              },
            });
            results.push(updatedFabric);
            continue;
          }

          if (!name) {
            throw new Error(`اسم القماش مطلوب في ${rowLabel}`);
          }

          const createdFabric = await tx.fabric.create({
            data: {
              name,
              sku: sku || null,
              color: cleanText(item?.color) || null,
              fabricType: null,
              supplier,
              unitCost: unitCost || toDecimal(0),
              stockLength: purchasedLength,
              minStock: minStock || toDecimal(0),
              notes: purchaseNote,
            },
          });
          results.push(createdFabric);
        }

        return results;
      });

      return NextResponse.json({ fabrics: savedFabrics.map(serializeFabric) }, { status: 201 });
    }

    if (action === 'add-fabric-stock') {
      const fabricId = String(body.fabricId || '');
      const purchasedLength = lengthToMeters(body.purchasedLength, body.lengthUnit, 'الكمية المضافة');

      if (!fabricId) {
        return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });
      }

      const existingFabric = await prisma.fabric.findUnique({ where: { id: fabricId } });
      if (!existingFabric) {
        return NextResponse.json({ error: 'القماش غير موجود' }, { status: 404 });
      }

      const purchaseNote = [
        body.purchaseBill ? `رقم فاتورة الشراء: ${body.purchaseBill}` : null,
        body.notes,
      ]
        .filter(Boolean)
        .join(' - ');
      const supplier = normalizeSupplier(body.supplier);

      const updatedFabric = await prisma.fabric.update({
        where: { id: fabricId },
        data: {
          stockLength: { increment: purchasedLength },
          supplier: supplier || existingFabric.supplier,
          unitCost:
            body.unitCost !== undefined && body.unitCost !== ''
              ? costToPerMeter(body.unitCost, body.lengthUnit)
              : existingFabric.unitCost,
          notes: purchaseNote
            ? [existingFabric.notes, `توريد جديد: ${purchaseNote}`].filter(Boolean).join('\n')
            : existingFabric.notes,
        },
      });

      return NextResponse.json(serializeFabric(updatedFabric));
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

          // Deduct every recipe fabric.
          for (const row of recipe) {
            const rowFabricId = String(row.fabricId || '');
            if (!rowFabricId) continue;
            const consumptionMeters = consumptionToMeters(row.consumption, unit) * plannedDressCount;
            if (consumptionMeters <= 0) continue;
            const needed = new Prisma.Decimal(consumptionMeters);
            const fabric = await tx.fabric.findUnique({ where: { id: rowFabricId } });
            if (!fabric) throw new Error('أحد أقمشة الموديل غير موجود');
            if (fabric.stockLength.lessThan(needed)) {
              throw new Error(`كمية القماش "${fabric.name}" في المخزون غير كافية`);
            }
            await tx.fabric.update({ where: { id: rowFabricId }, data: { stockLength: { decrement: needed } } });
            fabricsSnapshot.push({
              fabricId: rowFabricId,
              name: fabric.name,
              role: row.role || 'main',
              consumption: toNumber(row.consumption),
              meters: consumptionMeters,
              unitCost: toNumber(fabric.unitCost),
            });
            if (rowFabricId === mainFabricId) {
              mainUnitCost = fabric.unitCost;
              mainIssuedLength = needed;
            }
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

          return tx.tailorFabricIssue.create({
            data: {
              fabricId: mainFabricId,
              tailorId,
              designModelId,
              issuedLength: mainIssuedLength,
              unitCostAtIssue: mainUnitCost,
              plannedDressCount,
              size: body.size ? String(body.size) : null,
              componentsIssued: { fabrics: fabricsSnapshot, accessories: accessoriesSnapshot },
              issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
              reference: body.reference || null,
              notes: body.notes || null,
            },
            include: { fabric: true, tailor: true },
          });
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
        if (fabric.stockLength.lessThan(issuedLength)) {
          throw new Error('كمية القماش في المخزون غير كافية');
        }

        await tx.fabric.update({
          where: { id: fabricId },
          data: { stockLength: { decrement: issuedLength } },
        });

        return tx.tailorFabricIssue.create({
          data: {
            fabricId,
            tailorId,
            issuedLength,
            unitCostAtIssue: fabric.unitCost,
            size: body.size ? String(body.size) : null,
            issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
            reference: body.reference || null,
            notes: body.notes || null,
          },
          include: { fabric: true, tailor: true },
        });
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

        const previousReturned = existing.returnedLength || new Prisma.Decimal(0);
        const returnedDelta = returnedLength.minus(previousReturned);
        if (!returnedDelta.equals(0)) {
          await tx.fabric.update({
            where: { id: existing.fabricId },
            data: { stockLength: { increment: returnedDelta } },
          });
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
        const isPurchaseApproval =
          existingRequest.requestType === 'purchase' &&
          status === 'approved' &&
          !['approved', 'fulfilled'].includes(existingRequest.status);

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
      const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
      if (!sku) {
        return NextResponse.json({ error: 'رقم الصنف (SKU) مطلوب' }, { status: 400 });
      }

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

      try {
        const model = await prisma.designModel.create({
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
          },
        });

        const { fabricMap, accessoryMap } = await loadRecipeMaps(recipe, accessories);
        return NextResponse.json(
          serializeModel(model, fabricMap, accessoryMap, { inProgressCount: 0, reservedLength: 0 }),
          { status: 201 }
        );
      } catch (createError: any) {
        if (createError?.code === 'P2002') {
          return NextResponse.json({ error: `رقم الصنف ${sku} مستخدم بالفعل` }, { status: 409 });
        }
        throw createError;
      }
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

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.designModel.update({
          where: { id: modelId },
          data: { status, description, size, unit, colors, imageData, recipe, accessories, tailoringCost, embroideryCost, extraCost },
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
