import { classifyStuckInputs, loadStuckInputs, type StuckInputs } from './load';
import type { StuckOrdersResult } from './types';

/**
 * Short-lived cache for the stuck-orders list.
 *
 * The list scans every open order of the last 60 days (several queries over
 * thousands of rows), and every open dashboard asks for it once a minute. The
 * raw rows are cached for TTL_MS and shared across thresholds; classification
 * still runs on every request against the current time, so ages stay exact.
 *
 * Per server instance (Fluid Compute reuses instances, so concurrent screens
 * mostly share one copy). Actions on this instance clear it straight away;
 * other instances catch up within TTL_MS.
 */
export const STUCK_CACHE_TTL_MS = 45_000;

type Entry = { startedAt: number; promise: Promise<StuckInputs> };

let entry: Entry | null = null;
let generation = 0;

type Loader = (nowMs: number) => Promise<StuckInputs>;

async function inputs({
  fresh = false,
  nowMs = Date.now(),
  load = loadStuckInputs as Loader,
}: { fresh?: boolean; nowMs?: number; load?: Loader }): Promise<StuckInputs> {
  if (!fresh && entry && nowMs - entry.startedAt < STUCK_CACHE_TTL_MS) return entry.promise;

  const mine = ++generation;
  const promise = load(nowMs);
  // Store the promise right away so requests arriving mid-load share it.
  entry = { startedAt: nowMs, promise };
  try {
    return await promise;
  } catch (error) {
    // Don't cache a failure; the next request tries again.
    if (generation === mine) entry = null;
    throw error;
  }
}

/** The stuck list for a threshold, from the cache when it is younger than STUCK_CACHE_TTL_MS. */
export async function getStuckOrdersCached(
  thresholdHours: number,
  options: { fresh?: boolean; nowMs?: number; load?: Loader } = {},
): Promise<StuckOrdersResult & { cacheAgeMs: number }> {
  const nowMs = options.nowMs ?? Date.now();
  const data = await inputs({ ...options, nowMs });
  return { ...classifyStuckInputs(data, thresholdHours, nowMs), cacheAgeMs: Math.max(0, nowMs - data.loadedAt) };
}

/** Drop the cached rows (after anything that changes an order's warehouse state). */
export function invalidateStuckOrders() {
  generation += 1;
  entry = null;
}
