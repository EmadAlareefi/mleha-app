import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { maybeReleaseExchangeOrderHold } from '@/app/lib/returns/exchange-order';
import { recalculateReturnRequestFinancials } from '@/lib/returns/request-financials';

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
      const existingRequest = await prisma.returnRequest.findUnique({
        where: { id },
        include: {
          items: {
            select: {
              price: true,
              quantity: true,
            },
          },
        },
      });

      if (!existingRequest) {
        return NextResponse.json(
          { error: 'طلب الإرجاع غير موجود' },
          { status: 404 },
        );
      }

      const financials = recalculateReturnRequestFinancials({
        type,
        currency: existingRequest.currency,
        exchangeRate: existingRequest.feeExchangeRate,
        totalRefundAmount: existingRequest.totalRefundAmount,
        returnFee: existingRequest.returnFee,
        shippingAmount: existingRequest.shippingAmount,
        items: existingRequest.items,
      });

      updateData.type = type;
      updateData.returnFee = financials.returnFee;
      updateData.totalRefundAmount = financials.totalRefundAmount;
      updateData.feeExchangeRate = financials.feeExchangeRate;
      updateData.feeExchangeRateSource = financials.feeExchangeRateSource;
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
