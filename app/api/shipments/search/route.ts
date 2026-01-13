import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';


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
    const roles = ((session.user as any)?.roles || [role]) as string[];
    const hasWarehouseRole = roles.includes('warehouse');

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

    // Apply warehouse selection when available
    if (requestedWarehouseId) {
      where.warehouseId = requestedWarehouseId;
    } else if (hasWarehouseRole) {
      where.warehouseId = {
        not: null,
      };
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
