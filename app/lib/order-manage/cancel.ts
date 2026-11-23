import { SallaCallError } from '@/app/lib/salla-transactions';
import {
  MESSAGES,
  beginChange,
  isLiveCancelled,
  type ActionOutcome,
  type ChangeRow,
  type EngineDeps,
  type Session,
} from './engine';

/**
 * Customer cancels their own order before a packer takes it.
 *
 * hold → live check → cancel in Salla (stock restored) → mirror updated →
 * hold released. The refund is a separate step (refund.ts) that runs right
 * after and is picked up by the worker if this request dies first.
 */

export const CANCEL_NOTE = 'تم إلغاء الطلب بطلب من العميل عبر صفحة إدارة الطلب.';

/**
 * After Salla confirmed the cancel: bring the mirror up to date, then release
 * the hold. The hold is only released once the mirror no longer shows the
 * order as new, otherwise the queue would hand a cancelled order to a packer.
 * Returns false when it must be tried again (the worker does).
 */
export async function finishCancel(deps: EngineDeps, change: ChangeRow): Promise<boolean> {
  const live = await deps.fetchLive(change.merchantId, change.orderId);
  let mirrored = false;
  if (live.kind === 'ok' && isLiveCancelled(live)) {
    mirrored = await deps.syncMirror(change.merchantId, live.detail).catch(() => false);
  }
  if (!mirrored) {
    try {
      await deps.markMirrorCancelled(change.merchantId, change.orderId);
      mirrored = true;
    } catch {
      return false;
    }
  }
  return deps.updateChange(change.id, { holdActive: true, writeStatus: 'done' }, {
    state: 'completed',
    holdActive: false,
    completedAt: deps.now(),
    lastError: null,
    after: live.kind === 'ok' ? { statusSlug: live.detail?.status?.slug ?? null, statusName: live.statusName } : null,
    step: { step: 'release', result: 'ok' },
  });
}

export async function cancelOrderForCustomer(
  deps: EngineDeps,
  input: { session: Session; idempotencyKey: unknown; ipHash: string | null },
): Promise<ActionOutcome> {
  const begun = await beginChange(deps, { ...input, kind: 'cancel', request: {} });
  if (begun.status === 'done') return begun.outcome;
  const { change } = begun;

  // Recorded before the call: if this process dies now, the write is treated
  // as "may have happened" and is never repeated blindly.
  const marked = await deps.updateChange(change.id, { state: 'held', writeStatus: 'none' }, {
    state: 'applying',
    writeStatus: 'requested',
    step: { step: 'cancel', result: 'requested' },
  });
  if (!marked) return { status: 'in_progress', changeId: change.id, message: MESSAGES.inProgress };

  try {
    await deps.cancelOrder(change.merchantId, change.orderId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = !(error instanceof SallaCallError) || error.outcomeUnknown;
    if (!unknown) {
      // Salla refused it: nothing changed, the order goes back to the queue.
      await deps.updateChange(change.id, { writeStatus: 'requested' }, {
        state: 'failed',
        holdActive: false,
        writeStatus: 'failed',
        lastError: message,
        completedAt: deps.now(),
        step: { step: 'cancel', result: 'failed', details: { error: message } },
      });
      return { status: 'failed', changeId: change.id, message: MESSAGES.failed };
    }
    // Timeout or 5xx: the cancel may have landed. One read settles the common case.
    const live = await deps.fetchLive(change.merchantId, change.orderId);
    if (!isLiveCancelled(live)) {
      await deps.updateChange(change.id, { writeStatus: 'requested' }, {
        state: 'needs_staff',
        writeStatus: 'unknown',
        lastError: message,
        step: { step: 'cancel', result: 'unknown', details: { error: message } },
      });
      return { status: 'pending_review', changeId: change.id, message: MESSAGES.pendingReview };
    }
  }

  await deps.updateChange(change.id, { writeStatus: 'requested' }, {
    writeStatus: 'done',
    step: { step: 'cancel', result: 'ok' },
  });
  await deps.addHistoryNote(change.merchantId, change.orderId, CANCEL_NOTE).catch(() => undefined);

  // Cancelled in Salla either way. If the mirror update or the release does
  // not go through here, the order simply stays held and the worker finishes it.
  await finishCancel(deps, { ...change, writeStatus: 'done' }).catch(() => false);
  return { status: 'completed', changeId: change.id };
}
