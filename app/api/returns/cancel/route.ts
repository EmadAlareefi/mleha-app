import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { syncLocalReturnPickupTask } from '@/app/lib/returns/local-return-pickup';
import { cancelAjexShipment } from '@/app/lib/ajex-api';
import { isAjexReturnRequest } from '@/lib/returns/return-provider';
import { isPhoneProofRequired, orderBelongsToPhone } from '@/app/lib/returns/customer-phone';
import { isRateLimited } from '@/app/lib/returns/public-rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/returns/cancel
 *
 * Cancels a return request
 */
export async function POST(request: NextRequest) {
  if (isRateLimited(request, 'returns-cancel', 10)) {
    return NextResponse.json({ error: 'طلبات كثيرة، حاول مرة أخرى بعد قليل' }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { returnRequestId, merchantId, customerMobile } = body;

    if (!returnRequestId || !merchantId) {
      return NextResponse.json(
        { error: 'returnRequestId and merchantId are required' },
        { status: 400 }
      );
    }

    log.info('Cancelling return request', { returnRequestId, merchantId });

    // Find the return request
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
    });

    if (!returnRequest) {
      return NextResponse.json(
        { error: 'لم يتم العثور على طلب الإرجاع' },
        { status: 404 }
      );
    }

    // Verify merchant owns this return request
    if (returnRequest.merchantId !== merchantId) {
      return NextResponse.json(
        { error: 'غير مصرح لك بإلغاء هذا الطلب' },
        { status: 403 }
      );
    }

    // Public route: the caller must know the customer's mobile, the same proof
    // used to look the order up. The stored phone is already normalized.
    if (
      isPhoneProofRequired() &&
      !orderBelongsToPhone({ customer: { mobile: returnRequest.customerPhone } }, customerMobile)
    ) {
      log.warn('Rejected return cancel without matching customer mobile', { returnRequestId });
      return NextResponse.json(
        { error: 'غير مصرح لك بإلغاء هذا الطلب' },
        { status: 403 }
      );
    }

    // A replacement order may already be paid or held for this request;
    // cancelling here would orphan it, so staff must handle it.
    if (returnRequest.exchangeMode === 'order' && returnRequest.exchangeOrderId) {
      return NextResponse.json(
        { error: 'تم إنشاء طلب استبدال لهذا الطلب، يرجى التواصل مع خدمة العملاء لإلغائه' },
        { status: 400 }
      );
    }

    // Check if already cancelled
    if (returnRequest.status === 'cancelled') {
      return NextResponse.json(
        { error: 'هذا الطلب ملغى بالفعل' },
        { status: 400 }
      );
    }

    // Check if request can be cancelled (only pending_review and approved can be cancelled)
    if (!['pending_review', 'approved'].includes(returnRequest.status)) {
      return NextResponse.json(
        { error: 'لا يمكن إلغاء هذا الطلب في حالته الحالية' },
        { status: 400 }
      );
    }

    // Update status to cancelled
    const claimed = await prisma.returnRequest.updateMany({
      where: { id: returnRequestId, status: { in: ['pending_review', 'approved'] } },
      data: {
        status: 'cancelled',
        updatedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      return NextResponse.json(
        { error: 'لا يمكن إلغاء هذا الطلب في حالته الحالية' },
        { status: 409 }
      );
    }
    const updatedRequest = await prisma.returnRequest.findUniqueOrThrow({
      where: { id: returnRequestId },
    });

    await syncLocalReturnPickupTask(updatedRequest.id);

    // AJEX pickups were booked by us, so release the courier too. Best effort:
    // the request is already cancelled either way.
    if (isAjexReturnRequest(returnRequest.smsaResponse) && returnRequest.smsaTrackingNumber) {
      const cancelled = await cancelAjexShipment(returnRequest.smsaTrackingNumber);
      if (!cancelled.success) {
        log.warn('Failed to cancel AJEX return shipment', {
          returnRequestId,
          trackingNumber: returnRequest.smsaTrackingNumber,
          error: cancelled.error,
        });
      }
    }

    log.info('Return request cancelled successfully', {
      returnRequestId,
      previousStatus: returnRequest.status,
    });

    return NextResponse.json({
      success: true,
      returnRequest: {
        id: updatedRequest.id,
        status: updatedRequest.status,
        updatedAt: updatedRequest.updatedAt,
      },
    });

  } catch (error) {
    log.error('Error cancelling return request', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إلغاء طلب الإرجاع' },
      { status: 500 }
    );
  }
}
