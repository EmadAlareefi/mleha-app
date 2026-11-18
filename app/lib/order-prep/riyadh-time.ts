/**
 * Time helpers for order prep.
 *
 * `SallaOrder.placedAt` is a real UTC instant, like every other timestamp the
 * app stores: Salla's Riyadh wall-clock date is converted on the way in (see
 * `sallaDate` in app/lib/salla-orders.ts). Riyadh is UTC+3 all year (no
 * daylight saving); the offset is only needed to find Riyadh day boundaries.
 */

export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long ago an order was placed, in ms; null when the date is unknown. */
export function orderAgeMs(placedAt: Date | string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!placedAt) return null;
  const placedMs = placedAt instanceof Date ? placedAt.getTime() : Date.parse(placedAt);
  if (!Number.isFinite(placedMs)) return null;
  return Math.max(0, nowMs - placedMs);
}

/** "YYYY-MM-DD HH:mm:ss" of the Date's UTC fields, for `::timestamp` SQL params. */
export function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** placedAt cutoff for orders older than `hours`. */
export function placedAtCutoff(hours: number, nowMs: number = Date.now()): Date {
  return new Date(nowMs - hours * 60 * 60 * 1000);
}

/** The real UTC instant at which the current Riyadh day began. */
export function riyadhStartOfDayUtc(nowMs: number = Date.now()): Date {
  const riyadhMs = nowMs + RIYADH_OFFSET_MS;
  const riyadhMidnightMs = riyadhMs - (((riyadhMs % DAY_MS) + DAY_MS) % DAY_MS);
  return new Date(riyadhMidnightMs - RIYADH_OFFSET_MS);
}

/** Short Arabic age label: "منذ 5 د", "منذ 3 س", "منذ 2 يوم". */
export function formatAgeAr(ageMs: number | null): string {
  if (ageMs === null) return '—';
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'منذ يوم' : days === 2 ? 'منذ يومين' : `منذ ${days} أيام`;
}

/** "2026-11-10" (a Riyadh calendar date) → the UTC instant its day starts. */
export function riyadhDayStart(value: string | null | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000+03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "2026-11-10" (a Riyadh calendar date) → the last millisecond of that day, in UTC. */
export function riyadhDayEnd(value: string | null | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T23:59:59.999+03:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
