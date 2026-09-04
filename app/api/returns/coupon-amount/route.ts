import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';
import { updateSallaCoupon } from '@/app/lib/salla-coupons';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import { toSallaCouponAmount } from '@/lib/returns/exchange-coupon-amount';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const DEFAULT_COUPON_EXPIRY_DAYS = Number(process.env.EXCHANGE_COUPON_DEFAULT_EXPIRY_DAYS || '30');
// A credit larger than this is almost certainly a typo (a missing decimal point),
// and the mistake is only visible after the customer has spent it.
const MAX_COUPON_AMOUNT = 20000;

function actorName(session: any) {
  return session?.user?.username || session?.user?.name || session?.user?.email || 'user';
}

/**
 * `/api/returns` is a public middleware prefix, so admin-only routes under it
 * guard themselves. Mirrors `../window-overrides/route.ts`.
 */
async function authorizeReturnsManagement() {
  const session = await getServerSession(authOptions);
  return hasServiceAccess(session, 'returns-management') ? session : null;
}

/**
 * POST /api/returns/coupon-amount
 *
 * Sets the exchange credit by hand. Used when the policy calculation cannot see
 * what the customer actually paid — most often a bundle offer whose discount
 * Salla books entirely against the line being exchanged, pricing it at 0.
 *
 * If the coupon already exists in Salla its amount is moved there first, so the
 * stored figure never claims a value the customer's coupon does not have.
 */
export async function POST(request: NextRequest) {
  const session = await authorizeReturnsManagement();
  if (!session) {
    return NextResponse.json({ error: 'ليست لديك صلاحية لإدارة طلبات الإرجاع' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const returnRequestId =
      typeof body?.returnRequestId === 'string' ? body.returnRequestId.trim() : '';
    const amount = Number(body?.amount);
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    const resendNotification = body?.resendNotification === true;

    if (!returnRequestId) {
      return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
    }

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_COUPON_AMOUNT) {
      return NextResponse.json(
        { error: `قيمة الكوبون يجب أن تكون رقماً بين 1 و ${MAX_COUPON_AMOUNT}` },
        { status: 400 }
      );
    }

    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
    });

    if (!returnRequest) {
      return NextResponse.json({ error: 'طلب الإرجاع غير موجود' }, { status: 404 });
    }

    if (returnRequest.type !== 'exchange') {
      return NextResponse.json(
        { error: 'قيمة الكوبون متاحة فقط لطلبات الاستبدال' },
        { status: 400 }
      );
    }

    const fullAmount = Number(amount.toFixed(2));
    const discountedAmount = toSallaCouponAmount(fullAmount);

    // Salla first: a failed update must not leave the DB claiming a credit the
    // customer's coupon doesn't carry.
    if (returnRequest.couponId) {
      const result = await updateSallaCoupon(returnRequest.merchantId, returnRequest.couponId, {
        amount: discountedAmount,
      });

      if (!result.success) {
        log.error('Failed to update Salla coupon amount', {
          returnRequestId,
          couponId: returnRequest.couponId,
          fullAmount,
          error: result.error,
        });
        return NextResponse.json(
          { error: result.error || 'فشل تحديث قيمة الكوبون في سلة' },
          { status: 502 }
        );
      }
    }

    const updatedRequest = await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        couponAmountOverride: fullAmount,
        couponAmountOverrideBy: actorName(session),
        couponAmountOverrideAt: new Date(),
        couponAmountOverrideNote: note || null,
        totalRefundAmount: fullAmount,
      },
      include: { items: true },
    });

    log.info('Exchange coupon amount overridden', {
      returnRequestId,
      orderNumber: returnRequest.orderNumber,
      fullAmount,
      discountedAmount,
      couponCode: returnRequest.couponCode,
      by: actorName(session),
    });

    let notification;
    if (resendNotification && returnRequest.couponCode) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + DEFAULT_COUPON_EXPIRY_DAYS);

      notification = await notifyExchangeCoupon({
        customerName: returnRequest.customerName,
        customerPhone: returnRequest.customerPhone,
        orderNumber: returnRequest.orderNumber,
        couponCode: returnRequest.couponCode,
        discountedAmount,
        fullAmount,
        currency: returnRequest.currency,
        sarFullAmount: fullAmount * Number(returnRequest.feeExchangeRate ?? 1),
        expiryDate,
      });
    }

    return NextResponse.json({
      success: true,
      returnRequest: updatedRequest,
      couponUpdatedInSalla: Boolean(returnRequest.couponId),
      notification,
    });
  } catch (error) {
    log.error('Error updating exchange coupon amount', { error });
    return NextResponse.json({ error: 'حدث خطأ أثناء تحديث قيمة الكوبون' }, { status: 500 });
  }
}
