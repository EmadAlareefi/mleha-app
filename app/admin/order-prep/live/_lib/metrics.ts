/**
 * Pure calculations behind the live warehouse dashboard. No React, no CSS,
 * so they run under `node --test` (see __tests__/metrics.test.ts).
 */
import type { BoardData, BoardPacker } from '@/app/lib/order-prep/board';
import type { ShippingBoardData } from '@/app/lib/shipping/board';

/** "5 د", "3 س", "يومان" — how long ago an ISO time was. */
export function since(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'يوم' : days === 2 ? 'يومان' : `${days} أيام`;
}

const dayWord = (days: number) => (days === 1 ? 'يوم' : days === 2 ? 'يومان' : `${days} أيام`);

/**
 * How long a backlog takes at the last hour's pace. Null when there is no
 * pace to project from (nothing done in the last hour).
 */
export function clearTime(backlog: number, perHour: number): { label: string; hours: number } | null {
  if (backlog <= 0) return { label: 'لا شيء متبقٍ', hours: 0 };
  if (perHour <= 0) return null;
  const hours = backlog / perHour;
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    // 59.6 minutes rounds to 60: say "1 س", not "60 دقيقة".
    return { label: minutes >= 60 ? '~1 س' : `~${minutes} دقيقة`, hours };
  }
  if (hours < 24) {
    // Round to the quarter hour first, so 2.95 h is "3 س", never "2 س 60 د".
    const quarters = Math.round(hours * 4);
    const whole = Math.floor(quarters / 4);
    const minutes = (quarters % 4) * 15;
    if (whole >= 24) return { label: `~${dayWord(1)}`, hours };
    return { label: minutes > 0 ? `~${whole} س ${minutes} د` : `~${whole} س`, hours };
  }
  // Round to whole hours first, so 47.8 h is "يومان", never "يوم و24 س".
  const total = Math.round(hours);
  const days = Math.floor(total / 24);
  const rest = total % 24;
  return { label: `~${dayWord(days)}${rest > 0 ? ` و${rest} س` : ''}`, hours };
}

/**
 * Keys of everything that needs a person (not the international / courier
 * waiting lists). The alerts feed uses the same keys for its rows, so the
 * page can tell which rows are new since the last refresh.
 */
export function interventionKeys(board: BoardData | null, shipping: ShippingBoardData | null): string[] {
  return [
    ...(board?.exceptions ?? []).map((item) => `ex:${item.id}`),
    ...(board?.syncIssues ?? []).map((job) => `sync:${job.id}`),
    ...(shipping?.problems ?? []).map((task) => `shipping:${task.id}`),
  ];
}

/** Keys present now that were not in the previous set. Null previous = first load, nothing is new. */
export function newKeys(previous: Set<string> | null, current: string[]): string[] {
  if (!previous) return [];
  return current.filter((key) => !previous.has(key));
}

export const IDLE_MINUTES = 15;

/**
 * Minutes a packer has been idle while orders are waiting, or null when they
 * are not idle (working, holding a next order, the queue is empty, or their
 * last order was finished less than IDLE_MINUTES ago).
 */
export function idleMinutes(packer: BoardPacker, queueWaiting: number, nowMs = Date.now()): number | null {
  if (packer.current || packer.next || queueWaiting <= 0 || !packer.lastCompletedAt) return null;
  const minutes = Math.floor((nowMs - Date.parse(packer.lastCompletedAt)) / 60_000);
  return minutes >= IDLE_MINUTES ? minutes : null;
}

/** "Couldn't refresh — showing data from 3 min ago", or null when every feed is fine. */
export function staleNote(...sources: Array<{ error: string | null; at: number | null }>): string | null {
  const failed = sources.filter((source) => source.error);
  if (failed.length === 0) return null;
  const at = Math.min(...failed.map((source) => source.at ?? Infinity));
  const age = Number.isFinite(at) ? `آخر بيانات قبل ${since(new Date(at).toISOString())}` : 'لم تُحمَّل بعد';
  return `تعذر التحديث (${failed[0].error}) · ${age} · نعيد المحاولة تلقائياً`;
}

/**
 * Today vs yesterday over the same finished hours (0 … currentHour-1). The
 * hour in progress is left out: a half-hour of today against a full hour of
 * yesterday would always look like a drop. Null before the first hour ends.
 */
export function compareSoFar(
  today: number[],
  yesterday: number[],
  currentHour: number,
): { today: number; yesterday: number; deltaPct: number | null } | null {
  if (currentHour <= 0) return null;
  const sum = (values: number[]) => values.slice(0, currentHour).reduce((total, value) => total + value, 0);
  const a = sum(today);
  const b = sum(yesterday);
  return { today: a, yesterday: b, deltaPct: b > 0 ? Math.round(((a - b) / b) * 100) : null };
}
