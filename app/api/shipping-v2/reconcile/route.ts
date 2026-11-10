import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/app/lib/order-prep/route-auth';
import { reconcileAwaitingLabels } from '@/app/lib/shipping/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cron (every 5 minutes): chase labels that didn't arrive by webhook. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ success: false }, { status: 401 });
  const result = await reconcileAwaitingLabels();
  return NextResponse.json({ success: true, ...result });
}
