import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

const TAILOR_SERVICE = 'tailor-dashboard';
const YARD_TO_METER = 0.9144;
const MAX_IMAGE_DATA_LENGTH = 3_000_000; // ~2.2MB base64 string

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toDecimal(value: unknown, fallback = 0) {
  return new Prisma.Decimal(toNumber(value, fallback));
}

function lengthToMeters(value: unknown, unit: unknown, field: string) {
  const length = toNumber(value, NaN);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error(`${field} يجب أن يكون أكبر من صفر`);
  }
  return unit === 'yard' ? new Prisma.Decimal(length * YARD_TO_METER) : new Prisma.Decimal(length);
}

function costToPerMeter(value: unknown, unit: unknown) {
  const cost = toDecimal(value);
  return unit === 'yard' ? cost.div(YARD_TO_METER) : cost;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function consumptionToMeters(value: unknown, unit: string) {
  return toNumber(value) * (unit === 'yard' ? YARD_TO_METER : 1);
}

function serializeFabric(fabric: any) {
  return {
    id: fabric.id,
    name: fabric.name,
    sku: fabric.sku,
    color: fabric.color,
    fabricType: fabric.fabricType,
    unitCost: toNumber(fabric.unitCost),
  };
}

function serializePurchaseInvoice(invoice: any) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    supplier: invoice.supplier,
    purchaseDate: invoice.purchaseDate,
    totalInclVat: toNumber(invoice.totalInclVat),
    items: Array.isArray(invoice.items)
      ? invoice.items.map((item: any) => ({
          fabricId: item.fabricId,
          productName: item.productName,
          quantity: toNumber(item.quantity),
          unitCost: toNumber(item.unitCost),
        }))
      : [],
  };
}

function serializeModel(model: any) {
  return {
    id: model.id,
    sku: model.sku,
    size: model.size,
    unit: model.unit,
    imageData: model.imageData || null,
    recipe: Array.isArray(model.recipe) ? model.recipe : [],
    accessories: Array.isArray(model.accessories) ? model.accessories : [],
    tailoringCost: toNumber(model.tailoringCost),
    embroideryCost: toNumber(model.embroideryCost),
    extraCost: toNumber(model.extraCost),
    sallaProductId: model.sallaProductId ?? null,
    sallaVariantId: model.sallaVariantId ?? null,
  };
}

function serializeDeliveryNote(note: any) {
  return {
    id: note.id,
    noteNumber: note.noteNumber,
    dressCount: Number(note.dressCount || 0),
    size: note.size,
    status: note.status,
    tailoringCost: toNumber(note.tailoringCost),
    embroideryCost: toNumber(note.embroideryCost),
    extraCost: toNumber(note.extraCost),
    componentsConsumed: note.componentsConsumed,
    submittedAt: note.submittedAt,
    acceptedAt: note.acceptedAt,
    rejectedAt: note.rejectedAt,
    rejectionReason: note.rejectionReason,
    sallaSyncStatus: note.sallaSyncStatus,
    createdAt: note.createdAt,
    designModel: note.designModel ? { id: note.designModel.id, sku: note.designModel.sku } : undefined,
  };
}

// Sum of signed ledger movements for a fabric held by this tailor (new-style ledger rows only).
async function getLedgerBalance(fabricId: string, tailorId: string) {
  const agg = await prisma.tailorFabricIssue.aggregate({
    where: { fabricId, tailorId, location: 'TAILOR', quantityDelta: { not: null } },
    _sum: { quantityDelta: true },
  });
  return toNumber(agg._sum.quantityDelta, 0);
}

async function requireTailor() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { error: NextResponse.json({ error: 'يجب تسجيل الدخول للوصول إلى لوحة الخياط' }, { status: 401 }) };
  }
  if (!hasServiceAccess(session, TAILOR_SERVICE)) {
    return { error: NextResponse.json({ error: 'لا تملك صلاحية الوصول للوحة الخياط' }, { status: 403 }) };
  }
  const userId = (session.user as any)?.id;
  const tailor = userId ? await prisma.tailor.findUnique({ where: { orderUserId: userId } }) : null;
  if (!tailor || !tailor.isActive) {
    return {
      error: NextResponse.json({ error: 'لا يوجد حساب خياط نشط مرتبط بهذا المستخدم' }, { status: 403 }),
    };
  }
  return { session, tailor };
}

export async function GET() {
  try {
    const access = await requireTailor();
    if (access.error) return access.error;
    const { tailor } = access;

    const [fabrics, ledgerAgg, legacyOpenIssues, deliveryNotes, models, purchaseInvoices] = await Promise.all([
      prisma.fabric.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.tailorFabricIssue.groupBy({
        by: ['fabricId'],
        where: { tailorId: tailor.id, location: 'TAILOR', quantityDelta: { not: null } },
        _sum: { quantityDelta: true },
      }),
      prisma.tailorFabricIssue.findMany({
        where: { tailorId: tailor.id, movementType: 'LEGACY_ISSUE', status: { not: 'closed' } },
      }),
      prisma.deliveryNote.findMany({
        where: { tailorId: tailor.id },
        include: { designModel: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.designModel.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.purchaseInvoice
        .findMany({ where: { tailorId: tailor.id }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 50 })
        .catch(() => [] as Awaited<ReturnType<typeof prisma.purchaseInvoice.findMany>>),
    ]);

    const heldByFabric = new Map<string, number>();
    for (const row of ledgerAgg) heldByFabric.set(row.fabricId, toNumber(row._sum.quantityDelta, 0));
    for (const issue of legacyOpenIssues) {
      const remaining = toNumber(issue.issuedLength) - toNumber(issue.consumedLength) - toNumber(issue.returnedLength);
      heldByFabric.set(issue.fabricId, (heldByFabric.get(issue.fabricId) || 0) + remaining);
    }

    return NextResponse.json({
      tailor: { id: tailor.id, name: tailor.name, workshopName: tailor.workshopName },
      fabrics: fabrics.map((fabric) => ({ ...serializeFabric(fabric), heldByMe: heldByFabric.get(fabric.id) || 0 })),
      models: models.map(serializeModel),
      deliveryNotes: deliveryNotes.map(serializeDeliveryNote),
      purchaseInvoices: purchaseInvoices.map(serializePurchaseInvoice),
    });
  } catch (error) {
    console.error('Error fetching tailor portal data:', error);
    return NextResponse.json({ error: 'فشل في جلب بيانات لوحة الخياط' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireTailor();
    if (access.error) return access.error;
    const { tailor } = access;

    const body = await request.json();
    const action = body.action;

    if (action === 'create-purchase-bill') {
      const billNumber = cleanText(body.billNumber);
      const purchaseDate = cleanText(body.purchaseDate);
      const lengthUnit = body.lengthUnit === 'yard' ? 'yard' : 'meter';
      const supplier = cleanText(body.supplier) || null;
      const items = Array.isArray(body.items) ? body.items : [];

      if (!billNumber) return NextResponse.json({ error: 'رقم فاتورة الشراء مطلوب' }, { status: 400 });
      if (!purchaseDate || Number.isNaN(new Date(purchaseDate).getTime())) {
        return NextResponse.json({ error: 'تاريخ الشراء مطلوب' }, { status: 400 });
      }
      if (!items.length) return NextResponse.json({ error: 'أضف قماشاً واحداً على الأقل للفاتورة' }, { status: 400 });

      const result = await prisma.$transaction(async (tx) => {
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
            item?.unitCost !== undefined && item?.unitCost !== '' ? costToPerMeter(item.unitCost, lengthUnit) : new Prisma.Decimal(0);
          const vatRate = new Prisma.Decimal(0.15);

          const existingFabric = fabricId
            ? await tx.fabric.findUnique({ where: { id: fabricId } })
            : sku
              ? await tx.fabric.findUnique({ where: { sku } })
              : null;
          if (fabricId && !existingFabric) throw new Error(`القماش المحدد في ${rowLabel} غير موجود`);

          let fabric;
          if (existingFabric) {
            fabric = await tx.fabric.update({
              where: { id: existingFabric.id },
              data: {
                stockLength: { increment: purchasedLength },
                supplier: supplier || existingFabric.supplier,
                color: cleanText(item?.color) || existingFabric.color,
                unitCost: unitCost.greaterThan(0) ? unitCost : existingFabric.unitCost,
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
            enteredLocation: 'TAILOR',
            tailorId: tailor.id,
            items: { createMany: { data: itemRows.map((row) => row.data) } },
          },
          include: { items: true },
        });

        for (const row of itemRows) {
          const invoiceItem = invoice.items.find((entry) => entry.fabricId === row.fabricId);
          await tx.tailorFabricIssue.create({
            data: {
              fabricId: row.fabricId,
              tailorId: tailor.id,
              issuedLength: row.quantity,
              unitCostAtIssue: row.unitCost,
              movementType: 'TAILOR_PURCHASE',
              location: 'TAILOR',
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
        { fabrics: result.fabrics.map(serializeFabric), invoice: serializePurchaseInvoice(result.invoice) },
        { status: 201 }
      );
    }

    if (action === 'tailor-stock-adjustment') {
      const fabricId = String(body.fabricId || '');
      const delta = lengthToMeters(body.delta, body.lengthUnit, 'الكمية المعدَّلة');
      if (!fabricId) return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });

      const fabric = await prisma.fabric.findUnique({ where: { id: fabricId } });
      if (!fabric) return NextResponse.json({ error: 'القماش غير موجود' }, { status: 404 });

      await prisma.$transaction(async (tx) => {
        await tx.fabric.update({ where: { id: fabricId }, data: { stockLength: { increment: delta } } });
        await tx.tailorFabricIssue.create({
          data: {
            fabricId,
            tailorId: tailor.id,
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

      const balance = await getLedgerBalance(fabricId, tailor.id);
      return NextResponse.json({ fabricId, heldBalance: balance });
    }

    if (action === 'create-model') {
      const sku = cleanText(body.sku);
      if (!sku) return NextResponse.json({ error: 'رقم الصنف (SKU) مطلوب' }, { status: 400 });

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

      const imageData =
        typeof body.imageData === 'string' && body.imageData.startsWith('data:image/') ? body.imageData : null;
      if (imageData && imageData.length > MAX_IMAGE_DATA_LENGTH) {
        return NextResponse.json({ error: 'حجم الصورة كبير جداً (الحد الأقصى ~2 ميجابايت)' }, { status: 400 });
      }

      try {
        const model = await prisma.designModel.create({
          data: {
            sku,
            status: 'active',
            description: cleanText(body.description) || null,
            size: cleanText(body.size) || null,
            unit,
            colors: [],
            imageData,
            recipe,
            accessories: [],
            tailoringCost: toDecimal(body.tailoringCost),
            embroideryCost: toDecimal(0),
            extraCost: toDecimal(body.extraCost),
          },
        });
        return NextResponse.json(serializeModel(model), { status: 201 });
      } catch (createError: any) {
        if (createError?.code === 'P2002') {
          return NextResponse.json({ error: `رقم الصنف ${sku} مستخدم بالفعل` }, { status: 409 });
        }
        throw createError;
      }
    }

    if (action === 'create-delivery-note') {
      const designModelId = String(body.designModelId || '');
      const dressCount = Math.max(1, Math.trunc(toNumber(body.dressCount, 1)));
      if (!designModelId) return NextResponse.json({ error: 'الموديل مطلوب' }, { status: 400 });

      const model = await prisma.designModel.findUnique({ where: { id: designModelId } });
      if (!model) return NextResponse.json({ error: 'الموديل غير موجود' }, { status: 404 });

      const unit = model.unit || 'meter';
      const recipe = Array.isArray(model.recipe) ? (model.recipe as any[]) : [];
      const fabricIds = recipe.map((row) => String(row.fabricId || '')).filter(Boolean);
      const fabricsUsed = await prisma.fabric.findMany({ where: { id: { in: fabricIds } } });
      const fabricLookup = new Map(fabricsUsed.map((f) => [f.id, f]));

      const fabricsSnapshot = recipe
        .map((row) => {
          const fabricId = String(row.fabricId || '');
          const fabric = fabricLookup.get(fabricId);
          const consumption = toNumber(row.consumption);
          const meters = consumptionToMeters(row.consumption, unit) * dressCount;
          if (!fabric || meters <= 0) return null;
          return { fabricId, name: fabric.name, consumption, meters, unitCost: toNumber(fabric.unitCost) };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      const note = await prisma.deliveryNote.create({
        data: {
          noteNumber: `DN-${Date.now().toString(36).toUpperCase()}`,
          tailorId: tailor.id,
          designModelId,
          dressCount,
          size: body.size ? String(body.size) : model.size,
          status: 'DRAFT',
          tailoringCost: toDecimal(body.tailoringCost ?? model.tailoringCost),
          embroideryCost: toDecimal(body.embroideryCost ?? model.embroideryCost),
          extraCost: toDecimal(body.extraCost ?? model.extraCost),
          componentsConsumed: { fabrics: fabricsSnapshot, accessories: [] },
          notes: cleanText(body.notes) || null,
        },
        include: { designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(note), { status: 201 });
    }

    if (action === 'submit-delivery-note') {
      const noteId = String(body.noteId || '');
      if (!noteId) return NextResponse.json({ error: 'مذكرة التسليم مطلوبة' }, { status: 400 });

      const note = await prisma.deliveryNote.findUnique({ where: { id: noteId } });
      if (!note || note.tailorId !== tailor.id) {
        return NextResponse.json({ error: 'مذكرة التسليم غير موجودة' }, { status: 404 });
      }
      if (note.status !== 'DRAFT') {
        return NextResponse.json({ error: 'لا يمكن تسليم مذكرة غير مسودة' }, { status: 409 });
      }

      const snapshot = (note.componentsConsumed as any) || { fabrics: [] };
      for (const line of snapshot.fabrics || []) {
        const balance = await getLedgerBalance(line.fabricId, tailor.id);
        if (balance < line.meters) {
          return NextResponse.json(
            { error: `كمية القماش "${line.name}" لديك غير كافية لهذه الدفعة` },
            { status: 409 }
          );
        }
      }

      const updated = await prisma.deliveryNote.update({
        where: { id: noteId },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
        include: { designModel: true },
      });

      return NextResponse.json(serializeDeliveryNote(updated));
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (error: any) {
    console.error('Error in tailor portal action:', error);
    return NextResponse.json({ error: error?.message || 'فشل تنفيذ الإجراء' }, { status: 500 });
  }
}
