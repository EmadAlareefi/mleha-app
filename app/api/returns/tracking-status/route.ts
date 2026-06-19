import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrderShipments } from '@/app/lib/salla-api';
import { extractTrackingFromShipment } from '@/app/lib/salla-shipment';

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
        smsaTrackingNumber: true,
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

    try {
      const shipments = await getSallaOrderShipments(
        returnRequest.merchantId,
        String(returnRequest.orderId)
      );
      const trackingNumber =
        shipments
          .filter((shipment) => String(shipment?.type || '').toLowerCase() === 'return')
          .map((shipment) => extractTrackingFromShipment(shipment))
          .find((tracking): tracking is string => Boolean(tracking)) ?? null;

      if (trackingNumber) {
        try {
          await prisma.returnRequest.update({
            where: { id: returnRequest.id },
            data: { smsaTrackingNumber: trackingNumber },
          });
        } catch (updateError) {
          // smsaTrackingNumber is unique; ignore conflicts but still surface it.
          log.warn('Failed to persist return tracking number', {
            returnRequestId,
            trackingNumber,
            error: updateError,
          });
        }

        return NextResponse.json({ ready: true, trackingNumber });
      }
    } catch (error) {
      log.warn('Failed to fetch return shipment tracking from Salla', {
        returnRequestId,
        error,
      });
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
