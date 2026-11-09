import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders, corsPreflight, resolveAllowedOrigin } from '@/app/lib/public-cors';
import { dateColumnToIso, daysBetween, riyadhToday } from '@/app/lib/restock-eta';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
const ALLOWED_METHODS = 'GET, OPTIONS';

export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request, ALLOWED_METHODS);
}

/**
 * Expected restock time for one product, read by the storefront notify-me
 * widget. Returns `eta: null` when no date is set or the date has passed, so
 * the widget never shows a stale promise.
 */
export async function GET(request: NextRequest) {
  const origin = resolveAllowedOrigin(request);
  if (!origin) {
    return NextResponse.json(
      { success: false, error: 'origin_not_allowed' },
      { status: 403, headers: { ...corsHeaders(null, ALLOWED_METHODS), 'Cache-Control': 'no-store' } }
    );
  }

  const headers = {
    ...corsHeaders(origin, ALLOWED_METHODS),
    // Short CDN cache: a staff edit shows up within a few minutes, and a busy
    // product page does not hit the database for every view.
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    'X-Content-Type-Options': 'nosniff',
  };

  const productId = request.nextUrl.searchParams.get('productId')?.trim() || '';
  if (!/^\d{1,32}$/.test(productId)) {
    return NextResponse.json(
      { success: false, error: 'product_id_required' },
      { status: 400, headers: { ...headers, 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const row = await prisma.sallaProductRestockEta.findUnique({
      where: { productId },
      select: { expectedAt: true },
    });
    const expectedDate = row ? dateColumnToIso(row.expectedAt) : null;
    const days = expectedDate ? daysBetween(riyadhToday(), expectedDate) : 0;

    return NextResponse.json(
      { success: true, eta: expectedDate && days >= 1 ? { days, expectedDate } : null },
      { headers }
    );
  } catch (error) {
    log.error('Failed to load restock ETA', { error, productId });
    return NextResponse.json(
      { success: false, error: 'unavailable' },
      { status: 500, headers: { ...headers, 'Cache-Control': 'no-store' } }
    );
  }
}
