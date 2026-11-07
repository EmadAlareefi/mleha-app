import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { searchExchangeProducts } from '@/app/lib/returns/exchange-catalog';
import { isRateLimited } from '@/app/lib/returns/public-rate-limit';

export const runtime = 'nodejs';

/** GET /api/returns/exchange/catalog?merchantId=&keyword=&category=&page= — replacement picker (public). */
export async function GET(request: NextRequest) {
  if (isRateLimited(request, 'exchange-catalog', 60)) {
    return NextResponse.json({ error: 'طلبات كثيرة، حاولي بعد قليل' }, { status: 429 });
  }
  const params = request.nextUrl.searchParams;
  const resolved = await resolveSallaMerchantId(params.get('merchantId'));
  if (!resolved.merchantId) return NextResponse.json({ error: 'المتجر غير معروف' }, { status: 400 });
  try {
    const result = await searchExchangeProducts(resolved.merchantId, {
      keyword: params.get('keyword') || undefined,
      category: params.get('category') || undefined,
      page: Number(params.get('page')) || 1,
    });
    const response = NextResponse.json({ success: true, ...result });
    response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return response;
  } catch (error) {
    log.error('Exchange catalog search failed', { error });
    return NextResponse.json({ error: 'تعذر تحميل المنتجات' }, { status: 502 });
  }
}
