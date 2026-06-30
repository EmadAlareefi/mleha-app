import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';

const YARD_TO_METER = 0.9144;
const MAX_IMAGE_DATA_LENGTH = 3_000_000; // ~2.2MB base64 string

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function lengthToMeters(value: unknown, unit: unknown) {
  const length = toNumber(value, NaN);
  if (!Number.isFinite(length) || length <= 0) {
    return NaN;
  }
  return unit === 'yard' ? length * YARD_TO_METER : length;
}

function costToPerMeter(value: unknown, unit: unknown) {
  const cost = toNumber(value, 0);
  return unit === 'yard' ? cost / YARD_TO_METER : cost;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeFabric(fabric: any) {
  return {
    id: fabric.id,
    name: fabric.name,
    sku: fabric.sku,
    color: fabric.color,
    fabricType: fabric.fabricType,
    stockLength: toNumber(fabric.stockLength),
    isLowStock: toNumber(fabric.stockLength) <= toNumber(fabric.minStock),
  };
}

function serializeRequest(request: any) {
  return {
    id: request.id,
    requestedLength: toNumber(request.requestedLength),
    requestType: request.requestType,
    purchaseName: request.purchaseName,
    purchaseSku: request.purchaseSku,
    purchaseColor: request.purchaseColor,
    purchaseFabricType: request.purchaseFabricType,
    purchaseSupplier: request.purchaseSupplier,
    purchaseUnitCost: request.purchaseUnitCost === null || request.purchaseUnitCost === undefined
      ? null
      : toNumber(request.purchaseUnitCost),
    status: request.status,
    notes: request.notes,
    createdAt: request.createdAt,
    fabric: request.fabric ? serializeFabric(request.fabric) : undefined,
  };
}

async function findTailor(accessCode: string) {
  return prisma.tailor.findFirst({
    where: {
      accessCode,
      isActive: true,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accessCode = searchParams.get('accessCode')?.trim();

    if (!accessCode) {
      return NextResponse.json({ error: 'رمز الدخول مطلوب' }, { status: 400 });
    }

    const tailor = await findTailor(accessCode);
    if (!tailor) {
      return NextResponse.json({ error: 'رمز الدخول غير صحيح أو غير مفعل' }, { status: 401 });
    }

    const [fabrics, requests, repeatRequests] = await Promise.all([
      prisma.fabric.findMany({
        where: { isActive: true },
        orderBy: [{ stockLength: 'desc' }, { name: 'asc' }],
      }),
      prisma.tailorFabricRequest.findMany({
        where: { tailorId: tailor.id },
        include: { fabric: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.repeatRequest.findMany({
        where: { tailorId: tailor.id },
        include: { designModel: true, sizes: { orderBy: { label: 'asc' } } },
        orderBy: [{ stage: 'asc' }, { updatedAt: 'desc' }],
      }),
    ]);

    return NextResponse.json({
      tailor: {
        id: tailor.id,
        name: tailor.name,
        workshopName: tailor.workshopName,
      },
      fabrics: fabrics.map(serializeFabric),
      requests: requests.map(serializeRequest),
      repeatRequests: repeatRequests.map((rr) => ({
        id: rr.id,
        sku: rr.designModel.sku,
        stage: rr.stage,
        modelCount: rr.modelCount,
        totalCount: rr.modelCount + rr.sizes.reduce((sum, s) => sum + s.count, 0),
        repeatDate: rr.repeatDate ? rr.repeatDate.toISOString() : null,
        sizes: rr.sizes.map((s) => ({ id: s.id, label: s.label, count: s.count })),
      })),
    });
  } catch (error) {
    console.error('Error fetching tailor gate data:', error);
    return NextResponse.json({ error: 'فشل في جلب بيانات بوابة الخياط' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const accessCode = String(body.accessCode || '').trim();
    const action = String(body.action || 'request-fabric');

    // Tailor marks a tracked repeat order as made (stage 2 -> 3). Handled before
    // the fabric-request validation below, which this action does not use.
    if (action === 'repeat-mark-made') {
      if (!accessCode) {
        return NextResponse.json({ error: 'رمز الدخول مطلوب' }, { status: 400 });
      }
      const tailor = await findTailor(accessCode);
      if (!tailor) {
        return NextResponse.json({ error: 'رمز الدخول غير صحيح أو غير مفعل' }, { status: 401 });
      }
      const repeatRequestId = String(body.repeatRequestId || '').trim();
      const rr = await prisma.repeatRequest.findUnique({ where: { id: repeatRequestId } });
      if (!rr || rr.tailorId !== tailor.id) {
        return NextResponse.json({ error: 'طلب التكرار غير موجود' }, { status: 404 });
      }
      if (rr.stage !== 2) {
        return NextResponse.json({ error: 'يمكن تعليم "تم الصنع" فقط بعد طلب المسؤول' }, { status: 409 });
      }
      await prisma.$transaction(async (tx) => {
        await tx.repeatRequest.update({ where: { id: rr.id }, data: { stage: 3 } });
        await tx.repeatRequestLog.create({
          data: { repeatRequestId: rr.id, actor: tailor.name, action: 'تغيير المرحلة', detail: 'تم الصنع' },
        });
      });
      return NextResponse.json({ ok: true });
    }

    // Tailor submits a multi-line purchase invoice. Each line becomes one pending
    // `purchase` request so the admin can review/approve it (which then increments
    // Fabric stock) through the existing fabric-management flow. Handled before the
    // shared single-length validation below, since lines carry their own lengths.
    if (action === 'create-purchase-invoice') {
      if (!accessCode) {
        return NextResponse.json({ error: 'رمز الدخول مطلوب' }, { status: 400 });
      }
      const tailor = await findTailor(accessCode);
      if (!tailor) {
        return NextResponse.json({ error: 'رمز الدخول غير صحيح أو غير مفعل' }, { status: 401 });
      }

      const billNumber = cleanText(body.billNumber);
      const purchaseDate = cleanText(body.purchaseDate);
      const supplier = cleanText(body.supplier) || null;
      const lengthUnit = body.lengthUnit === 'yard' ? 'yard' : 'meter';
      const items = Array.isArray(body.items) ? body.items : [];

      if (!billNumber) {
        return NextResponse.json({ error: 'رقم الفاتورة مطلوب' }, { status: 400 });
      }
      if (!items.length) {
        return NextResponse.json({ error: 'أضف قماشاً واحداً على الأقل للفاتورة' }, { status: 400 });
      }

      // Resolve each line up-front so a bad row aborts before any DB writes.
      const preparedLines = [] as {
        fabricId: string | null;
        purchaseName: string;
        purchaseSku: string | null;
        purchaseColor: string | null;
        requestedLength: number;
        purchaseUnitCost: number;
        notes: string;
      }[];

      for (const [index, item] of items.entries()) {
        const rowLabel = `سطر ${index + 1}`;
        const lineLength = lengthToMeters(item?.length, lengthUnit);
        if (!Number.isFinite(lineLength) || lineLength <= 0) {
          return NextResponse.json({ error: `الكمية في ${rowLabel} يجب أن تكون أكبر من صفر` }, { status: 400 });
        }

        const selectedFabricId = cleanText(item?.fabricId) || null;
        let fabric = null as Awaited<ReturnType<typeof prisma.fabric.findUnique>> | null;
        if (selectedFabricId) {
          fabric = await prisma.fabric.findUnique({ where: { id: selectedFabricId } });
          if (!fabric) {
            return NextResponse.json({ error: `القماش المحدد في ${rowLabel} غير موجود` }, { status: 404 });
          }
        }

        const purchaseName = fabric?.name || cleanText(item?.name);
        if (!purchaseName) {
          return NextResponse.json({ error: `اسم القماش مطلوب في ${rowLabel}` }, { status: 400 });
        }

        const lineNote = cleanText(item?.notes);
        const notes = [
          `فاتورة شراء ${billNumber}`,
          `تاريخ الشراء: ${purchaseDate}`,
          lineNote || null,
        ]
          .filter(Boolean)
          .join(' - ');

        preparedLines.push({
          fabricId: fabric?.id || null,
          purchaseName,
          purchaseSku: fabric?.sku || cleanText(item?.sku) || null,
          purchaseColor: fabric?.color || cleanText(item?.color) || null,
          requestedLength: lineLength,
          purchaseUnitCost: costToPerMeter(item?.unitCost, lengthUnit),
          notes,
        });
      }

      const createdRequests = await prisma.$transaction((tx) =>
        Promise.all(
          preparedLines.map((line) =>
            tx.tailorFabricRequest.create({
              data: {
                requestType: 'purchase',
                fabricId: line.fabricId,
                tailorId: tailor.id,
                requestedLength: new Prisma.Decimal(line.requestedLength),
                purchaseName: line.purchaseName,
                purchaseSku: line.purchaseSku,
                purchaseColor: line.purchaseColor,
                purchaseSupplier: supplier,
                purchaseUnitCost: new Prisma.Decimal(line.purchaseUnitCost),
                notes: line.notes,
              },
              include: { fabric: true },
            })
          )
        )
      );

      return NextResponse.json(
        { requests: createdRequests.map(serializeRequest) },
        { status: 201 }
      );
    }

    // Tailor creates a new design model (موديل) — goes live (active) immediately and
    // shows up in the admin fabric-management "الموديلات" tab. Handled before the
    // shared single-length validation below, which this action does not use.
    if (action === 'create-model') {
      if (!accessCode) {
        return NextResponse.json({ error: 'رمز الدخول مطلوب' }, { status: 400 });
      }
      const tailor = await findTailor(accessCode);
      if (!tailor) {
        return NextResponse.json({ error: 'رمز الدخول غير صحيح أو غير مفعل' }, { status: 401 });
      }

      const sku = cleanText(body.sku);
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
        return NextResponse.json(
          { error: 'أضف قماشاً واحداً على الأقل مع كمية استهلاك صحيحة' },
          { status: 400 }
        );
      }

      const imageData =
        typeof body.imageData === 'string' && body.imageData.startsWith('data:image/')
          ? body.imageData
          : null;
      if (imageData && imageData.length > MAX_IMAGE_DATA_LENGTH) {
        return NextResponse.json(
          { error: 'حجم الصورة كبير جداً (الحد الأقصى ~2 ميجابايت)' },
          { status: 400 }
        );
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
            tailoringCost: new Prisma.Decimal(toNumber(body.tailoringCost)),
            embroideryCost: new Prisma.Decimal(0),
            extraCost: new Prisma.Decimal(toNumber(body.extraCost)),
          },
        });
        return NextResponse.json({ ok: true, id: model.id, sku: model.sku }, { status: 201 });
      } catch (createError: any) {
        if (createError?.code === 'P2002') {
          return NextResponse.json({ error: `رقم الصنف ${sku} مستخدم بالفعل` }, { status: 409 });
        }
        throw createError;
      }
    }

    const requestedLength = lengthToMeters(body.requestedLength, body.lengthUnit);

    if (!accessCode || !Number.isFinite(requestedLength) || requestedLength <= 0) {
      return NextResponse.json(
        { error: 'رمز الدخول والكمية مطلوبة' },
        { status: 400 }
      );
    }

    const tailor = await findTailor(accessCode);
    if (!tailor) {
      return NextResponse.json({ error: 'رمز الدخول غير صحيح أو غير مفعل' }, { status: 401 });
    }

    const fabricId = String(body.fabricId || '');
    if (!fabricId) {
      return NextResponse.json({ error: 'القماش مطلوب' }, { status: 400 });
    }

    const fabric = await prisma.fabric.findFirst({
      where: { id: fabricId, isActive: true },
    });
    if (!fabric) {
      return NextResponse.json({ error: 'القماش غير متاح' }, { status: 404 });
    }

    const createdRequest = await prisma.tailorFabricRequest.create({
      data: {
        requestType: 'stock_request',
        fabricId,
        tailorId: tailor.id,
        requestedLength: new Prisma.Decimal(requestedLength),
        notes: body.notes || null,
      },
      include: { fabric: true },
    });

    return NextResponse.json(serializeRequest(createdRequest), { status: 201 });
  } catch (error) {
    console.error('Error creating tailor fabric request:', error);
    return NextResponse.json({ error: 'فشل في إنشاء طلب القماش' }, { status: 500 });
  }
}

// Admin-only cleanup: delete a test row directly from the DB. The gate page is a
// public path (no auth in middleware), so authorization is enforced here via the
// NextAuth session — a logged-in admin's cookie is read by getServerSession.
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { role?: string; roles?: string[] } | undefined;
    const roles = user?.roles || (user?.role ? [user.role] : []);
    if (!roles.includes('admin')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const id = searchParams.get('id')?.trim();
    if (!id) {
      return NextResponse.json({ error: 'المعرف مطلوب' }, { status: 400 });
    }

    if (type === 'request') {
      await prisma.tailorFabricRequest.delete({ where: { id } });
    } else if (type === 'repeat') {
      // RepeatRequestSize/Note/Log cascade via the schema relations.
      await prisma.repeatRequest.delete({ where: { id } });
    } else {
      return NextResponse.json({ error: 'نوع غير معروف' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error deleting tailor gate record:', error);
    return NextResponse.json({ error: 'فشل في الحذف' }, { status: 500 });
  }
}
