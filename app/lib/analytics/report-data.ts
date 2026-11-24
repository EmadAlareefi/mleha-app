import { prisma } from '@/lib/prisma';
import { getPrepFacts } from '@/app/lib/order-prep/analytics';
import { MERCHANT_ID } from '@/app/lib/order-prep/queue';
import { getPrepSettings } from '@/app/lib/order-prep/settings';
import { getShippingFacts } from '@/app/lib/shipping/analytics';
import { previousPeriod, type Period } from './period';
import { buildReport, type ReportInputs, type WarehouseReport } from './report';

/**
 * Loads what the warehouse report needs for a period: the board facts (shared
 * with the orders drawer, so every drill lists the same rows) plus orders
 * placed per hour and the Salla status-sync failures.
 */
async function loadInputs(period: Period): Promise<ReportInputs> {
  const [prep, shipping, placedHours, sync, settings] = await Promise.all([
    getPrepFacts(period),
    getShippingFacts(period),
    // Demand: cancelled and still-unpaid orders never reach the warehouse.
    prisma.$queryRaw<Array<{ hour: Date; count: number }>>`
      SELECT date_trunc('hour', "placedAt") AS hour, count(*)::int AS count
      FROM "SallaOrder"
      WHERE "merchantId" = ${MERCHANT_ID}
        AND "placedAt" >= ${period.from} AND "placedAt" < ${period.to}
        AND coalesce("statusSlug", '') <> 'canceled'
        AND "isPendingPayment" IS NOT TRUE
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ state: string; count: number }>>`
      SELECT state, count(*)::int AS count
      FROM "OrderPrepSallaSync"
      WHERE "merchantId" = ${MERCHANT_ID}
        AND "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
        AND state IN ('failed', 'conflict')
      GROUP BY 1`,
    getPrepSettings(),
  ]);
  const syncCount = (state: string) => sync.find((row) => row.state === state)?.count ?? 0;
  return { period, prep, shipping, placedHours, sync: { failed: syncCount('failed'), conflict: syncCount('conflict') }, scanMode: settings.scanMode };
}

const cache = new Map<string, { at: number; value: WarehouseReport }>();
const TTL_MS = 60_000;

export async function getWarehouseReport(period: Period): Promise<WarehouseReport> {
  const key = `${period.key}:${period.from.getTime()}:${Math.floor(period.to.getTime() / TTL_MS)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const previous = previousPeriod(period);
  const [current, before] = await Promise.all([loadInputs(period), loadInputs(previous)]);
  const value = buildReport(current, before);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 20) cache.delete(cache.keys().next().value as string);
  return value;
}
