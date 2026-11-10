import { NextResponse } from 'next/server';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { requireShipper, stationError } from '@/app/lib/shipping/route-auth';
import { createNowForStation, getStationView } from '@/app/lib/shipping/station';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { orderId }: ask Salla for the shipment now (unpacked or failed orders). */
export async function POST(request: Request) {
  const auth = await requireShipper();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    if (!orderId) return NextResponse.json({ success: false, error: { code: 'invalid', message: 'رقم الطلب مطلوب' } }, { status: 400 });
    const result = await createNowForStation(orderId);
    const view = (await getStationView(orderId).catch(() => null))?.view ?? null;
    if (!result.ok) return NextResponse.json({ success: false, error: result.error, view }, { status: result.status });
    return NextResponse.json({ success: true, view, message: result.message });
  } catch (error) {
    return stationError('create-now', error);
  }
}
