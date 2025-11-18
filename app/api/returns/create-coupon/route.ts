import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSallaCoupon, generateCouponCode } from '@/app/lib/salla-coupons';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/returns/create-coupon
 * Create a coupon for an exchange request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { returnRequestId, amount, expiryDays = 30 } = body;

    if (!returnRequestId || !amount) {
      return NextResponse.json(
        { error: 'معرف الطلب والمبلغ مطلوبان' },
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

    // Generate coupon code
    const couponCode = generateCouponCode('EXCHANGE');

    // Calculate expiry date
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);

    // Create coupon in Salla
    log.info('Creating coupon for exchange', {
      returnRequestId,
      couponCode,
      amount,
    });

    const result = await createSallaCoupon(returnRequest.merchantId, {
      code: couponCode,
      type: 'fixed',
      amount: Number(amount),
      free_shipping: false,
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
    });

    return NextResponse.json({
      success: true,
      coupon: result.coupon,
      returnRequest: updatedRequest,
    });

  } catch (error) {
    log.error('Error creating coupon', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء الكوبون' },
      { status: 500 }
    );
  }
}
