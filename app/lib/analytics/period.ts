import { RIYADH_OFFSET_MS } from '@/app/lib/order-prep/riyadh-time';

/** Report periods in Riyadh days: today, yesterday, last 7 days, or a date range. */

export type Period = { from: Date; to: Date; label: string; key: string };

const DAY_MS = 86_400_000;
const MAX_DAYS = 31;

/** UTC instant of Riyadh midnight for the Riyadh calendar day containing `ms`. */
function riyadhMidnight(ms: number): number {
  const riyadh = ms + RIYADH_OFFSET_MS;
  return riyadh - (((riyadh % DAY_MS) + DAY_MS) % DAY_MS) - RIYADH_OFFSET_MS;
}

/** "2026-11-10" (a Riyadh date) → UTC instant of its midnight. */
function parseDay(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) - RIYADH_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}

export function resolvePeriod(
  params: { preset?: string | null; from?: string | null; to?: string | null },
  nowMs: number = Date.now(),
): Period {
  const today = riyadhMidnight(nowMs);
  switch (params.preset) {
    case 'yesterday':
      return { from: new Date(today - DAY_MS), to: new Date(today), label: 'أمس', key: 'yesterday' };
    case '7d':
      return { from: new Date(today - 6 * DAY_MS), to: new Date(nowMs), label: 'آخر 7 أيام', key: '7d' };
    case 'custom': {
      const from = parseDay(params.from ?? null);
      const toDay = parseDay(params.to ?? null) ?? from;
      if (from !== null && toDay !== null) {
        const start = Math.min(from, toDay);
        let end = Math.max(from, toDay) + DAY_MS;
        if (end - start > MAX_DAYS * DAY_MS) end = start + MAX_DAYS * DAY_MS;
        return {
          from: new Date(start),
          to: new Date(Math.min(end, nowMs)),
          label: `${params.from} → ${params.to ?? params.from}`,
          key: `custom:${start}:${end}`,
        };
      }
      break;
    }
  }
  return { from: new Date(today), to: new Date(nowMs), label: 'اليوم', key: 'today' };
}
