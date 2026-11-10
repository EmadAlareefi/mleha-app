import { NextResponse } from 'next/server';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { requireShipper, stationError } from '@/app/lib/shipping/route-auth';
import { getStationView, printForStation } from '@/app/lib/shipping/station';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { orderId, printKey }: print the order's label on the station printer. */
export async function POST(request: Request) {
  const auth = await requireShipper();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const printKey = typeof body.printKey === 'string' ? body.printKey.slice(0, 80) : '';
    if (!orderId || !printKey) {
      return NextResponse.json({ success: false, error: { code: 'invalid', message: 'بيانات ناقصة' } }, { status: 400 });
    }
    const result = await printForStation(orderId, auth.user, printKey);
    const view = (await getStationView(orderId).catch(() => null))?.view ?? null;
    if (!result.ok) return NextResponse.json({ success: false, error: result.error, view }, { status: result.status });
    return NextResponse.json({ success: true, view, message: result.message });
  } catch (error) {
    return stationError('print', error);
  }
}
