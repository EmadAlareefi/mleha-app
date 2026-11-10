import { NextResponse } from 'next/server';
import { reconcileNewOrders } from '@/app/lib/order-prep/reconcile';
import { isCronAuthorized } from '@/app/lib/order-prep/route-auth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Vercel Cron: every 10 minutes (recent) and nightly (?mode=full). Adds
 * "طلب جديد" orders the mirror missed and re-reads ones it has wrong.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const mode = new URL(request.url).searchParams.get('mode') === 'full' ? 'full' : 'recent';
  try {
    const result = await reconcileNewOrders(mode);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log.error('Order prep reconcile failed', { mode, error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'Reconcile failed' }, { status: 500 });
  }
}
