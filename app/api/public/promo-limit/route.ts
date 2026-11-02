import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders, corsPreflight, resolveAllowedOrigin } from '@/app/lib/public-cors';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { findPriorPromoOrders, getPromoLimitConfig, getPromoProductIds } from '@/app/lib/promo-limit';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';
const ALLOWED_METHODS = 'GET, OPTIONS';

/**
 * Read endpoint for the promo-limit script injected into mleha.com.
 *
 * Returns the promo product ids and how many promo units the signed-in customer
 * already bought. The customer id comes from the browser (Salla gives us no way
 * to verify it), so the response deliberately reveals only a count — no order
 * numbers or contact details. The real enforcement lives on the staff side.
 */

function headers(origin: string | null) {
  return {
    ...corsHeaders(origin, ALLOWED_METHODS),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request, ALLOWED_METHODS);
}

export async function GET(request: NextRequest) {
  const origin = resolveAllowedOrigin(request);
  if (!origin) {
    return NextResponse.json({ success: false, error: 'origin_not_allowed' }, { status: 403, headers: headers(null) });
  }

  const config = getPromoLimitConfig();
  if (!config.enabled) {
    return NextResponse.json(
      { success: true, enabled: false, max: config.maxPerCustomer, productIds: [], used: 0 },
      { headers: headers(origin) }
    );
  }

  const rawCustomerId = request.nextUrl.searchParams.get('customerId')?.trim() || '';
  const customerId = /^\d{1,20}$/.test(rawCustomerId) ? rawCustomerId : null;

  try {
    const merchant = await resolveSallaMerchantId();
    if (!merchant.merchantId) {
      return NextResponse.json({ success: false, error: 'merchant_unavailable' }, { status: 503, headers: headers(origin) });
    }

    const productIds = await getPromoProductIds(merchant.merchantId);
    const prior = customerId
      ? await findPriorPromoOrders({ merchantId: merchant.merchantId, promoProductIds: productIds, customerId })
      : [];
    const used = prior.reduce((sum, order) => sum + order.quantity, 0);

    return NextResponse.json(
      { success: true, enabled: true, max: config.maxPerCustomer, productIds, used },
      { headers: headers(origin) }
    );
  } catch (error) {
    log.error('Promo limit lookup failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'lookup_failed' }, { status: 500, headers: headers(origin) });
  }
}
