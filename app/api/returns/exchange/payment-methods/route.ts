import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { EXCHANGE_PAYMENT_METHODS } from '@/app/lib/returns/exchange-order-flow';

export const runtime = 'nodejs';

const LABELS: Record<string, string> = {
  mada: 'مدى',
  credit_card: 'بطاقة ائتمانية',
  apple_pay: 'Apple Pay',
  stc_pay: 'STC Pay',
  tabby_installment: 'تابي — قسّميها',
  tamara_installment: 'تمارا — قسّميها',
};

let cached: { at: number; slugs: string[] } | null = null;

/**
 * GET /api/returns/exchange/payment-methods?merchantId=
 * Online methods the store has enabled, limited to RETURNS_EXCHANGE_PAYMENT_METHODS.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveSallaMerchantId(request.nextUrl.searchParams.get('merchantId'));
  if (!resolved.merchantId) return NextResponse.json({ error: 'المتجر غير معروف' }, { status: 400 });
  try {
    if (!cached || Date.now() - cached.at > 10 * 60 * 1000) {
      const body = await sallaMakeRequest<any>(resolved.merchantId, '/payment/methods', { throwOnError: true });
      cached = { at: Date.now(), slugs: (Array.isArray(body?.data) ? body.data : []).map((m: any) => String(m.slug)) };
    }
    const enabled = new Set(cached.slugs);
    const methods = EXCHANGE_PAYMENT_METHODS.filter((slug) => enabled.has(slug)).map((slug) => ({
      slug,
      label: LABELS[slug] || slug,
    }));
    return NextResponse.json({ success: true, methods });
  } catch (error) {
    log.error('Exchange payment methods failed', { error });
    // The store's checkout page still lists its methods; fall back to the configured list.
    return NextResponse.json({
      success: true,
      methods: EXCHANGE_PAYMENT_METHODS.map((slug) => ({ slug, label: LABELS[slug] || slug })),
    });
  }
}
