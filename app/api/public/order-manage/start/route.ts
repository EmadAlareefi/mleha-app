import { NextRequest } from 'next/server';
import { log } from '@/app/lib/logger';
import { startAccess } from '@/app/lib/order-manage/access-service';
import { TOO_MANY, UNAVAILABLE, jsonNoStore, readJson, rejectForeignOrigin, requestIpHash } from '@/app/lib/order-manage/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/public/order-manage/start { orderNumber, mobile, channel? }
 *
 * First step of the /my-order sign-in: sends a one-time code to the order's
 * mobile. The answer is the same for an unknown order and a wrong mobile as
 * for a match, so it cannot be used to test numbers.
 */
export async function POST(request: NextRequest) {
  const foreign = rejectForeignOrigin(request);
  if (foreign) return foreign;
  try {
    const body = await readJson(request);
    const result = await startAccess({
      orderNumber: body.orderNumber,
      mobile: body.mobile,
      channel: body.channel,
      ipHash: requestIpHash(request),
    });
    switch (result.status) {
      case 'sent':
        return jsonNoStore({ success: true });
      case 'unavailable':
        return jsonNoStore(UNAVAILABLE, 503);
      case 'rate_limited':
        return jsonNoStore(TOO_MANY, 429);
      case 'wait':
        return jsonNoStore(
          { error: 'تم إرسال رمز قبل قليل. انتظري قليلاً قبل طلب رمز جديد.', code: 'wait', retryAfterSeconds: result.retryAfterSeconds },
          429,
        );
      case 'limit':
        return jsonNoStore({ error: 'تم إرسال عدة رموز لهذا الطلب. حاولي لاحقاً أو تواصلي مع خدمة العملاء.', code: 'limit' }, 429);
      case 'send_failed':
        return jsonNoStore({ error: 'تعذر إرسال رمز التحقق. حاولي مرة أخرى بعد قليل.', code: 'send_failed' }, 502);
    }
  } catch (error) {
    log.error('Order-manage start failed', { error: error instanceof Error ? error.message : error });
    return jsonNoStore({ error: 'حدث خطأ، يرجى المحاولة لاحقاً.' }, 500);
  }
}
