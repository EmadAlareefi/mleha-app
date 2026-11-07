import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { runReturnsAutoProgress } from '@/app/lib/returns/auto-progress';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * GET /api/returns/auto-progress — Vercel cron (see vercel.json).
 * Marks delivered returns as received, flags orders restored outside the app,
 * and settles refunds whose outcome was unknown from the Salla order history.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const report = await runReturnsAutoProgress();
    log.info('Returns auto-progress finished', { ...report });
    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    log.error('Returns auto-progress failed', { error });
    return NextResponse.json({ error: 'auto-progress failed' }, { status: 500 });
  }
}
