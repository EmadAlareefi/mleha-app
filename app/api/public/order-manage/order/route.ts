import { NextRequest } from 'next/server';
import { log } from '@/app/lib/logger';
import { loadOrderContext } from '@/app/lib/order-manage/facts';
import { SIGNED_OUT, UNAVAILABLE, jsonNoStore, sessionFromRequest } from '@/app/lib/order-manage/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/order-manage/order
 *
 * The signed-in customer's order: its lines, what they may still do to it and
 * what they already changed. Read from the local mirror only.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return jsonNoStore(SIGNED_OUT, 401);
    const context = await loadOrderContext(session.merchantId, session.orderId);
    if (!context) return jsonNoStore(SIGNED_OUT, 401);
    if (!context.settings.enabled) return jsonNoStore(UNAVAILABLE, 503);
    return jsonNoStore({ success: true, order: context.view, actions: context.verdicts });
  } catch (error) {
    log.error('Order-manage order read failed', { error: error instanceof Error ? error.message : error });
    return jsonNoStore({ error: 'حدث خطأ، يرجى المحاولة لاحقاً.' }, 500);
  }
}
