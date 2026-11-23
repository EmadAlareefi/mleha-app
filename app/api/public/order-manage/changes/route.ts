import { NextRequest, after } from 'next/server';
import { log } from '@/app/lib/logger';
import { cancelOrderForCustomer } from '@/app/lib/order-manage/cancel';
import { productionEngineDeps, productionItemDeps } from '@/app/lib/order-manage/engine-deps';
import { SIGNED_OUT, jsonNoStore, readJson, rejectForeignOrigin, requestIpHash, sessionFromRequest } from '@/app/lib/order-manage/http';
import { applyItemChanges, cancelsWholeOrder, liveLines, processItemsRefund, serviceNumber, type PieceRequest } from '@/app/lib/order-manage/items';
import { processCancelRefund } from '@/app/lib/order-manage/refund';
import { getOrderManageSettings } from '@/app/lib/order-manage/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STATUS: Record<string, number> = {
  completed: 200,
  awaiting_payment: 200,
  pending_review: 202,
  in_progress: 409,
  denied: 409,
  failed: 502,
};

const MAX_PIECES = 20;

function readPieces(raw: unknown): PieceRequest[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PIECES) return null;
  const pieces: PieceRequest[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const piece = entry as Record<string, unknown>;
    const action = String(piece.action);
    if (action !== 'cancel' && action !== 'size' && action !== 'product') return null;
    pieces.push({
      itemId: String(piece.itemId ?? '').replace(/\D/g, ''),
      action,
      reason: String(piece.reason ?? '').slice(0, 120),
      note: typeof piece.note === 'string' ? piece.note.slice(0, 500) : undefined,
      productId: piece.productId ? String(piece.productId).replace(/\D/g, '') : undefined,
      optionValueIds: Array.isArray(piece.optionValueIds) ? piece.optionValueIds.slice(0, 5).map((id) => String(id).replace(/\D/g, '')) : undefined,
    });
  }
  return pieces;
}

/**
 * POST /api/public/order-manage/changes { idempotencyKey, pieces: [{ itemId, action, reason, note?, productId?, optionValueIds? }] }
 *
 * The signed-in customer cancels pieces, changes sizes or swaps products
 * (returns prototype screens 29–39). Cancelling every piece cancels the order.
 */
export async function POST(request: NextRequest) {
  const foreign = rejectForeignOrigin(request);
  if (foreign) return foreign;
  try {
    const session = await sessionFromRequest(request);
    if (!session) return jsonNoStore(SIGNED_OUT, 401);
    const body = await readJson(request);
    const pieces = readPieces(body.pieces);
    if (!pieces) return jsonNoStore({ status: 'denied', message: 'بيانات الطلب غير صحيحة.' }, 400);
    const ipHash = requestIpHash(request);
    const settings = await getOrderManageSettings();

    const live = await productionEngineDeps.fetchLive(session.merchantId, session.orderId);
    if (live.kind === 'ok' && cancelsWholeOrder(liveLines(live.detail), pieces)) {
      const outcome = await cancelOrderForCustomer(productionEngineDeps, { session, idempotencyKey: body.idempotencyKey, ipHash });
      if (outcome.status === 'completed') {
        after(() => processCancelRefund(productionEngineDeps, outcome.changeId, settings).catch((error) => {
          log.error('Order-manage refund after cancel failed', { changeId: outcome.changeId, error: error instanceof Error ? error.message : error });
        }));
      }
      return jsonNoStore({ ...outcome, wholeOrder: true, ...('changeId' in outcome ? { serviceNumber: serviceNumber(outcome.changeId) } : {}) }, STATUS[outcome.status] ?? 200);
    }

    const outcome = await applyItemChanges(productionItemDeps, { session, idempotencyKey: body.idempotencyKey, ipHash, pieces });
    if (outcome.status === 'completed' && outcome.refundAmount > 0) {
      after(() => processItemsRefund(productionItemDeps, outcome.changeId, settings).catch((error) => {
        log.error('Order-manage items refund failed', { changeId: outcome.changeId, error: error instanceof Error ? error.message : error });
      }));
    }
    return jsonNoStore({ ...outcome, ...('changeId' in outcome ? { serviceNumber: serviceNumber(outcome.changeId) } : {}) }, STATUS[outcome.status] ?? 200);
  } catch (error) {
    log.error('Order-manage change failed', { error: error instanceof Error ? error.message : error });
    return jsonNoStore({ status: 'failed', message: 'حدث خطأ، يرجى المحاولة لاحقاً.' }, 500);
  }
}
