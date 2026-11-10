import { after, NextResponse } from 'next/server';
import { requireShipper, stationError } from '@/app/lib/shipping/route-auth';
import { findOrderIdByCode, getStationView } from '@/app/lib/shipping/station';
import { processShippingTask } from '@/app/lib/shipping/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?code=<scan> or ?orderId=<id>: the order's station card, from the
 * database only. A courier order still waiting for its shipment is pushed
 * through right after the response (the page polls for the result).
 */
export async function GET(request: Request) {
  const auth = await requireShipper();
  if ('response' in auth) return auth.response;
  try {
    const url = new URL(request.url);
    const orderIdParam = url.searchParams.get('orderId')?.trim();
    const code = url.searchParams.get('code')?.trim();
    const orderId = orderIdParam || (code ? await findOrderIdByCode(code) : null);
    if (!orderId) {
      return NextResponse.json(
        { success: false, error: { code: 'not_found', message: `لم يتم العثور على طلب بالرقم ${code ?? ''}`.trim() } },
        { status: 404 },
      );
    }
    const result = await getStationView(orderId);
    if (!result) {
      return NextResponse.json({ success: false, error: { code: 'not_found', message: 'الطلب غير موجود في النظام' } }, { status: 404 });
    }
    if (result.kickTaskId) {
      const taskId = result.kickTaskId;
      after(() => processShippingTask(taskId, { force: true }).then(() => undefined));
    }
    return NextResponse.json({ success: true, view: result.view });
  } catch (error) {
    return stationError('lookup', error);
  }
}
