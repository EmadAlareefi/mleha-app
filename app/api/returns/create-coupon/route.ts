import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { issueExchangeCoupon } from '@/app/lib/returns/exchange-coupon';
import { requireReturnsStaff } from '@/app/lib/returns/staff-auth';

export const runtime = 'nodejs';

/**
 * POST /api/returns/create-coupon
 * Create the exchange coupon for a request's exchange pieces (staff only).
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const { returnRequestId, expiryDays } = body ?? {};

    if (!returnRequestId) {
      return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
    }

    const result = await issueExchangeCoupon(String(returnRequestId), { expiryDays });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, permissionDenied: result.permissionDenied }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      coupon: { code: result.couponCode, id: result.couponId },
      returnRequest: result.request,
      notification: result.notification,
    });
  } catch (error) {
    log.error('Error creating coupon', { error });
    return NextResponse.json({ error: 'حدث خطأ أثناء إنشاء الكوبون' }, { status: 500 });
  }
}
