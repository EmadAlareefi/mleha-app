import { STATUS_IDS, SUB_STATUSES } from '@/SALLA_ORDER_STATUSES';

/**
 * Rules for the Salla outbox (salla-sync.ts): which live status allows each
 * write, and how long to wait between attempts. Kept free of I/O for tests.
 */

export type SyncKind = 'packed' | 'exception' | 'requeue';
export type SyncDecision = 'write' | 'already' | 'conflict';

export const NEW_ORDER_STATUS_ID = String(STATUS_IDS.NEW_ORDER);
const IN_PROGRESS_IDS = [String(STATUS_IDS.IN_PROGRESS), String(SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id)];
const REVIEW_IDS = [
  String(STATUS_IDS.UNDER_REVIEW),
  String(STATUS_IDS.UNDER_REVIEW_X4),
  String(STATUS_IDS.UNDER_REVIEW_A),
];

/** Live statuses from which each kind of change may be written. */
const ALLOWED_FROM: Record<SyncKind, string[]> = {
  // Packed orders were "طلب جديد" when claimed.
  packed: [NEW_ORDER_STATUS_ID],
  // A problem can be reported on a new order, or right after a pack was synced.
  exception: [NEW_ORDER_STATUS_ID, ...IN_PROGRESS_IDS],
  // The supervisor sends an escalated order back from a review status.
  requeue: REVIEW_IDS,
};

/**
 * Compare-and-set: write only when Salla still has the order in a status the
 * change expects. Anything else (cancelled, shipped, edited by staff) is a
 * conflict for a person to look at, never an overwrite.
 */
export function decideSyncAction(kind: SyncKind, liveStatusId: string | null, targetStatusId: number): SyncDecision {
  if (!liveStatusId) return 'conflict';
  if (liveStatusId === String(targetStatusId)) return 'already';
  if (kind === 'packed' && IN_PROGRESS_IDS.includes(liveStatusId)) {
    // Domestic vs international was decided at pack time; either in-progress
    // status means Salla already reflects the pack.
    return 'already';
  }
  return ALLOWED_FROM[kind].includes(liveStatusId) ? 'write' : 'conflict';
}

const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
export const MAX_SYNC_ATTEMPTS = 8;

/** Wait before the next attempt, after `attempts` failures so far (1-based). */
export function nextBackoffMs(attempts: number, retryAfterMs?: number | null): number {
  const base = BACKOFF_MS[Math.max(0, attempts - 1)] ?? 60 * 60_000;
  return Math.max(base, retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 0);
}

/** Retry-After header (seconds or HTTP date) in ms. */
export function parseRetryAfter(header: string | null, nowMs: number = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

/** Status columns to echo into SallaOrder after a successful write. */
export function statusEcho(targetStatusId: number): { statusCustomId: string; statusSlug: string; statusName: string } | null {
  switch (targetStatusId) {
    case STATUS_IDS.IN_PROGRESS:
      return { statusCustomId: String(targetStatusId), statusSlug: 'in_progress', statusName: 'جاري التجهيز' };
    case SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id:
      return { statusCustomId: String(targetStatusId), statusSlug: 'in_progress', statusName: SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.name };
    case STATUS_IDS.UNDER_REVIEW_X4:
      return { statusCustomId: String(targetStatusId), statusSlug: 'under_review', statusName: SUB_STATUSES.UNDER_REVIEW_X4.name };
    case STATUS_IDS.UNDER_REVIEW:
      return { statusCustomId: String(targetStatusId), statusSlug: 'under_review', statusName: SUB_STATUSES.UNDER_REVIEW.name };
    case STATUS_IDS.NEW_ORDER:
      return { statusCustomId: String(targetStatusId), statusSlug: 'under_review', statusName: 'طلب جديد' };
    default:
      return null;
  }
}
