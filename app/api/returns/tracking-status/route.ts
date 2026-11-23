import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { syncReturnShipment } from '@/app/lib/returns/return-shipment-sync';

export const runtime = 'nodejs';

const WAYBILL_STUCK_AFTER_MS = 2 * 60 * 1000;

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
        smsaResponse: true,
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

    // Salla normally issues the waybill within a minute or two. Past the
    // threshold the customer is told plainly instead of watching a spinner, and
    // staff get a log line to chase; polling here keeps retrying the sync.
    const stuck = Date.now() - returnRequest.createdAt.getTime() > WAYBILL_STUCK_AFTER_MS;
    if (stuck) {
      log.warn('Return waybill not issued yet', {
        returnRequestId: returnRequest.id,
        orderNumber: returnRequest.orderNumber,
        minutes: Math.round((Date.now() - returnRequest.createdAt.getTime()) / 60000),
      });
    }
    return NextResponse.json({ ready: false, trackingNumber: null, stuck });
  } catch (error) {
    log.error('Error checking return tracking status', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء التحقق من حالة الشحنة' },
      { status: 500 }
    );
  }
}
