import { NextResponse } from 'next/server';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { requireShipper, stationError } from '@/app/lib/shipping/route-auth';
import { getStationView, shipLocalForStation } from '@/app/lib/shipping/station';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { orderId, deliveryAgentId }: local delivery with our own agent. */
export async function POST(request: Request) {
  const auth = await requireShipper();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const agentId =
      typeof body.deliveryAgentId === 'string' ? body.deliveryAgentId.trim() : typeof body.deliveryAgentId === 'number' ? String(body.deliveryAgentId) : '';
    if (!orderId || !agentId) {
      return NextResponse.json({ success: false, error: { code: 'invalid', message: 'اختر المندوب' } }, { status: 400 });
    }
    const result = await shipLocalForStation(orderId, agentId, auth.user);
    const view = (await getStationView(orderId).catch(() => null))?.view ?? null;
    if (!result.ok) return NextResponse.json({ success: false, error: result.error, view }, { status: result.status });
    return NextResponse.json({ success: true, view, message: result.message });
  } catch (error) {
    return stationError('local', error);
  }
}
