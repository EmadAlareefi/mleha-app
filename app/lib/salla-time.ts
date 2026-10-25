/**
 * Salla sends timestamps as store-local wall-clock strings, e.g.
 * `{ date: '2026-10-25 13:31:02.000000', timezone: 'Asia/Riyadh' }`. Parsing
 * them with `new Date()` reads them in the server's zone (UTC on Vercel),
 * shifting every order 3 hours late, so convert them explicitly. Report date
 * filters likewise use store-local calendar days to match Salla's reports.
 */

import { instantToWallTime, wallTimeToInstant } from '@/lib/zoned-time';

export const SALLA_STORE_TIME_ZONE = 'Asia/Riyadh';

const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses a Salla timestamp: a string, or a `{ date, timezone }` object.
 * Strings without an explicit offset are read as wall-clock time in the given
 * (or store) time zone; strings with `Z`/`±hh:mm` are taken as-is.
 */
export function parseSallaDateTime(value: unknown, timeZone: string = SALLA_STORE_TIME_ZONE): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const zone = typeof record.timezone === 'string' && isValidTimeZone(record.timezone) ? record.timezone : timeZone;
    return parseSallaDateTime(record.date, zone);
  }
  if (typeof value !== 'string') return null;

  const match = WALL_TIME_PATTERN.exec(value.trim());
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '0'] = match;
  const wallTimeMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, '0').slice(0, 3))
  );
  const check = new Date(wallTimeMs);
  if (check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) return null;
  return wallTimeToInstant(wallTimeMs, timeZone);
}

/** First instant of store-local calendar day `date` (`YYYY-MM-DD`), or undefined if invalid. */
export function storeDayStart(date: string | null | undefined): Date | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return parseSallaDateTime(date) ?? undefined;
}

/** Last instant of store-local calendar day `date` (`YYYY-MM-DD`), or undefined if invalid. */
export function storeDayEnd(date: string | null | undefined): Date | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return parseSallaDateTime(`${date} 23:59:59.999`) ?? undefined;
}

/**
 * Store-local wall-clock time formatted like `toISOString()` (with a literal
 * `Z`). The ERP has always received Salla's wall-clock time in this shape.
 */
export function toStoreWallTimeIsoString(instant: Date): string {
  return instantToWallTime(instant, SALLA_STORE_TIME_ZONE).toISOString();
}

/** `YYYY-MM` of `instant` in the store time zone. */
export function storeMonthKey(instant: Date): string {
  return toStoreWallTimeIsoString(instant).slice(0, 7);
}
