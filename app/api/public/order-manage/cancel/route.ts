import { NextRequest, after } from 'next/server';
import { log } from '@/app/lib/logger';
import { cancelOrderForCustomer } from '@/app/lib/order-manage/cancel';
import { productionEngineDeps } from '@/app/lib/order-manage/engine-deps';
import type { ActionOutcome } from '@/app/lib/order-manage/engine';
import { SIGNED_OUT, jsonNoStore, readJson, rejectForeignOrigin, requestIpHash, sessionFromRequest } from '@/app/lib/order-manage/http';
import { processCancelRefund } from '@/app/lib/order-manage/refund';
import { getOrderManageSettings } from '@/app/lib/order-manage/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HTTP_STATUS: Record<ActionOutcome['status'], number> = {
  completed: 200,
  pending_review: 202,
  in_progress: 409,
  denied: 409,
  failed: 502,
};

/**
 * POST /api/public/order-manage/cancel { idempotencyKey }
 *
 * The signed-in customer cancels their order. Refused once a packer has it.
 * Sending the same key again returns the first result instead of acting twice.
 */
export async function POST(request: NextRequest) {
  const foreign = rejectForeignOrigin(request);
  if (foreign) return foreign;
  try {
    const session = await sessionFromRequest(request);
    if (!session) return jsonNoStore(SIGNED_OUT, 401);
    const body = await readJson(request);
    const outcome = await cancelOrderForCustomer(productionEngineDeps, {
      session,
      idempotencyKey: body.idempotencyKey,
      ipHash: requestIpHash(request),
    });
    if (outcome.status === 'completed') {
      // The customer is not kept waiting for the refund; the worker picks it
      // up if this does not finish.
      after(async () => {
        try {
          await processCancelRefund(productionEngineDeps, outcome.changeId, await getOrderManageSettings());
        } catch (error) {
          log.error('Order-manage refund after cancel failed', {
            changeId: outcome.changeId,
            error: error instanceof Error ? error.message : error,
          });
        }
      });
    }
    return jsonNoStore(outcome, HTTP_STATUS[outcome.status]);
  } catch (error) {
    log.error('Order-manage cancel failed', { error: error instanceof Error ? error.message : error });
    return jsonNoStore({ status: 'failed', message: 'حدث خطأ، يرجى المحاولة لاحقاً.' }, 500);
  }
}
