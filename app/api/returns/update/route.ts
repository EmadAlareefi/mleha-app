import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { maybeReleaseExchangeOrderHold } from '@/app/lib/returns/exchange-order';
import { buildReturnFeeQuote } from '@/lib/returns/fees';

export const runtime = 'nodejs';

/**
 * POST /api/returns/update
 * Update a return request (status, notes, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, adminNotes, reviewedBy, type } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'معرف الطلب مطلوب' },
        { status: 400 }
      );
    }

    // Validate status if provided
    const validStatuses = [
      'pending_review',
      'approved',
      'rejected',
      'shipped',
      'delivered',
      'completed',
      'cancelled',
    ];

    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'حالة غير صالحة' },
        { status: 400 }
      );
    }

    const validTypes = ['return', 'exchange'];

    if (type && !validTypes.includes(type)) {
      return NextResponse.json(
        { error: 'نوع الطلب غير صالح' },
        { status: 400 }
      );
    }

    log.info('Updating return request', { id, status, type });

    // Prepare update data
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (status) {
      updateData.status = status;
    }

    if (adminNotes !== undefined) {
      updateData.adminNotes = adminNotes;
    }

    if (reviewedBy) {
      updateData.reviewedBy = reviewedBy;
      updateData.reviewedAt = new Date();
    }

    if (type) {
      updateData.type = type;

      // Switching between "return" and "exchange" changes the flat shipment-leg
      // fee (60 SAR for returns, 40 SAR for exchanges), so the refund total must
      // be recalculated - otherwise a converted request keeps the old type's fee
      // and over/under-refunds the customer.
      const existing = await prisma.returnRequest.findUnique({
        where: { id },
        select: {
          type: true,
          currency: true,
          feeExchangeRate: true,
          feeExchangeRateSource: true,
          totalRefundAmount: true,
          returnFee: true,
        },
      });

      if (existing && type !== existing.type) {
        const orderTotal =
          Number(existing.totalRefundAmount ?? 0) + Number(existing.returnFee ?? 0);
        const feeQuote = buildReturnFeeQuote(
          type,
          existing.currency,
          Number(existing.feeExchangeRate ?? 1),
          (existing.feeExchangeRateSource as 'sar' | 'salla' | 'env' | 'stored') ?? 'sar',
        );

        updateData.returnFee = feeQuote.processingFee;
        updateData.totalRefundAmount = Math.max(0, orderTotal - feeQuote.processingFee);
      }
    }

    const returnRequest = await prisma.returnRequest.update({
      where: { id },
      data: updateData,
      include: {
        items: true,
      },
    });

    if (returnRequest.type === 'exchange') {
      await maybeReleaseExchangeOrderHold(returnRequest.id);
    }

    log.info('Return request updated successfully', { id, status, type: returnRequest.type });

    return NextResponse.json({
      success: true,
      returnRequest,
    });

  } catch (error) {
    log.error('Error updating return request', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث طلب الإرجاع' },
      { status: 500 }
    );
  }
}
