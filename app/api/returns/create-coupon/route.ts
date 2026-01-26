import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSallaCoupon, generateCouponCode } from '@/app/lib/salla-coupons';
import { log } from '@/app/lib/logger';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';

export const runtime = 'nodejs';
const DEFAULT_COUPON_EXPIRY_DAYS = Number(process.env.EXCHANGE_COUPON_DEFAULT_EXPIRY_DAYS || '30');
const SALLA_CUSTOMER_MARKUP = 0.15; // Salla adds 15% to coupon value, so we compensate by dividing

/**
 * POST /api/returns/create-coupon
 * Create a coupon for an exchange request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { returnRequestId, amount, expiryDays } = body;

    if (!returnRequestId) {
      return NextResponse.json(
        { error: 'معرف الطلب مطلوب' },
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

    // Check if coupon already exists
    if (returnRequest.couponCode) {
      return NextResponse.json(
        { error: 'تم إنشاء كوبون لهذا الطلب مسبقاً' },
        { status: 400 }
      );
    }

    const requestAmount =
      returnRequest.totalRefundAmount !== null && returnRequest.totalRefundAmount !== undefined
        ? Number(returnRequest.totalRefundAmount)
        : undefined;
    const fallbackBodyAmount =
      amount !== undefined && amount !== null ? Number(amount) : undefined;
    const couponAmount = requestAmount ?? fallbackBodyAmount;

    if (!couponAmount || !Number.isFinite(couponAmount) || couponAmount <= 0) {
      log.error('Invalid coupon amount detected', {
        returnRequestId,
        totalRefundAmount: returnRequest.totalRefundAmount,
        fallbackBodyAmount,
      });
      return NextResponse.json(
        { error: 'قيمة الاستبدال غير متاحة. يرجى مراجعة الطلب.' },
        { status: 400 }
      );
    }

    const sanitizedAmount = Number(couponAmount.toFixed(2));
    const discountedAmount = Number(
      (sanitizedAmount / (1 + SALLA_CUSTOMER_MARKUP)).toFixed(2)
    );

    if (!Number.isFinite(discountedAmount) || discountedAmount <= 0) {
      log.error('Discounted coupon amount is invalid', {
        returnRequestId,
        sanitizedAmount,
        discountedAmount,
      });
      return NextResponse.json(
        { error: 'قيمة الاستبدال بعد الحسم غير صالحة. يرجى مراجعة الطلب.' },
        { status: 400 }
      );
    }

    // Generate coupon code
    const couponCode = generateCouponCode('EXCHANGE');

    // Calculate expiry date
    const daysToExpireRaw = Number(expiryDays);
    const safeExpiryDays = Number.isFinite(daysToExpireRaw) && daysToExpireRaw > 0
      ? Math.min(daysToExpireRaw, 365)
      : DEFAULT_COUPON_EXPIRY_DAYS;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + safeExpiryDays);

    // Create coupon in Salla
    log.info('Creating coupon for exchange', {
      returnRequestId,
      couponCode,
      amountBeforeDiscount: sanitizedAmount,
      amountAfterDiscount: discountedAmount,
    });

    const result = await createSallaCoupon(returnRequest.merchantId, {
      code: couponCode,
      type: 'fixed',
      amount: discountedAmount,
      free_shipping: true,
      exclude_sale_products: false,
      expiry_date: expiryDate.toISOString(),
      usage_limit: 1,
      usage_limit_per_user: 1,
      active: true,
    });

    if (!result.success || !result.coupon) {
      log.error('Failed to create coupon in Salla', { result });
      return NextResponse.json(
        { error: result.error || 'فشل إنشاء الكوبون' },
        { status: 500 }
      );
    }

    // Update return request with coupon info
    const updatedRequest = await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        couponCode: result.coupon.code,
        couponId: String(result.coupon.id),
        couponCreatedAt: new Date(),
      },
      include: { items: true },
    });

    log.info('Coupon created successfully', {
      returnRequestId,
      couponCode: result.coupon.code,
      couponId: result.coupon.id,
      amountBeforeDiscount: sanitizedAmount,
      amountSentToSalla: discountedAmount,
    });

    const notification = await notifyExchangeCoupon({
      customerName: returnRequest.customerName,
      customerPhone: returnRequest.customerPhone,
      orderNumber: returnRequest.orderNumber,
      couponCode: result.coupon.code,
      amount: discountedAmount,
      expiryDate,
    });

    return NextResponse.json({
      success: true,
      coupon: result.coupon,
      returnRequest: updatedRequest,
      notification,
    });

  } catch (error) {
    log.error('Error creating coupon', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء الكوبون' },
      { status: 500 }
    );
  }
}
