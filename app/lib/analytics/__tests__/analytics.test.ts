import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketOf, formatDuration, median, percentile, summarize } from '@/app/lib/analytics/stats';
import { resolvePeriod } from '@/app/lib/analytics/period';

test('percentile and median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.9), 46);
  assert.equal(median([]), null);
});

test('summarize keeps breaks out of the averages', () => {
  const result = summarize([60, 120, 180, 4000, null, -5], 1800);
  assert.equal(result.count, 4);
  assert.equal(result.breaks, 1);
  assert.equal(result.avg, 120);
  assert.equal(result.median, 120);
  assert.equal(result.totalWorkingSec, 360);
});

test('bucketOf', () => {
  assert.equal(bucketOf(30, 1800), 'lt1');
  assert.equal(bucketOf(60, 1800), '1to2');
  assert.equal(bucketOf(299, 1800), '3to5');
  assert.equal(bucketOf(1800, 1800), '10to30');
  assert.equal(bucketOf(1801, 1800), 'break');
  assert.equal(bucketOf(700, 600), 'break');
});

test('formatDuration', () => {
  assert.equal(formatDuration(45), '45 ث');
  assert.equal(formatDuration(155), '2:35 د');
  assert.equal(formatDuration(7200), '2.0 س');
  assert.equal(formatDuration(null), '—');
});

test('resolvePeriod uses Riyadh days', () => {
  // 2026-11-10 17:00 UTC = 20:00 Riyadh → today starts 2026-11-09 21:00 UTC.
  const now = Date.UTC(2026, 10, 10, 17, 0, 0);
  const today = resolvePeriod({}, now);
  assert.equal(today.from.toISOString(), '2026-11-09T21:00:00.000Z');
  assert.equal(today.to.getTime(), now);
  const yesterday = resolvePeriod({ preset: 'yesterday' }, now);
  assert.equal(yesterday.from.toISOString(), '2026-11-08T21:00:00.000Z');
  assert.equal(yesterday.to.toISOString(), '2026-11-09T21:00:00.000Z');
  // 22:30 UTC is already the next Riyadh day.
  const late = resolvePeriod({}, Date.UTC(2026, 10, 10, 22, 30));
  assert.equal(late.from.toISOString(), '2026-11-10T21:00:00.000Z');
  const custom = resolvePeriod({ preset: 'custom', from: '2026-11-01', to: '2026-11-03' }, now);
  assert.equal(custom.from.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(custom.to.toISOString(), '2026-11-03T21:00:00.000Z');
  // Ranges are capped at 31 days.
  const long = resolvePeriod({ preset: 'custom', from: '2026-01-01', to: '2026-11-01' }, now);
  assert.equal((long.to.getTime() - long.from.getTime()) / 86_400_000, 31);
});
