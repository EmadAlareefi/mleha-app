import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { printLocalShipmentLabel } from '@/app/lib/local-shipping/print';
import { markSallaOrderCompletedAfterLocalShipment } from '@/app/lib/local-shipping/salla-status';

export const runtime = 'nodejs';

const SHIPPING_PRINTER_OVERRIDES: Record<string, number> = {
  '1': 75006700,
  '15': 75062490,
};

const parsePrinterId = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'غير مصرح لك' }, { status: 401 });
    }

    if (!hasServiceAccess(session, ['order-shipping', 'local-shipping', 'warehouse', 'shipment-assignments'])) {
      return NextResponse.json(
        { success: false, error: 'لا تملك صلاحية طباعة الشحنات المحلية' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const shipmentId = typeof body.shipmentId === 'string' ? body.shipmentId : undefined;
    const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber : undefined;
    const trackingNumber = typeof body.trackingNumber === 'string' ? body.trackingNumber : undefined;
    const requestedPrinterId = parsePrinterId(body.printerId);

    if (!shipmentId && !orderNumber && !trackingNumber) {
      return NextResponse.json(
        { success: false, error: 'يجب تحديد الشحنة عبر المعرف أو رقم الطلب أو رقم التتبع' },
        { status: 400 },
      );
    }

    const orFilters: Record<string, string>[] = [];
    if (shipmentId) orFilters.push({ id: shipmentId });
    if (orderNumber) orFilters.push({ orderNumber });
    if (trackingNumber) orFilters.push({ trackingNumber });

    const shipment = await prisma.localShipment.findFirst({
      where: {
        OR: orFilters,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!shipment) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على الشحنة المحلية المطلوبة' },
        { status: 404 },
      );
    }

    const user = session.user as any;
    let printerLink: {
      printerId: number;
      printerName: string | null;
    } | null = null;

    if (user?.id) {
      try {
        printerLink = await prisma.orderUserPrinterLink.findUnique({
          where: { userId: user.id },
          select: {
            printerId: true,
            printerName: true,
          },
        });
      } catch (error) {
        log.warn('Failed to load printer link for user while printing local shipment', {
          userId: user.id,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    const fallbackPrinterId =
      typeof user?.username === 'string' ? SHIPPING_PRINTER_OVERRIDES[user.username] : undefined;
    const resolvedPrinterId = requestedPrinterId ?? printerLink?.printerId ?? fallbackPrinterId;

    const printResult = await printLocalShipmentLabel({
      shipment,
      printerId: resolvedPrinterId,
      triggeredBy: user?.username || user?.id || 'order-shipping',
      userId: user?.id,
      userName: user?.name || user?.username,
      source: 'order-shipping-manual',
    });

    if (!printResult.success) {
      return NextResponse.json(
        { success: false, error: printResult.error || 'فشل إرسال البوليصة للطابعة' },
        { status: 502 },
      );
    }

    const statusResult = await markSallaOrderCompletedAfterLocalShipment({
      merchantId: shipment.merchantId,
      orderId: shipment.orderId,
      shipmentId: shipment.id,
      orderNumber: shipment.orderNumber,
      trackingNumber: shipment.trackingNumber,
      action: 'local-shipping-print',
    });

    return NextResponse.json({
      success: true,
      message: 'تم إرسال البوليصة المحلية للطابعة',
      data: {
        labelUrl: printResult.labelUrl,
        labelPrinted: true,
        labelPrintedAt: printResult.labelPrintedAt ?? new Date().toISOString(),
        printJobId: printResult.jobId ?? null,
        printCount: printResult.printCount ?? 1,
      },
      sallaStatusUpdated: statusResult.success,
    });
  } catch (error) {
    log.error('Unexpected error while sending local shipment to printer', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء إرسال البوليصة للطابعة' },
      { status: 500 },
    );
  }
}
