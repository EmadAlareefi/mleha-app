import type { LiveOrderResult } from '@/app/lib/order-prep/salla-live';
import type { HistoryRefund, SallaTransaction } from '@/app/lib/salla-transactions';
import { DENY_REASONS, NEW_ORDER_STATUS_ID, type DenyCode, type Verdicts } from './eligibility';
import type { OrderManageAction, OrderManageSettings } from './settings';

/**
 * The part every customer action shares: idempotent replay, eligibility, the
 * hold taken under the order-prep claim lock, and a live check that the order
 * is still "طلب جديد" before anything is written to Salla.
 *
 * Rules that keep money and stock safe:
 *  - nothing is written to Salla before the hold exists;
 *  - `writeStatus` is set to `requested` before a write is sent, so a crash
 *    mid-call is treated as "may have happened", never as "did not happen";
 *  - a write whose outcome is unknown is never sent again by this code. The
 *    change goes to `needs_staff` and keeps its hold.
 *
 * All I/O goes through `EngineDeps` so the flows run against fakes in tests.
 */

export type ChangeState = 'held' | 'applying' | 'awaiting_payment' | 'completed' | 'failed' | 'needs_staff';
export type WriteStatus = 'none' | 'requested' | 'done' | 'failed' | 'unknown';
export type RefundStatus = 'none' | 'not_needed' | 'requested' | 'refunded' | 'manual' | 'failed' | 'unknown';

export type ChangeRow = {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  kind: OrderManageAction;
  state: ChangeState;
  holdActive: boolean;
  idempotencyKey: string;
  writeStatus: WriteStatus;
  refundStatus: RefundStatus;
  refundAmount: number | null;
  refundTransactionId: string | null;
  currency: string | null;
  paymentMethod: string | null;
  /** Order total when the change started (what a full refund must equal). */
  orderTotal: number | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChangePatch = Partial<
  Pick<
    ChangeRow,
    'state' | 'holdActive' | 'writeStatus' | 'refundStatus' | 'refundAmount' | 'refundTransactionId' | 'currency' | 'lastError'
  >
> & {
  refundError?: string | null;
  refundedAt?: Date | null;
  completedAt?: Date | null;
  after?: unknown;
  step?: { step: string; result: string; details?: Record<string, unknown> };
};

export type ChangeWhere = Partial<Pick<ChangeRow, 'state' | 'holdActive' | 'writeStatus'>> & {
  refundStatus?: RefundStatus | RefundStatus[];
};

export type EngineContext = {
  verdicts: Verdicts;
  settings: OrderManageSettings;
  orderNumber: string;
  total: number | null;
  currency: string;
  paymentMethod: string | null;
  /** Snapshot stored on the change row for staff. */
  snapshot: unknown;
};

export type NewHold = {
  merchantId: string;
  orderId: string;
  orderNumber: string;
  kind: OrderManageAction;
  idempotencyKey: string;
  accessId: string | null;
  ipHash: string | null;
  request: unknown;
  before: unknown;
  paymentMethod: string | null;
  currency: string;
  orderTotal: number | null;
};

export interface EngineDeps {
  now(): Date;
  /** Outside production only allowlisted test orders may be written to. */
  writeAllowed(orderId: string): boolean;
  loadContext(merchantId: string, orderId: string): Promise<EngineContext | null>;
  findChange(id: string): Promise<ChangeRow | null>;
  findChangeByKey(idempotencyKey: string): Promise<ChangeRow | null>;
  countHoldsSince(since: Date): Promise<number>;
  /** Inserts the hold under the order-prep claim lock; null when a packer has the order. */
  createHold(input: NewHold): Promise<ChangeRow | null>;
  /** Compare-and-set: false when the row no longer matches `where`. */
  updateChange(id: string, where: ChangeWhere, patch: ChangePatch): Promise<boolean>;
  fetchLive(merchantId: string, orderId: string): Promise<LiveOrderResult>;
  /** Writes a live order into the local mirror; false when it could not. */
  syncMirror(merchantId: string, detail: Record<string, any>): Promise<boolean>;
  /** Last resort when the mirror cannot be synced: take the order out of the queue. */
  markMirrorCancelled(merchantId: string, orderId: string): Promise<void>;
  cancelOrder(merchantId: string, orderId: string): Promise<void>;
  addHistoryNote(merchantId: string, orderId: string, note: string): Promise<void>;
  listTransactions(merchantId: string, orderId: string): Promise<SallaTransaction[]>;
  findHistoryRefunds(merchantId: string, orderId: string): Promise<HistoryRefund[]>;
  refund(merchantId: string, transactionId: string | number, amount: number, currency: string, transactionTotal: number): Promise<unknown>;
  /** SAR already sent back automatically since `since`. */
  autoRefundedSince(since: Date): Promise<number>;
}

export type Session = { accessId: string; merchantId: string; orderId: string };

export type ActionOutcome =
  | { status: 'completed'; changeId: string }
  /** The request was received but its result needs a person to confirm. */
  | { status: 'pending_review'; changeId: string; message: string }
  | { status: 'in_progress'; changeId: string; message: string }
  | { status: 'denied'; code: DenyCode | 'try_later'; message: string }
  | { status: 'failed'; changeId: string; message: string };

export const MESSAGES = {
  tryLater: 'تعذر تنفيذ طلبك الآن. يرجى المحاولة بعد قليل.',
  pendingReview: 'استلمنا طلبك وجاري تأكيده. سيتواصل معك فريق خدمة العملاء إن لزم الأمر.',
  inProgress: 'طلبك قيد التنفيذ الآن.',
  failed: 'لم نتمكن من تنفيذ طلبك، ولم يتغير شيء في الطلب. يرجى المحاولة مرة أخرى أو التواصل مع خدمة العملاء.',
} as const;

/** New holds allowed per minute across all customers, to stay inside Salla's rate limit. */
export const MAX_HOLDS_PER_MINUTE = 10;

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Scoped to the order and action, so one customer's key can never match another's change. */
export function scopedKey(orderId: string, kind: OrderManageAction, key: unknown): string | null {
  return typeof key === 'string' && KEY_PATTERN.test(key) ? `${orderId}:${kind}:${key}` : null;
}

export const deny = (code: DenyCode): ActionOutcome => ({ status: 'denied', code, message: DENY_REASONS[code] });
export const tryLater = (): ActionOutcome => ({ status: 'denied', code: 'try_later', message: MESSAGES.tryLater });

/** What a repeated request is told about the change it already started. */
export function outcomeOfChange(change: ChangeRow): ActionOutcome {
  if (change.state === 'completed') return { status: 'completed', changeId: change.id };
  if (change.state === 'needs_staff') return { status: 'pending_review', changeId: change.id, message: MESSAGES.pendingReview };
  if (change.state === 'failed') return { status: 'failed', changeId: change.id, message: MESSAGES.failed };
  return { status: 'in_progress', changeId: change.id, message: MESSAGES.inProgress };
}

export function isLiveNewOrder(live: LiveOrderResult): boolean {
  return live.kind === 'ok' && live.statusCustomId === NEW_ORDER_STATUS_ID;
}

export function isLiveCancelled(live: LiveOrderResult): boolean {
  if (live.kind !== 'ok') return false;
  const slug = String(live.detail?.status?.slug || '').toLowerCase();
  return slug === 'canceled' || slug === 'cancelled';
}

export type BeginResult =
  | { status: 'ready'; change: ChangeRow; context: EngineContext; live: Extract<LiveOrderResult, { kind: 'ok' }> }
  | { status: 'done'; outcome: ActionOutcome };

/**
 * Everything up to the first Salla write. On `ready` the order is held (no
 * packer or shipper can take it) and was "طلب جديد" in Salla a moment ago.
 * On any other answer nothing was written and no hold is left behind.
 */
export async function beginChange(
  deps: EngineDeps,
  input: { session: Session; kind: OrderManageAction; idempotencyKey: unknown; ipHash: string | null; request: unknown },
): Promise<BeginResult> {
  const { session, kind } = input;
  const key = scopedKey(session.orderId, kind, input.idempotencyKey);
  if (!key) return { status: 'done', outcome: tryLater() };

  const existing = await deps.findChangeByKey(key);
  if (existing) return { status: 'done', outcome: outcomeOfChange(existing) };

  const context = await deps.loadContext(session.merchantId, session.orderId);
  if (!context) return { status: 'done', outcome: deny('unavailable') };
  const verdict = context.verdicts[kind];
  if (!verdict.allowed) return { status: 'done', outcome: deny(verdict.code) };
  if (!deps.writeAllowed(session.orderId)) return { status: 'done', outcome: deny('unavailable') };

  const now = deps.now();
  if ((await deps.countHoldsSince(new Date(now.getTime() - 60_000))) >= MAX_HOLDS_PER_MINUTE) {
    return { status: 'done', outcome: tryLater() };
  }

  const change = await deps.createHold({
    merchantId: session.merchantId,
    orderId: session.orderId,
    orderNumber: context.orderNumber,
    kind,
    idempotencyKey: key,
    accessId: session.accessId,
    ipHash: input.ipHash,
    request: input.request,
    before: context.snapshot,
    paymentMethod: context.paymentMethod,
    currency: context.currency,
    orderTotal: context.total,
  });
  if (!change) {
    // Either a packer took the order, or the same request raced itself.
    const raced = await deps.findChangeByKey(key);
    return { status: 'done', outcome: raced ? outcomeOfChange(raced) : deny('in_progress') };
  }

  const live = await deps.fetchLive(session.merchantId, session.orderId);
  if (live.kind === 'ok' && isLiveNewOrder(live)) return { status: 'ready', change, context, live };

  // Nothing was written, so the hold can go. A changed order also fixes the mirror.
  if (live.kind === 'ok') await deps.syncMirror(session.merchantId, live.detail).catch(() => false);
  const reason = live.kind === 'ok' ? `live_status:${live.statusCustomId ?? 'unknown'}` : `live_read:${live.kind}`;
  await deps.updateChange(change.id, { state: 'held', writeStatus: 'none' }, {
    state: 'failed',
    holdActive: false,
    lastError: reason,
    completedAt: deps.now(),
    step: { step: 'live_check', result: 'stopped', details: { reason } },
  });
  if (live.kind === 'ok') return { status: 'done', outcome: deny(isLiveCancelled(live) ? 'cancelled' : 'in_progress') };
  if (live.kind === 'not_found') return { status: 'done', outcome: deny('not_editable') };
  return { status: 'done', outcome: tryLater() };
}
