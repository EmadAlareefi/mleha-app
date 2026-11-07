import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import { computeRequestAmounts } from '@/app/lib/returns/exchange-coupon';
import { toSallaCouponAmount } from '@/lib/returns/exchange-coupon-amount';

export const runtime = 'nodejs';

const DEFAULT_COUPON_EXPIRY_DAYS = Number(process.env.EXCHANGE_COUPON_DEFAULT_EXPIRY_DAYS || '30');

/**
 * POST /api/returns/resend-coupon { returnRequestId }
 * WhatsApp the request's existing exchange coupon to the customer again.
 * Sends the stored code and amount; never creates or changes a coupon.
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const returnRequestId = typeof body?.returnRequestId === 'string' ? body.returnRequestId : '';
  if (!returnRequestId) {
    return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
  }

  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: true },
  });
  if (!returnRequest) {
    return NextResponse.json({ error: 'طلب الإرجاع غير موجود' }, { status: 404 });
  }
  // couponCreatedAt is only set once the coupon exists in Salla (the code alone
  // can be a claim held by a creation still in flight).
  if (!returnRequest.couponCode || !returnRequest.couponCreatedAt) {
    return NextResponse.json({ error: 'لا يوجد كوبون مُنشأ لهذا الطلب بعد' }, { status: 400 });
  }

  try {
    const stored = Number(returnRequest.couponAmount);
    const fullAmount = Number.isFinite(stored) && stored > 0
      ? stored
      : (await computeRequestAmounts(returnRequest)).couponAmount;
    if (!Number.isFinite(fullAmount) || fullAmount <= 0) {
      return NextResponse.json({ error: 'قيمة الكوبون غير متاحة' }, { status: 400 });
    }

    const expiryDate = new Date(returnRequest.couponCreatedAt);
    expiryDate.setDate(expiryDate.getDate() + DEFAULT_COUPON_EXPIRY_DAYS);

    const notification = await notifyExchangeCoupon({
      customerName: returnRequest.customerName,
      customerPhone: returnRequest.customerPhone,
      orderNumber: returnRequest.orderNumber,
      couponCode: returnRequest.couponCode,
      discountedAmount: toSallaCouponAmount(fullAmount),
      fullAmount,
      currency: returnRequest.currency,
      sarFullAmount: fullAmount * Number(returnRequest.feeExchangeRate ?? 1),
      expiryDate,
    });

    log.info('Exchange coupon resent', {
      returnRequestId,
      couponCode: returnRequest.couponCode,
      status: notification?.status,
      by: staffActorName(auth.session),
    });

    return NextResponse.json({ success: true, notification });
  } catch (error) {
    log.error('Failed to resend exchange coupon', { returnRequestId, error });
    return NextResponse.json({ error: 'تعذر إرسال الكوبون' }, { status: 500 });
  }
}
