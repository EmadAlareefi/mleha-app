import { finishCancel } from './cancel';
import { isLiveCancelled, type ChangeRow, type EngineDeps } from './engine';
import { processCancelRefund, type RefundRunResult } from './refund';

/**
 * What a supervisor can do to a customer change that needs a person. Every
 * action is a compare-and-set, so two supervisors clicking at once cannot both
 * act, and none of them re-sends a Salla write whose outcome is unknown
 * without first reading what Salla shows.
 */

export type StaffResult = { ok: boolean; message: string };

const done = (message: string): StaffResult => ({ ok: true, message });
const refused = (message: string): StaffResult => ({ ok: false, message });

const STALE = 'تغيّرت حالة هذا الطلب. حدّث الصفحة.';

/**
 * A cancel whose outcome was unknown: settled by what Salla shows now.
 * Cancelled there → finish it (the refund step follows). Not cancelled →
 * nothing happened, release the order back to the queue.
 */
export async function resolveUnknownCancel(deps: EngineDeps, changeId: string, actor: string): Promise<StaffResult> {
  const change = await deps.findChange(changeId);
  if (!change || change.kind !== 'cancel' || change.state !== 'needs_staff' || change.writeStatus !== 'unknown') return refused(STALE);

  const live = await deps.fetchLive(change.merchantId, change.orderId);
  if (live.kind === 'rate_limited' || live.kind === 'error') return refused('تعذر قراءة الطلب من سلة الآن. حاول بعد قليل.');

  if (isLiveCancelled(live)) {
    const confirmed = await deps.updateChange(change.id, { state: 'needs_staff', writeStatus: 'unknown' }, {
      state: 'applying',
      writeStatus: 'done',
      lastError: null,
      step: { step: 'staff', result: 'cancel_confirmed', details: { by: actor } },
    });
    if (!confirmed) return refused(STALE);
    const finished = await finishCancel(deps, { ...change, state: 'applying', writeStatus: 'done' }).catch(() => false);
    return done(finished ? 'الطلب ملغي في سلة. تم إنهاء الطلب وسيُعالج الاسترجاع.' : 'الطلب ملغي في سلة. سيكتمل الإنهاء خلال دقيقة.');
  }

  // Salla does not show a cancel: it did not happen. Fix the mirror if the
  // order moved to another status meanwhile, then let the order go.
  if (live.kind === 'ok') await deps.syncMirror(change.merchantId, live.detail).catch(() => false);
  const released = await deps.updateChange(change.id, { state: 'needs_staff', writeStatus: 'unknown' }, {
    state: 'failed',
    writeStatus: 'failed',
    holdActive: false,
    completedAt: deps.now(),
    step: { step: 'staff', result: 'released_not_cancelled', details: { by: actor } },
  });
  return released ? done('الطلب غير ملغي في سلة. أُعيد إلى طابور التجهيز.') : refused(STALE);
}

/** Staff sent the money back themselves (bank transfer, Tabby portal, Salla dashboard). */
export async function markRefundDone(deps: EngineDeps, changeId: string, actor: string): Promise<StaffResult> {
  const change = await deps.findChange(changeId);
  if (!change) return refused(STALE);
  const marked = await deps.updateChange(change.id, { refundStatus: ['manual', 'failed', 'unknown'] }, {
    refundStatus: 'refunded',
    refundedAt: deps.now(),
    refundError: null,
    step: { step: 'staff', result: 'refund_marked_done', details: { by: actor } },
  });
  return marked ? done('تم تسجيل الاسترجاع.') : refused(STALE);
}

/** Staff checked Salla: the refund whose outcome was unknown did not go out. */
export async function markRefundNotSent(deps: EngineDeps, changeId: string, actor: string): Promise<StaffResult> {
  const change = await deps.findChange(changeId);
  if (!change) return refused(STALE);
  const marked = await deps.updateChange(change.id, { refundStatus: 'unknown' }, {
    refundStatus: 'failed',
    refundError: 'أكد المشرف أن الاسترجاع لم يتم في سلة.',
    step: { step: 'staff', result: 'refund_marked_not_sent', details: { by: actor } },
  });
  return marked ? done('تم. يمكن الآن إعادة الاسترجاع عبر سلة أو تسجيله يدوياً.') : refused(STALE);
}

const RETRY_MESSAGES: Partial<Record<RefundRunResult, StaffResult>> = {
  refunded: done('تم استرجاع المبلغ عبر سلة.'),
  not_needed: done('لا يوجد مبلغ للاسترجاع.'),
  manual: refused('لا يمكن الاسترجاع عبر سلة لهذا الطلب. استرجع المبلغ يدوياً ثم سجّله.'),
  failed: refused('رفضت سلة الاسترجاع. راجع السبب الظاهر على الطلب.'),
  unknown: refused('لم تتأكد نتيجة الاسترجاع. تحقق من سلة قبل أي محاولة أخرى.'),
  retry_later: refused('تعذر قراءة عمليات الدفع من سلة. حاول بعد قليل.'),
  skipped: refused(STALE),
};

/**
 * A supervisor asking for the refund is the approval the automatic path
 * lacks, so the auto-refund switch and the daily cap do not apply. Every
 * other safety rule (one refundable SAR payment equal to the order total, no
 * earlier refund) still does.
 */
export async function retryRefundViaSalla(deps: EngineDeps, changeId: string): Promise<StaffResult> {
  const result = await processCancelRefund(
    deps,
    changeId,
    { autoRefundEnabled: true, autoRefundDailyCapSar: Number.MAX_SAFE_INTEGER },
    { staffRetry: true },
  );
  return RETRY_MESSAGES[result] ?? refused(STALE);
}

export type BoardBucket = 'attention' | 'manual_refund' | 'other';

/** Where a change shows on the supervisor page. */
export function bucketOf(change: Pick<ChangeRow, 'state' | 'refundStatus' | 'holdActive' | 'updatedAt'>, now: Date): BoardBucket {
  const stuck = change.holdActive && now.getTime() - change.updatedAt.getTime() > 5 * 60_000;
  if (change.state === 'needs_staff' || stuck || change.refundStatus === 'unknown' || change.refundStatus === 'failed') return 'attention';
  if (change.refundStatus === 'manual') return 'manual_refund';
  return 'other';
}
