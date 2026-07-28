import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { runAvailabilityStockCheck } from '@/app/lib/availability-stock-watcher';

export const runtime = 'nodejs';
// Polling Salla for every waiting product takes longer than the default budget.
export const maxDuration = 300;

/**
 * Scheduled re-stock check. Called by the Vercel cron entry in vercel.json, or by
 * any external scheduler that can send the CRON_SECRET bearer token.
 *
 * Pass ?dryRun=1 to detect and report what *would* be sent without sending
 * anything — worth doing once against live data before enabling the schedule.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    log.warn('Unauthorized availability stock check attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = ['1', 'true', 'yes'].includes(
    (new URL(request.url).searchParams.get('dryRun') || '').toLowerCase()
  );

  try {
    const result = await runAvailabilityStockCheck({ dryRun });
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    log.error('Availability stock check failed', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
