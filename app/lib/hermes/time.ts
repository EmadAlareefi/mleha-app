/**
 * Calendar-date ↔ instant conversion for report ranges. Reports take local
 * dates (`YYYY-MM-DD`, inclusive) in an IANA time zone; queries need UTC
 * instants. Implemented with Intl so no time-zone library is required.
 */

import { wallTimeToInstant } from '@/lib/zoned-time';
import { parseSallaDateTime } from '../salla-time';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** The UTC instant at which local midnight of `date` occurs in `timeZone`. */
export function startOfLocalDay(date: string, timeZone: string): Date {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new Error(`Invalid date ${date}`);
  return wallTimeToInstant(Date.UTC(parsed.year, parsed.month - 1, parsed.day), timeZone);
}

export function addDays(date: string, days: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new Error(`Invalid date ${date}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function addYears(date: string, years: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new Error(`Invalid date ${date}`);
  // Clamp Feb 29 to Feb 28 in non-leap years.
  const target = new Date(Date.UTC(parsed.year + years, parsed.month - 1, 1));
  const lastDay = new Date(Date.UTC(parsed.year + years, parsed.month, 0)).getUTCDate();
  target.setUTCDate(Math.min(parsed.day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Inclusive number of calendar days from `from` to `to`. */
export function daysInclusive(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) throw new Error('Invalid date');
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY) + 1;
}

/** Local calendar date (`YYYY-MM-DD`) of `instant` in `timeZone`. */
export function localDateKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateKey(now, timeZone);
}

export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = from; current <= to; current = addDays(current, 1)) dates.push(current);
  return dates;
}

export function hoursBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  return hours >= 0 ? hours : null;
}

/** Parses carrier timestamps, which arrive as ISO strings or Salla `{date}` objects. */
export function parseLooseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object') return parseSallaDateTime(value);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} /.test(value) ? value.replace(' ', 'T') : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
