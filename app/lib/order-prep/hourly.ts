import { prisma } from '@/lib/prisma';
import { MERCHANT_ID } from './queue';
import { riyadhStartOfDayUtc } from './riyadh-time';

/**
 * Today's warehouse throughput hour by hour (Riyadh hours), with yesterday
 * for comparison: orders placed, packed and waybills printed.
 *
 * Riyadh is UTC+3 with no daylight saving, so UTC hour buckets line up with
 * Riyadh hours exactly; we bucket with date_trunc('hour') in SQL and only map
 * the bucket to a Riyadh hour index here.
 */

export type HourSeries = { placed: number[]; packed: number[]; printed: number[] };

export type HourlyThroughput = {
  generatedAt: string;
  /** Riyadh hour (0–23) we are in now; later hours of today are in the future. */
  currentHour: number;
  today: HourSeries;
  yesterday: HourSeries;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Bucket = { hour: Date; count: number };

const emptySeries = (): HourSeries => ({ placed: Array(24).fill(0), packed: Array(24).fill(0), printed: Array(24).fill(0) });

/** Spread hour buckets over yesterday (index 0–23) and today (24–47). Pure. */
export function spreadBuckets(
  buckets: { placed: Bucket[]; packed: Bucket[]; printed: Bucket[] },
  todayStartMs: number,
): { today: HourSeries; yesterday: HourSeries } {
  const today = emptySeries();
  const yesterday = emptySeries();
  const yesterdayStartMs = todayStartMs - DAY_MS;
  for (const key of ['placed', 'packed', 'printed'] as const) {
    for (const bucket of buckets[key]) {
      const index = Math.floor((bucket.hour.getTime() - yesterdayStartMs) / HOUR_MS);
      if (index >= 0 && index < 24) yesterday[key][index] += Number(bucket.count);
      else if (index >= 24 && index < 48) today[key][index - 24] += Number(bucket.count);
    }
  }
  return { today, yesterday };
}

export async function getHourlyThroughput(nowMs = Date.now()): Promise<HourlyThroughput> {
  const todayStart = riyadhStartOfDayUtc(nowMs);
  const from = new Date(todayStart.getTime() - DAY_MS);

  const [placed, packed, printed] = await Promise.all([
    prisma.$queryRaw<Bucket[]>`
      SELECT date_trunc('hour', "placedAt") AS hour, count(*)::int AS count
      FROM "SallaOrder"
      WHERE "merchantId" = ${MERCHANT_ID} AND "placedAt" >= ${from}
      GROUP BY 1`,
    prisma.$queryRaw<Bucket[]>`
      SELECT date_trunc('hour', "completedAt") AS hour, count(*)::int AS count
      FROM "OrderPrepAssignment"
      WHERE "merchantId" = ${MERCHANT_ID} AND "status" = 'completed' AND "completedAt" >= ${from}
      GROUP BY 1`,
    prisma.$queryRaw<Bucket[]>`
      SELECT date_trunc('hour', "printedAt") AS hour, count(*)::int AS count
      FROM "ShippingTask"
      WHERE "merchantId" = ${MERCHANT_ID} AND "printedAt" >= ${from}
      GROUP BY 1`,
  ]);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    currentHour: Math.min(23, Math.floor((nowMs - todayStart.getTime()) / HOUR_MS)),
    ...spreadBuckets({ placed, packed, printed }, todayStart.getTime()),
  };
}
