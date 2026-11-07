import { NextRequest, NextResponse } from 'next/server';
import { requireReturnsStaff } from '@/app/lib/returns/staff-auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { maybeReleaseExchangeOrderHold } from '@/app/lib/returns/exchange-order';
import { recalculateReturnRequestFinancials, splitRequestFinancials } from '@/lib/returns/request-financials';
import { buildReturnFeeQuote } from '@/lib/returns/fees';
import { deriveRequestType } from '@/lib/returns/pieces';
import { canTransition } from '@/lib/returns/workflow';
import { staffActorName } from '@/app/lib/returns/staff-auth';
import { syncLocalReturnPickupTask } from '@/app/lib/returns/local-return-pickup';

export const runtime = 'nodejs';

/**
 * POST /api/returns/update
 * Update a return request (status, notes, etc.)
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { id, status, adminNotes, type } = body;
    const pieceUpdates: Array<{ id: string; type?: string; refundIncluded?: boolean }> = Array.isArray(body.items) ? body.items : [];

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

    log.info('Updating return request', { id, status, type, pieceUpdates: pieceUpdates.length });

    const current = await prisma.returnRequest.findUnique({
      where: { id },
      select: { status: true, processingStatus: true, refundStatus: true, couponCode: true, exchangeMode: true, exchangeOrderId: true },
    });
    if (!current) {
      return NextResponse.json({ error: 'طلب الإرجاع غير موجود' }, { status: 404 });
    }
    if (status && !canTransition(current.status, status)) {
      return NextResponse.json(
        { error: `لا يمكن نقل الطلب من "${current.status}" إلى "${status}"` },
        { status: 400 },
      );
    }
    // A replacement order already spent the exchange credit, so changing piece
    // types now would refund money that paid for it.
    const moneyMoved =
      current.refundStatus !== 'none' ||
      Boolean(current.couponCode) ||
      (current.exchangeMode === 'order' && Boolean(current.exchangeOrderId));
    if ((type || pieceUpdates.some((piece) => piece.type)) && moneyMoved) {
      return NextResponse.json(
        { error: 'لا يمكن تغيير نوع القطع بعد الاسترجاع أو إنشاء الكوبون أو طلب الاستبدال' },
        { status: 400 },
      );
    }
    if (current.processingStatus === 'processing') {
      return NextResponse.json({ error: 'الطلب قيد المعالجة حالياً' }, { status: 409 });
    }

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

    // Re-opened requests go back through the queues; finished steps stay
    // finished (processing skips refunded / restocked / couponed work).
    if (status && current.status === 'completed' && status !== 'completed') {
      updateData.processingStatus = 'idle';
      updateData.processingError = null;
    }

    if (status) {
      updateData.reviewedBy = staffActorName(auth.session);
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
      updateData.couponAmount = type === 'exchange' ? financials.totalRefundAmount : null;
      // Whole-request type change applies to every piece.
      await prisma.returnItem.updateMany({ where: { returnRequestId: id }, data: { type } });
      updateData.returnFee = financials.returnFee;
      updateData.totalRefundAmount = financials.totalRefundAmount;
      updateData.feeExchangeRate = financials.feeExchangeRate;
      updateData.feeExchangeRateSource = financials.feeExchangeRateSource;
    }

    if (!type && pieceUpdates.length > 0) {
      for (const piece of pieceUpdates) {
        const data: Record<string, unknown> = {};
        if (piece.type === 'return' || piece.type === 'exchange') data.type = piece.type;
        if (typeof piece.refundIncluded === 'boolean') data.refundIncluded = piece.refundIncluded;
        if (Object.keys(data).length > 0) {
          await prisma.returnItem.updateMany({ where: { id: String(piece.id), returnRequestId: id }, data });
        }
      }
      Object.assign(updateData, await repriceFromPieces(id));
    }

    const returnRequest = await prisma.returnRequest.update({
      where: { id },
      data: updateData,
      include: {
        items: true,
      },
    });

    if (returnRequest.type !== 'return') {
      await maybeReleaseExchangeOrderHold(returnRequest.id);
    }

    if (status) {
      await syncLocalReturnPickupTask(returnRequest.id);
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

/** Refund / coupon split from the stored pieces after staff edit them. */
async function repriceFromPieces(id: string) {
  const request = await prisma.returnRequest.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const rate = Number(request.feeExchangeRate) > 0 ? Number(request.feeExchangeRate) : 1;
  const source = request.currency === 'SAR' ? 'sar' : 'stored';
  const split = splitRequestFinancials({
    pieces: request.items.map((item) => ({
      type: (item.type === 'exchange' ? 'exchange' : 'return') as 'return' | 'exchange',
      price: item.price,
      quantity: item.quantity,
      refundIncluded: item.refundIncluded,
    })),
    originalShipping: Number(request.shippingAmount) || 0,
    returnProcessingFee: buildReturnFeeQuote('return', request.currency, rate, source).processingFee,
    exchangeProcessingFee: buildReturnFeeQuote('exchange', request.currency, rate, source).processingFee,
  });
  const requestType = deriveRequestType(request.items.map((item) => item.type));
  return {
    type: requestType,
    returnFee: split.processingFee,
    totalRefundAmount: requestType === 'exchange' ? split.couponAmount : split.refundAmount,
    couponAmount: split.couponAmount > 0 ? split.couponAmount : null,
  };
}
