import { after, NextResponse } from 'next/server';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { processSyncJobsNow } from '@/app/lib/order-prep/salla-sync';
import { requireShipper, stationError } from '@/app/lib/shipping/route-auth';
import { getStationView, reportShippingProblem } from '@/app/lib/shipping/station';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { orderId, reason, note }: stop the order at shipping. */
export async function POST(request: Request) {
  const auth = await requireShipper();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : 'other';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    if (!orderId) return NextResponse.json({ success: false, error: { code: 'invalid', message: 'رقم الطلب مطلوب' } }, { status: 400 });
    const result = await reportShippingProblem(orderId, { reason, note }, auth.user);
    if (result.ok && result.value.syncJobId) {
      const jobId = result.value.syncJobId;
      after(() => processSyncJobsNow([jobId]));
    }
    const view = (await getStationView(orderId).catch(() => null))?.view ?? null;
    if (!result.ok) return NextResponse.json({ success: false, error: result.error, view }, { status: result.status });
    return NextResponse.json({ success: true, view, message: result.message });
  } catch (error) {
    return stationError('problem', error);
  }
}
