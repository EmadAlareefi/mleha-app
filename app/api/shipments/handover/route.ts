import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasWarehouseFeatureAccess, resolveWarehouseIds } from '@/app/api/shipments/utils';

function isToday(date: Date) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return date >= startOfDay && date <= endOfDay;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول لإتمام التسليم' }, { status: 401 });
    }

    if (!hasWarehouseFeatureAccess(session)) {
      return NextResponse.json({ error: 'لا تملك صلاحية استخدام هذا القارئ' }, { status: 403 });
    }

    const role = (session.user as any)?.role;
    const roles = ((session.user as any)?.roles || [role]) as string[];
    const isWarehouseUser = roles.includes('warehouse');

    const body = await request.json();
    const trackingNumber = String(body?.trackingNumber || '').trim();
    const warehouseId = typeof body?.warehouseId === 'string' ? body.warehouseId : null;

    if (!trackingNumber) {
      return NextResponse.json({ error: 'رقم التتبع مطلوب' }, { status: 400 });
    }

    if (!warehouseId) {
      return NextResponse.json({ error: 'يرجى تحديد المستودع' }, { status: 400 });
    }

    if (isWarehouseUser) {
      const allowedWarehouseIds = await resolveWarehouseIds(session);
      if (!allowedWarehouseIds.includes(warehouseId)) {
        return NextResponse.json(
          { error: 'لا تملك صلاحية لمعالجة هذا المستودع' },
          { status: 403 }
        );
      }
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const shipment = await prisma.shipment.findFirst({
      where: {
        trackingNumber,
        warehouseId,
        scannedAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    if (!shipment) {
      return NextResponse.json(
        {
          outcome: 'missing_first_scan',
          message: 'لم يتم تسجيل هذه الشحنة اليوم',
        },
        { status: 404 }
      );
    }

    if (!isToday(shipment.scannedAt)) {
      return NextResponse.json(
        {
          outcome: 'missing_first_scan',
          message: 'هذه الشحنة مسجلة في يوم مختلف',
        },
        { status: 404 }
      );
    }

    if (shipment.handoverScannedAt) {
      return NextResponse.json({
        outcome: 'already_confirmed',
        shipment: {
          ...shipment,
          scannedAt: shipment.scannedAt.toISOString(),
          handoverScannedAt: shipment.handoverScannedAt?.toISOString() ?? null,
        },
        message: 'تم تأكيد هذه الشحنة مسبقاً',
      });
    }

    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        handoverScannedAt: new Date(),
        handoverScannedBy:
          (session.user as any)?.username ||
          (session.user as any)?.name ||
          (session.user as any)?.id ||
          null,
      },
    });

    return NextResponse.json({
      outcome: 'confirmed',
      shipment: {
        ...updated,
        scannedAt: updated.scannedAt.toISOString(),
        handoverScannedAt: updated.handoverScannedAt?.toISOString() ?? null,
      },
      message: 'تم تأكيد تسليم الشحنة بنجاح',
    });
  } catch (error) {
    console.error('Error confirming shipment handover:', error);
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تأكيد تسليم الشحنة' },
      { status: 500 }
    );
  }
}
