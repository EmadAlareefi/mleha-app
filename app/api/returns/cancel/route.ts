import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/returns/cancel
 *
 * Cancels a return request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { returnRequestId, merchantId } = body;

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
    const updatedRequest = await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        status: 'cancelled',
        updatedAt: new Date(),
      },
    });

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
