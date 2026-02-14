import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { detectShipmentCompany, isValidTrackingNumber } from '@/lib/shipment-detector';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { resolveWarehouseIds } from '@/app/api/shipments/utils';

function hasWarehouseFeatureAccess(session: any) {
  if (!session?.user) {
    return false;
  }

  if (
    hasServiceAccess(session, [
      'warehouse',
      'local-shipping',
      'shipment-assignments',
      'returns-inspection',
    ])
  ) {
    return true;
  }

  const primaryRole = (session.user as any)?.role;
  if (primaryRole === 'admin' || primaryRole === 'warehouse') {
    return true;
  }
  const roles = ((session.user as any)?.roles || []) as string[];
  return roles.includes('admin') || roles.includes('warehouse');
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

    if (!hasWarehouseFeatureAccess(session)) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لعرض الشحنات' },
        { status: 403 }
      );
    }

    const role = (session.user as any)?.role;
    const roles = ((session.user as any)?.roles || [role]) as string[];
    const hasWarehouseRole = roles.includes('warehouse');

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'incoming' or 'outgoing'
    const company = searchParams.get('company');
    const date = searchParams.get('date'); // ISO date string
    const limitParam = searchParams.get('limit');
    const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : NaN;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
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

    if (requestedWarehouseId) {
      where.warehouseId = requestedWarehouseId;
    } else if (hasWarehouseRole) {
      where.warehouseId = {
        not: null,
      };
    }

    const shipmentsQuery: Parameters<typeof prisma.shipment.findMany>[0] = {
      where,
      orderBy: {
        scannedAt: 'desc',
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
    };

    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      shipmentsQuery.take = limit;
    }

    const shipments = await prisma.shipment.findMany(shipmentsQuery);

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

    if (!hasWarehouseFeatureAccess(session)) {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لتسجيل الشحنات' },
        { status: 403 }
      );
    }

    const role = (session.user as any)?.role;
    const roles = ((session.user as any)?.roles || [role]) as string[];
    const isWarehouseUser = roles.includes('warehouse');

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
      isWarehouseUser ? await resolveWarehouseIds(session) : null;

    if (isWarehouseUser) {
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

        // Update Salla order status to 'restoring' (قيد الاسترجاع)
        try {
          const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
          const accessToken = await getSallaAccessToken(returnRequest.merchantId);

          if (accessToken) {
            const baseUrl = 'https://api.salla.dev/admin/v2';
            const url = `${baseUrl}/orders/${returnRequest.orderId}/status`;

            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ slug: 'restoring' }),
            });

            if (response.ok) {
              console.log(`Salla order status updated to restoring for order ${returnRequest.orderId}`);
            } else {
              const errorText = await response.text();
              console.warn(`Failed to update Salla order status to restoring: ${errorText}`);
            }
          }
        } catch (error) {
          console.error('Error updating Salla order status to restoring:', error);
          // Continue even if Salla update fails
        }
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
