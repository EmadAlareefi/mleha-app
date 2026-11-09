/**
 * Expected restock dates ("موعد التوفر المتوقع") for Salla products.
 *
 * Dates are stored as calendar days (no time) and compared against the current
 * day in Riyadh, so "25 days" means the same thing to staff and to customers
 * no matter where the server runs.
 */

export const RESTOCK_ETA_SERVICE_KEY = 'salla-restock-eta' as const;

/** Upper bound for an ETA, in days. Anything longer is almost certainly a typo. */
export const RESTOCK_ETA_MAX_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in Riyadh, as YYYY-MM-DD. */
export function riyadhToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
  );
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** A Prisma @db.Date value read back as YYYY-MM-DD. */
export function dateColumnToIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** YYYY-MM-DD as the Date Prisma expects for a @db.Date column. */
export function isoToDateColumn(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/**
 * Arabic count of days with correct number agreement:
 * يوم واحد، يومين، 3–10 أيام، 11+ يوماً.
 * Kept in sync with `dayPhrase` in the storefront widget.
 */
export function arabicDays(days: number): string {
  if (days <= 1) return 'يوم واحد';
  if (days === 2) return 'يومين';
  if (days <= 10) return `${days} أيام`;
  return `${days} يوماً`;
}
