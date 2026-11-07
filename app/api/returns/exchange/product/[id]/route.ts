import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { getExchangeProduct } from '@/app/lib/returns/exchange-catalog';
import { isRateLimited } from '@/app/lib/returns/public-rate-limit';

export const runtime = 'nodejs';

/** GET /api/returns/exchange/product/[id]?merchantId= — options, sizes and stock (public). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (isRateLimited(request, 'exchange-product', 90)) {
    return NextResponse.json({ error: 'طلبات كثيرة، حاولي بعد قليل' }, { status: 429 });
  }
  const { id } = await context.params;
  const resolved = await resolveSallaMerchantId(request.nextUrl.searchParams.get('merchantId'));
  if (!resolved.merchantId) return NextResponse.json({ error: 'المتجر غير معروف' }, { status: 400 });
  try {
    const product = await getExchangeProduct(resolved.merchantId, id);
    if (!product) return NextResponse.json({ error: 'المنتج غير متاح للاستبدال' }, { status: 404 });
    const response = NextResponse.json({ success: true, product });
    response.headers.set('Cache-Control', 'public, max-age=30, s-maxage=120');
    return response;
  } catch (error) {
    log.error('Exchange product lookup failed', { id, error });
    return NextResponse.json({ error: 'تعذر تحميل المنتج' }, { status: 502 });
  }
}
