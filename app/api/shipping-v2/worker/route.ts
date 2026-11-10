import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/app/lib/order-prep/route-auth';
import { processDueShippingTasks } from '@/app/lib/shipping/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cron (every minute): create shipments for packed orders that are due. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ success: false }, { status: 401 });
  const result = await processDueShippingTasks();
  return NextResponse.json({ success: true, ...result });
}
