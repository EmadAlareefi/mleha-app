import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { isCronAuthorized } from '@/app/lib/order-prep/route-auth';
import { productionEngineDeps, productionWorkerStore } from '@/app/lib/order-manage/engine-deps';
import { getOrderManageSettings } from '@/app/lib/order-manage/settings';
import { runOrderManageWorker } from '@/app/lib/order-manage/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron, every minute: finishes customer order changes a request left
 * half done and decides refunds that are still open. Runs even when the
 * feature is switched off, so nothing already started is left hanging.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runOrderManageWorker(productionEngineDeps, productionWorkerStore, await getOrderManageSettings({ fresh: true }));
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    log.error('Order-manage worker failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'Worker failed' }, { status: 500 });
  }
}
