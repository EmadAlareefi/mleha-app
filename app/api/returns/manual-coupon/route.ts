import { NextRequest, NextResponse } from 'next/server';
import { requireReturnsStaff } from '@/app/lib/returns/staff-auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import { SALLA_CUSTOMER_MARKUP } from '@/lib/returns/exchange-coupon-amount';
import { computeRequestAmounts } from '@/app/lib/returns/exchange-coupon';

export const runtime = 'nodejs';
const DEFAULT_COUPON_EXPIRY_DAYS = Number(process.env.EXCHANGE_COUPON_DEFAULT_EXPIRY_DAYS || '30');

/**
 * POST /api/returns/manual-coupon
 * Manually assign a coupon code to an exchange request (when auto-creation fails)
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { returnRequestId, couponCode } = body;

    if (!returnRequestId || !couponCode) {
      return NextResponse.json(
        { error: 'معرف الطلب ورمز الكوبون مطلوبان' },
        { status: 400 }
      );
    }

    // Fetch return request
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { items: true },
    });

    if (!returnRequest) {
      return NextResponse.json(
        { error: 'طلب الإرجاع غير موجود' },
        { status: 404 }
      );
    }

    // Check if it's an exchange
    if (returnRequest.type !== 'exchange' && returnRequest.type !== 'mixed') {
      return NextResponse.json(
        { error: 'الكوبونات متاحة فقط لطلبات الاستبدال' },
        { status: 400 }
      );
    }

    if (returnRequest.couponCode) {
      return NextResponse.json(
        { error: `لهذا الطلب كوبون مسبقاً (${returnRequest.couponCode})` },
        { status: 409 }
      );
    }
    if (returnRequest.exchangeMode === 'order' && returnRequest.exchangeOrderId) {
      return NextResponse.json(
        { error: 'رصيد الاستبدال مستخدم في طلب الاستبدال، لا يمكن إسناد كوبون' },
        { status: 400 }
      );
    }

    const amounts = await computeRequestAmounts(returnRequest);
    const couponAmount = amounts.couponAmount;

    if (!couponAmount || !Number.isFinite(couponAmount) || couponAmount <= 0) {
      return NextResponse.json(
        { error: 'قيمة الاستبدال غير متاحة. يرجى مراجعة الطلب قبل إرسال الكوبون.' },
        { status: 400 }
      );
    }

    // Only assign when no coupon exists (never overwrite one issued meanwhile).
    const assigned = await prisma.returnRequest.updateMany({
      where: { id: returnRequestId, couponCode: null },
      data: {
        couponCode: couponCode.trim(),
        couponCreatedAt: new Date(),
        couponAmount,
        // Pre-v2 meaning: for exchange-only requests the "refund" is the credit.
        ...(amounts.requestType === 'exchange'
          ? {
              totalRefundAmount: couponAmount,
              returnFee: amounts.processingFee,
              shippingAmount: amounts.originalShipping,
              currency: amounts.currency,
              feeExchangeRate: amounts.exchangeRate,
              feeExchangeRateSource: amounts.exchangeRateSource,
            }
          : {}),
      },
    });
    if (assigned.count === 0) {
      return NextResponse.json(
        { error: 'تم إصدار كوبون لهذا الطلب للتو، حدّثي الصفحة' },
        { status: 409 }
      );
    }
    const updatedRequest = await prisma.returnRequest.findUniqueOrThrow({
      where: { id: returnRequestId },
      include: { items: true },
    });

    log.info('Manual coupon code assigned', {
      returnRequestId,
      couponCode: couponCode.trim(),
      couponAmount,
      amountSource: amounts.couponSource,
      processingFee: amounts.processingFee,
      originalShipping: amounts.originalShipping,
    });

    const assumedExpiry = new Date();
    assumedExpiry.setDate(assumedExpiry.getDate() + DEFAULT_COUPON_EXPIRY_DAYS);

    const fullAmount = Number(couponAmount.toFixed(2));
    const discountedAmount = Number((fullAmount / (1 + SALLA_CUSTOMER_MARKUP)).toFixed(2));

    const notification = await notifyExchangeCoupon({
      customerName: returnRequest.customerName,
      customerPhone: returnRequest.customerPhone,
      orderNumber: returnRequest.orderNumber,
      couponCode: couponCode.trim(),
      discountedAmount,
      fullAmount,
      currency: amounts.currency,
      sarFullAmount: amounts.couponAmountSar,
      expiryDate: assumedExpiry,
    });

    return NextResponse.json({
      success: true,
      returnRequest: updatedRequest,
      notification,
    });

  } catch (error) {
    log.error('Error assigning manual coupon', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تعيين الكوبون' },
      { status: 500 }
    );
  }
}
