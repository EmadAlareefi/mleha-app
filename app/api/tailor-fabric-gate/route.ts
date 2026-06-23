import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const YARD_TO_METER = 0.9144;

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

    if (action === 'purchase-fabric') {
      const purchaseName = cleanText(body.purchaseName);
      const purchaseSku = cleanText(body.purchaseSku) || null;
      const purchaseUnitCost = costToPerMeter(body.purchaseUnitCost, body.lengthUnit);

      if (!purchaseName) {
        return NextResponse.json({ error: 'اسم القماش المشترى مطلوب' }, { status: 400 });
      }

      const existingFabric = purchaseSku
        ? await prisma.fabric.findUnique({ where: { sku: purchaseSku } })
        : null;

      const createdRequest = await prisma.tailorFabricRequest.create({
        data: {
          requestType: 'purchase',
          fabricId: existingFabric?.id,
          tailorId: tailor.id,
          requestedLength: new Prisma.Decimal(requestedLength),
          purchaseName,
          purchaseSku,
          purchaseColor: cleanText(body.purchaseColor) || null,
          purchaseFabricType: cleanText(body.purchaseFabricType) || null,
          purchaseSupplier: cleanText(body.purchaseSupplier) || null,
          purchaseUnitCost: new Prisma.Decimal(purchaseUnitCost),
          notes: body.notes || null,
        },
        include: { fabric: true },
      });

      return NextResponse.json(serializeRequest(createdRequest), { status: 201 });
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
