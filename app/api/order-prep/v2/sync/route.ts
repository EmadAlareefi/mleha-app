import { NextResponse } from 'next/server';
import { processDueSyncJobs } from '@/app/lib/order-prep/salla-sync';
import { isCronAuthorized } from '@/app/lib/order-prep/route-auth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Vercel Cron, every minute: applies Salla status changes that are due or failed. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await processDueSyncJobs({ limit: 20, budgetMs: 45_000 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log.error('Order prep Salla sync worker failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'Worker failed' }, { status: 500 });
  }
}
