import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

function toNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
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

    const [fabrics, requests] = await Promise.all([
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
    ]);

    return NextResponse.json({
      tailor: {
        id: tailor.id,
        name: tailor.name,
        workshopName: tailor.workshopName,
      },
      fabrics: fabrics.map(serializeFabric),
      requests: requests.map(serializeRequest),
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
    const fabricId = String(body.fabricId || '');
    const requestedLength = toNumber(body.requestedLength, NaN);

    if (!accessCode || !fabricId || !Number.isFinite(requestedLength) || requestedLength <= 0) {
      return NextResponse.json(
        { error: 'رمز الدخول والقماش والكمية المطلوبة مطلوبة' },
        { status: 400 }
      );
    }

    const tailor = await findTailor(accessCode);
    if (!tailor) {
      return NextResponse.json({ error: 'رمز الدخول غير صحيح أو غير مفعل' }, { status: 401 });
    }

    const fabric = await prisma.fabric.findFirst({
      where: { id: fabricId, isActive: true },
    });
    if (!fabric) {
      return NextResponse.json({ error: 'القماش غير متاح' }, { status: 404 });
    }

    const createdRequest = await prisma.tailorFabricRequest.create({
      data: {
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
