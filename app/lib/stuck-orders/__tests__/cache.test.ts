import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { STUCK_CACHE_TTL_MS, getStuckOrdersCached, invalidateStuckOrders } from '@/app/lib/stuck-orders/cache';
import type { StuckInputs } from '@/app/lib/stuck-orders/load';

const NOW = Date.parse('2026-11-23T12:00:00Z');

function counter() {
  let calls = 0;
  const load = async (nowMs: number): Promise<StuckInputs> => {
    calls += 1;
    return { loadedAt: nowMs, snapshots: [], returns: [] };
  };
  return { load, calls: () => calls };
}

beforeEach(() => invalidateStuckOrders());

test('serves repeat requests within the TTL from one load, across thresholds', async () => {
  const { load, calls } = counter();
  await getStuckOrdersCached(24, { nowMs: NOW, load });
  const later = await getStuckOrdersCached(72, { nowMs: NOW + STUCK_CACHE_TTL_MS - 1, load });
  assert.equal(calls(), 1);
  assert.equal(later.thresholdHours, 72);
  assert.equal(later.cacheAgeMs, STUCK_CACHE_TTL_MS - 1);
  assert.equal(later.generatedAt, new Date(NOW).toISOString());
});

test('reloads once the TTL has passed', async () => {
  const { load, calls } = counter();
  await getStuckOrdersCached(24, { nowMs: NOW, load });
  await getStuckOrdersCached(24, { nowMs: NOW + STUCK_CACHE_TTL_MS, load });
  assert.equal(calls(), 2);
});

test('fresh skips the cache, and invalidate drops it', async () => {
  const { load, calls } = counter();
  await getStuckOrdersCached(24, { nowMs: NOW, load });
  await getStuckOrdersCached(24, { nowMs: NOW + 1, load, fresh: true });
  assert.equal(calls(), 2);
  invalidateStuckOrders();
  await getStuckOrdersCached(24, { nowMs: NOW + 2, load });
  assert.equal(calls(), 3);
});

test('concurrent requests share one in-flight load', async () => {
  const { load, calls } = counter();
  await Promise.all([1, 2, 3].map(() => getStuckOrdersCached(24, { nowMs: NOW, load })));
  assert.equal(calls(), 1);
});

test('a failed load is not cached', async () => {
  let calls = 0;
  const failing = async (): Promise<StuckInputs> => {
    calls += 1;
    throw new Error('db down');
  };
  await assert.rejects(getStuckOrdersCached(24, { nowMs: NOW, load: failing }), /db down/);
  const { load } = counter();
  const result = await getStuckOrdersCached(24, { nowMs: NOW + 1, load });
  assert.equal(calls, 1);
  assert.equal(result.items.length, 0);
});
