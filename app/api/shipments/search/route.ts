import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';

function getWarehouseIdsFromSession(session: any): string[] {
  const warehouses = (session?.user as any)?.warehouseData?.warehouses ?? [];
  return Array.isArray(warehouses) ? warehouses.map((w: any) => w.id) : [];
}

// GET /api/shipments/search - Search for a shipment by tracking number
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
    const trackingNumber = searchParams.get('trackingNumber');
    const requestedWarehouseId = searchParams.get('warehouseId') || undefined;

    if (!trackingNumber || !trackingNumber.trim()) {
      return NextResponse.json(
        { error: 'يجب إدخال رقم التتبع للبحث' },
        { status: 400 }
      );
    }

    const where: any = {
      trackingNumber: {
        contains: trackingNumber.trim(),
        mode: 'insensitive',
      },
    };

    // Apply warehouse access control
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
      take: 10, // Limit to 10 results
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

    if (shipments.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على شحنات بهذا الرقم' },
        { status: 404 }
      );
    }

    return NextResponse.json(shipments);
  } catch (error) {
    console.error('Error searching shipments:', error);
    return NextResponse.json(
      { error: 'فشل في البحث عن الشحنات' },
      { status: 500 }
    );
  }
}
