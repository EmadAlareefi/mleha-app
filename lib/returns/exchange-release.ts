/**
 * When a replacement (exchange) order may leave the hold, and whether Salla's
 * live status allows the move. Pure, so the rules are testable without Salla.
 *
 * A replacement order the app created waits in "تحت المراجعة حجز قطع" until the
 * customer has paid any difference AND the returned pieces are back and pass
 * inspection; then it goes to "طلب جديد" so order-prep packs it.
 */

export type ReleaseBlock =
  | 'no_active_hold'
  | 'payment_pending'
  | 'shipment_not_received'
  | 'items_not_inspected'
  | 'items_failed';

export interface ReleasePiece {
  type?: string | null;
  conditionStatus?: string | null;
}

export interface ReleaseCandidate {
  status: string;
  receivedAt?: Date | string | null;
  exchangeMode?: string | null;
  exchangePaymentStatus?: string | null;
  exchangeOrderId?: string | null;
  exchangeOrderHoldActive?: boolean | null;
  items: ReleasePiece[];
}

export const RELEASE_BLOCK_LABELS: Record<ReleaseBlock, string> = {
  no_active_hold: 'لا يوجد طلب بديل محجوز',
  payment_pending: 'العميل لم يدفع الفرق بعد',
  shipment_not_received: 'لم تصل القطعة المرتجعة للمستودع بعد',
  items_not_inspected: 'لم يكتمل فحص القطعة المرتجعة',
  items_failed: 'القطعة المرتجعة ليست بحالة جيدة',
};

const PAID = new Set(['paid', 'not_required']);

/** The goods are back: carrier/warehouse says so, or someone inspected them. */
export function exchangeReturnArrived(request: ReleaseCandidate): boolean {
  if (request.status === 'delivered' || request.status === 'completed') return true;
  if (request.receivedAt) return true;
  return request.items.some((item) => Boolean(item.conditionStatus));
}

/**
 * Pieces whose inspection gates the replacement. For app-created orders only the
 * exchanged pieces matter (the returned ones become money); for legacy coupon
 * orders, every piece.
 */
export function gatingPieces(request: Pick<ReleaseCandidate, 'exchangeMode' | 'items'>): ReleasePiece[] {
  return request.exchangeMode === 'order' ? request.items.filter((item) => item.type === 'exchange') : request.items;
}

export function exchangePiecesPassed(request: Pick<ReleaseCandidate, 'exchangeMode' | 'items'>): boolean {
  const pieces = gatingPieces(request);
  return pieces.length > 0 && pieces.every((item) => item.conditionStatus === 'good');
}

/** Some gating piece was inspected and is not good (worn, damaged, …). */
export function exchangePieceFailed(request: Pick<ReleaseCandidate, 'exchangeMode' | 'items'>): boolean {
  return gatingPieces(request).some((item) => Boolean(item.conditionStatus) && item.conditionStatus !== 'good');
}

/**
 * Whether the hold can be lifted now. `force` is staff choosing to ship anyway
 * (inspection pending or failed); payment is still required.
 */
export function decideExchangeRelease(
  request: ReleaseCandidate,
  options: { force?: boolean } = {},
): { release: true } | { release: false; reason: ReleaseBlock } {
  if (!request.exchangeOrderId || !request.exchangeOrderHoldActive) return { release: false, reason: 'no_active_hold' };
  if (request.exchangeMode === 'order' && !PAID.has(request.exchangePaymentStatus || '')) {
    return { release: false, reason: 'payment_pending' };
  }
  if (options.force) return { release: true };
  if (!exchangeReturnArrived(request)) return { release: false, reason: 'shipment_not_received' };
  const pieces = gatingPieces(request);
  if (pieces.length === 0 || pieces.some((item) => !item.conditionStatus)) {
    return { release: false, reason: 'items_not_inspected' };
  }
  if (pieces.some((item) => item.conditionStatus !== 'good')) return { release: false, reason: 'items_failed' };
  return { release: true };
}

export interface ExchangeStatusIds {
  /** "تحت المراجعة حجز قطع". */
  hold: string;
  /** "طلب جديد". */
  release: string;
  /** Live statuses a hold may be written over: "طلب جديد" (custom or base id) and pending payment. */
  holdFrom: string[];
  /** Live statuses a release may be written over: the hold, the old release target, the base new-order id. */
  releaseFrom: string[];
  /** "بإنتظار الدفع" (custom and base id). */
  paymentPending: string[];
}

export interface LiveOrderStatus {
  customStatusId: string | null;
  statusSlug?: string | null;
}

/**
 * - write: Salla still has the order where this move expects it.
 * - already: it is already at the target.
 * - progressed: packing or shipping already started; never pull it back.
 * - cancelled: the order is gone.
 * - conflict: someone moved it somewhere else by hand; leave it alone.
 */
export type StatusMove = 'write' | 'already' | 'progressed' | 'cancelled' | 'conflict';

const PROGRESSED_SLUGS = new Set(['in_progress', 'completed', 'delivering', 'delivered', 'shipped', 'restoring', 'restored']);
const CANCELLED_SLUGS = new Set(['canceled', 'cancelled', 'deleted']);

export function exchangeStatusMove(
  target: 'hold' | 'release',
  live: LiveOrderStatus,
  ids: ExchangeStatusIds,
  options: { allowReleaseFromPaymentPending?: boolean } = {},
): StatusMove {
  const current = live.customStatusId ? String(live.customStatusId).trim() : null;
  const slug = String(live.statusSlug || '').toLowerCase();
  const goal = target === 'hold' ? ids.hold : ids.release;
  if (current && current === goal) return 'already';

  const fromPaymentPending = target === 'hold' || options.allowReleaseFromPaymentPending === true;
  const from = target === 'hold' ? ids.holdFrom : [...ids.releaseFrom, ...(fromPaymentPending ? ids.paymentPending : [])];
  if (current && from.includes(current)) return 'write';
  // No id in the payload at all: only "pending payment" is unambiguous by slug.
  if (!current && slug === 'payment_pending' && fromPaymentPending) return 'write';
  if (CANCELLED_SLUGS.has(slug)) return 'cancelled';
  if (PROGRESSED_SLUGS.has(slug)) return 'progressed';
  return 'conflict';
}
