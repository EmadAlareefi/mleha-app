import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';

function getWarehouseIdsFromSession(session: any): string[] {
  const warehouses = (session?.user as any)?.warehouseData?.warehouses ?? [];
  return Array.isArray(warehouses) ? warehouses.map((w: any) => w.id) : [];
}

// GET /api/shipments/stats - Get shipment statistics
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول للوصول إلى الإحصاءات' },
        { status: 401 }
      );
    }

    const role = (session.user as any)?.role;
    const allowedWarehouseIds =
      role === 'warehouse' ? getWarehouseIdsFromSession(session) : null;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date'); // ISO date string
    const requestedWarehouseId = searchParams.get('warehouseId') || undefined;

    const where: any = {};

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

    // Get counts by type
    const [incoming, outgoing] = await Promise.all([
      prisma.shipment.count({
        where: { ...where, type: 'incoming' },
      }),
      prisma.shipment.count({
        where: { ...where, type: 'outgoing' },
      }),
    ]);

    // Get counts by company
    const byCompany = await prisma.shipment.groupBy({
      by: ['company'],
      where,
      _count: {
        company: true,
      },
    });

    // Get counts by company and type
    const byCompanyAndType = await prisma.shipment.groupBy({
      by: ['company', 'type'],
      where,
      _count: {
        company: true,
      },
    });

    return NextResponse.json({
      total: incoming + outgoing,
      incoming,
      outgoing,
      byCompany: byCompany.map(item => ({
        company: item.company,
        count: item._count.company,
      })),
      byCompanyAndType: byCompanyAndType.map(item => ({
        company: item.company,
        type: item.type,
        count: item._count.company,
      })),
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'فشل في جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
