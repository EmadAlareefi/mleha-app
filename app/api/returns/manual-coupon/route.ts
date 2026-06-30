import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import { getSallaOrder } from '@/app/lib/salla-api';
import { calculateExchangeCouponAmount } from '@/lib/returns/exchange-coupon-amount';
import { getReturnFeeQuoteForOrder } from '@/app/lib/returns/fee-quote';

export const runtime = 'nodejs';
const DEFAULT_COUPON_EXPIRY_DAYS = Number(process.env.EXCHANGE_COUPON_DEFAULT_EXPIRY_DAYS || '30');
const SALLA_CUSTOMER_MARKUP = 0.15; // Salla adds 15% (VAT) to coupon value

/**
 * POST /api/returns/manual-coupon
 * Manually assign a coupon code to an exchange request (when auto-creation fails)
 */
export async function POST(request: NextRequest) {
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
    if (returnRequest.type !== 'exchange') {
      return NextResponse.json(
        { error: 'الكوبونات متاحة فقط لطلبات الاستبدال' },
        { status: 400 }
      );
    }

    let liveOrderAmounts;
    let feeQuote;
    try {
      const order = await getSallaOrder(returnRequest.merchantId, returnRequest.orderId);
      liveOrderAmounts = order?.amounts;
      if (order) {
        feeQuote = getReturnFeeQuoteForOrder(order, 'exchange');
      }
    } catch (error) {
      log.warn('Could not refresh Salla shipping amount before assigning exchange coupon', {
        returnRequestId,
        orderId: returnRequest.orderId,
        error,
      });
    }

    const currentCalculation = calculateExchangeCouponAmount(
      returnRequest,
      liveOrderAmounts,
      feeQuote,
    );
    const couponAmount = currentCalculation.fullAmount;

    if (!couponAmount || !Number.isFinite(couponAmount) || couponAmount <= 0) {
      return NextResponse.json(
        { error: 'قيمة الاستبدال غير متاحة. يرجى مراجعة الطلب قبل إرسال الكوبون.' },
        { status: 400 }
      );
    }

    // Update return request with manual coupon code
    const updatedRequest = await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        couponCode: couponCode.trim(),
        couponCreatedAt: new Date(),
        totalRefundAmount: couponAmount,
        returnFee: currentCalculation.processingFee,
        shippingAmount: currentCalculation.originalShipping,
        currency: currentCalculation.currency,
        feeExchangeRate: currentCalculation.exchangeRate,
        feeExchangeRateSource: currentCalculation.exchangeRateSource,
      },
      include: { items: true },
    });

    log.info('Manual coupon code assigned', {
      returnRequestId,
      couponCode: couponCode.trim(),
      couponAmount,
      processingFee: currentCalculation.processingFee,
      originalShipping: currentCalculation.originalShipping,
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
      currency: currentCalculation.currency,
      sarFullAmount: currentCalculation.fullAmountSar,
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
