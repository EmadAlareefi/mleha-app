import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { detectShipmentCompany, isValidTrackingNumber } from '@/lib/shipment-detector';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';

function getWarehouseIdsFromSession(session: any): string[] {
  const warehouses = (session?.user as any)?.warehouseData?.warehouses ?? [];
  return Array.isArray(warehouses) ? warehouses.map((w: any) => w.id) : [];
}

// GET /api/shipments - Get all shipments with optional filtering
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى الشحنات' },
        { status: 401 }
      );
    }

    const role = (session.user as any)?.role;
    const allowedWarehouseIds =
      role === 'warehouse' ? getWarehouseIdsFromSession(session) : null;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'incoming' or 'outgoing'
    const company = searchParams.get('company');
    const date = searchParams.get('date'); // ISO date string
    const limit = parseInt(searchParams.get('limit') || '100');
    const requestedWarehouseId = searchParams.get('warehouseId') || undefined;

    const where: any = {};

    if (type) {
      where.type = type;
    }

    if (company) {
      where.company = company;
    }

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      where.scannedAt = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }

    if (role === 'warehouse') {
      if (!allowedWarehouseIds || allowedWarehouseIds.length === 0) {
        return NextResponse.json(
          { error: 'لم يتم ربط أي مستودع بحسابك' },
          { status: 403 }
        );
      }
      if (requestedWarehouseId) {
        if (!allowedWarehouseIds.includes(requestedWarehouseId)) {
          return NextResponse.json(
            { error: 'لا تملك صلاحية الوصول لهذا المستودع' },
            { status: 403 }
          );
        }
        where.warehouseId = requestedWarehouseId;
      } else {
        where.warehouseId = { in: allowedWarehouseIds };
      }
    } else if (requestedWarehouseId) {
      where.warehouseId = requestedWarehouseId;
    }

    const shipments = await prisma.shipment.findMany({
      where,
      orderBy: {
        scannedAt: 'desc',
      },
      take: limit,
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    return NextResponse.json(shipments);
  } catch (error) {
    console.error('Error fetching shipments:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الشحنات' },
      { status: 500 }
    );
  }
}

// POST /api/shipments - Create a new shipment
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول لتسجيل الشحنات' },
        { status: 401 }
      );
    }

    const role = (session.user as any)?.role;
    if (role !== 'admin' && role !== 'warehouse') {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لتسجيل الشحنات' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { trackingNumber, type, scannedBy, notes, warehouseId } = body;

    // Validate tracking number
    if (!trackingNumber || !isValidTrackingNumber(trackingNumber)) {
      return NextResponse.json(
        { error: 'رقم التتبع غير صالح' },
        { status: 400 }
      );
    }

    // Validate type
    if (!type || (type !== 'incoming' && type !== 'outgoing')) {
      return NextResponse.json(
        { error: 'نوع الشحنة يجب أن يكون وارد أو صادر' },
        { status: 400 }
      );
    }

    if (!warehouseId || typeof warehouseId !== 'string') {
      return NextResponse.json(
        { error: 'يجب تحديد المستودع المرتبط بالشحنة' },
        { status: 400 }
      );
    }

    const allowedWarehouseIds =
      role === 'warehouse' ? getWarehouseIdsFromSession(session) : null;

    if (role === 'warehouse') {
      if (!allowedWarehouseIds || !allowedWarehouseIds.includes(warehouseId)) {
        return NextResponse.json(
          { error: 'لا تملك صلاحية لتسجيل شحنات لهذا المستودع' },
          { status: 403 }
        );
      }
    }

    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, isActive: true },
      select: { id: true, name: true },
    });

    if (!warehouse) {
      return NextResponse.json(
        { error: 'المستودع المحدد غير موجود أو غير نشط' },
        { status: 400 }
      );
    }

    // Check if tracking number already exists
    const existing = await prisma.shipment.findUnique({
      where: { trackingNumber: trackingNumber.trim() },
    });

    if (existing) {
      return NextResponse.json(
        {
          error: 'رقم التتبع موجود مسبقاً',
          existing: existing
        },
        { status: 409 }
      );
    }

    // Detect company
    const company = detectShipmentCompany(trackingNumber);

    // Create shipment
    const shipment = await prisma.shipment.create({
      data: {
        trackingNumber: trackingNumber.trim(),
        company: company.id,
        type,
        warehouseId,
        scannedBy:
          scannedBy ||
          (session.user as any)?.username ||
          (session.user as any)?.name ||
          (session.user as any)?.id ||
          null,
        notes,
      },
      include: {
        warehouse: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    // If this is an incoming shipment, check if it's linked to a return request
    if (type === 'incoming') {
      const returnRequest = await prisma.returnRequest.findUnique({
        where: { smsaTrackingNumber: trackingNumber.trim() },
      });

      if (returnRequest) {
        // Update return request status to 'delivered'
        await prisma.returnRequest.update({
          where: { id: returnRequest.id },
          data: {
            status: 'delivered',
            updatedAt: new Date(),
          },
        });

        console.log(`Updated return request ${returnRequest.id} status to 'delivered'`);
      }
    }

    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    console.error('Error creating shipment:', error);
    return NextResponse.json(
      { error: 'فشل في إنشاء الشحنة' },
      { status: 500 }
    );
  }
}
