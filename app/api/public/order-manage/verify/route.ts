import { NextRequest } from 'next/server';
import { log } from '@/app/lib/logger';
import { verifyAccess } from '@/app/lib/order-manage/access-service';
import {
  TOO_MANY,
  UNAVAILABLE,
  jsonNoStore,
  readJson,
  rejectForeignOrigin,
  requestIpHash,
  setSessionCookie,
} from '@/app/lib/order-manage/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/public/order-manage/verify { orderNumber, mobile, code }
 *
 * Exchanges a correct one-time code for a 30-minute session cookie. A wrong
 * code, an expired one and an unknown order all get the same answer.
 */
export async function POST(request: NextRequest) {
  const foreign = rejectForeignOrigin(request);
  if (foreign) return foreign;
  try {
    const body = await readJson(request);
    const result = await verifyAccess({
      orderNumber: body.orderNumber,
      mobile: body.mobile,
      code: body.code,
      ipHash: requestIpHash(request),
    });
    if (result.status === 'unavailable') return jsonNoStore(UNAVAILABLE, 503);
    if (result.status === 'rate_limited') return jsonNoStore(TOO_MANY, 429);
    if (result.status === 'invalid') {
      return jsonNoStore({ error: 'الرمز غير صحيح أو انتهت صلاحيته.', code: 'invalid_code' }, 400);
    }
    const response = jsonNoStore({ success: true });
    setSessionCookie(response, result.token, result.expiresAt);
    return response;
  } catch (error) {
    log.error('Order-manage verify failed', { error: error instanceof Error ? error.message : error });
    return jsonNoStore({ error: 'حدث خطأ، يرجى المحاولة لاحقاً.' }, 500);
  }
}
