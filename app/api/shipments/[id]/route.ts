import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';

function getWarehouseIdsFromSession(session: any): string[] {
  const warehouses = (session?.user as any)?.warehouseData?.warehouses ?? [];
  return Array.isArray(warehouses) ? warehouses.map((w: any) => w.id) : [];
}

// DELETE /api/shipments/[id] - Delete a shipment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول لحذف الشحنات' },
        { status: 401 }
      );
    }

    const role = (session.user as any)?.role;
    if (role !== 'admin' && role !== 'warehouse') {
      return NextResponse.json(
        { error: 'لا تملك صلاحية لحذف الشحنات' },
        { status: 403 }
      );
    }

    const { id } = await params;

    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: {
        id: true,
        warehouseId: true,
      },
    });

    if (!shipment) {
      return NextResponse.json(
        { error: 'الشحنة غير موجودة' },
        { status: 404 }
      );
    }

    if (role === 'warehouse') {
      const allowedWarehouseIds = getWarehouseIdsFromSession(session);
      if (
        !shipment.warehouseId ||
        !allowedWarehouseIds.includes(shipment.warehouseId)
      ) {
        return NextResponse.json(
          { error: 'لا تملك صلاحية لحذف هذه الشحنة' },
          { status: 403 }
        );
      }
    }

    await prisma.shipment.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting shipment:', error);
    return NextResponse.json(
      { error: 'فشل في حذف الشحنة' },
      { status: 500 }
    );
  }
}
