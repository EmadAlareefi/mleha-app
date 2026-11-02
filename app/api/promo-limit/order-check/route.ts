import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { checkOrderPromoLimit } from '@/app/lib/promo-limit';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * POST /api/promo-limit/order-check
 * Body: { orderId, merchantId?, orderData? }
 *
 * Used by order-prep and order-shipping to warn staff when an order breaks the
 * one-per-customer rule of the 1 SAR promo category.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }
  if (!hasServiceAccess(session, ['order-prep', 'order-shipping', 'local-shipping', 'admin-order-prep'])) {
    return NextResponse.json({ error: 'ليست لديك صلاحية للوصول' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const orderId = body?.orderId != null ? String(body.orderId).trim() : '';
  if (!/^\d{1,20}$/.test(orderId)) {
    return NextResponse.json({ error: 'رقم الطلب غير صحيح' }, { status: 400 });
  }
  const merchantId = typeof body?.merchantId === 'string' && body.merchantId.trim() ? body.merchantId.trim() : MERCHANT_ID;

  try {
    const check = await checkOrderPromoLimit({ merchantId, orderId, orderData: body?.orderData });
    return NextResponse.json({ success: true, check });
  } catch (error) {
    log.error('Promo limit order check failed', { orderId, error: error instanceof Error ? error.message : error });
    return NextResponse.json({ error: 'تعذر التحقق من حد عرض الريال' }, { status: 500 });
  }
}
