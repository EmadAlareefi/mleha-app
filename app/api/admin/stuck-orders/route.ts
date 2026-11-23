import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { getStuckOrdersCached } from '@/app/lib/stuck-orders/cache';
import { searchStuckOrders } from '@/app/lib/stuck-orders/load';
import { parseThreshold } from '@/app/lib/stuck-orders/threshold';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?threshold=24 → the stuck list (cached up to 45 s; &fresh=1 skips the cache);
 * with &q= → search results (stuck or not, never cached).
 */
export async function GET(request: Request) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const thresholdHours = parseThreshold(searchParams.get('threshold'));
    const q = (searchParams.get('q') || '').trim();
    if (q) {
      const items = await searchStuckOrders(q, thresholdHours);
      return NextResponse.json({ success: true, search: { query: q, items } });
    }
    const result = await getStuckOrdersCached(thresholdHours, { fresh: searchParams.get('fresh') === '1' });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    log.error('Stuck orders load failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل الطلبات العالقة' }, { status: 500 });
  }
}
