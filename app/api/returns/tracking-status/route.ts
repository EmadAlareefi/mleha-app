import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { syncReturnShipment } from '@/app/lib/returns/return-shipment-sync';

export const runtime = 'nodejs';

/**
 * GET /api/returns/tracking-status
 *
 * Lightweight endpoint the customer can poll while Salla issues the return
 * waybill (بوليصة الرجيع) asynchronously after a `create_return_policy` action.
 * Returns the tracking number as soon as it is available, backfilling it onto
 * the return request so subsequent loads are instant.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const returnRequestId = searchParams.get('returnRequestId');

    if (!returnRequestId) {
      return NextResponse.json(
        { error: 'returnRequestId is required' },
        { status: 400 }
      );
    }

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      select: {
        id: true,
        merchantId: true,
        orderId: true,
        orderNumber: true,
        createdAt: true,
        smsaTrackingNumber: true,
        returnLabelUrl: true,
        returnLabelNotificationSentAt: true,
      },
    });

    if (!returnRequest) {
      return NextResponse.json(
        { error: 'لم يتم العثور على طلب الإرجاع' },
        { status: 404 }
      );
    }

    if (returnRequest.smsaTrackingNumber) {
      return NextResponse.json({
        ready: true,
        trackingNumber: returnRequest.smsaTrackingNumber,
      });
    }

    // The full sync, not just the tracking number: while the customer waits on
    // the success screen this is often the first place the label shows up, and
    // it is what actually gets the بوليصة onto their WhatsApp.
    const sync = await syncReturnShipment(returnRequest, { source: 'returns-tracking-status' });

    if (sync.trackingNumber) {
      return NextResponse.json({ ready: true, trackingNumber: sync.trackingNumber });
    }

    return NextResponse.json({ ready: false, trackingNumber: null });
  } catch (error) {
    log.error('Error checking return tracking status', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء التحقق من حالة الشحنة' },
      { status: 500 }
    );
  }
}
