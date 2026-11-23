import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { isCronAuthorized } from '@/app/lib/order-prep/route-auth';
import { runShippingInfoWorker } from '@/app/lib/shipping-info/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron, every 15 minutes: the 24h reminder, retries of failed Salla
 * updates, and closing requests whose order left the hold status another way.
 * Runs even when the feature is switched off so open requests still finish.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runShippingInfoWorker();
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    log.error('Shipping-info worker failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'Worker failed' }, { status: 500 });
  }
}
