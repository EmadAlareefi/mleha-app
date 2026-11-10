/**
 * Time helpers for order prep.
 *
 * `SallaOrder.placedAt` holds Salla's Riyadh wall-clock time ("2026-11-09
 * 21:51:12", timezone Asia/Riyadh) in a timestamp column with no zone, so when
 * Prisma reads it back the Date's UTC fields carry the Riyadh clock. Riyadh is
 * UTC+3 all year (no daylight saving), so "now" in that same convention is
 * simply the real time shifted by three hours. Timestamps the app writes itself
 * (`completedAt`, `assignedAt`, …) are real UTC instants.
 */

export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Now, in the placedAt convention (Riyadh clock stored as if it were UTC). */
export function riyadhNaiveNow(nowMs: number = Date.now()): Date {
  return new Date(nowMs + RIYADH_OFFSET_MS);
}

/** How long ago an order was placed, in ms; null when the date is unknown. */
export function orderAgeMs(placedAt: Date | string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!placedAt) return null;
  const placedMs = placedAt instanceof Date ? placedAt.getTime() : Date.parse(placedAt);
  if (!Number.isFinite(placedMs)) return null;
  return Math.max(0, nowMs + RIYADH_OFFSET_MS - placedMs);
}

/** "YYYY-MM-DD HH:mm:ss" of the Date's UTC fields, for `::timestamp` SQL params. */
export function toSqlTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** placedAt cutoff (same convention) for orders older than `hours`. */
export function placedAtCutoff(hours: number, nowMs: number = Date.now()): Date {
  return new Date(nowMs + RIYADH_OFFSET_MS - hours * 60 * 60 * 1000);
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
