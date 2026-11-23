import assert from 'node:assert/strict';
import test from 'node:test';
import { spreadBuckets } from '@/app/lib/order-prep/hourly';
import { riyadhStartOfDayUtc } from '@/app/lib/order-prep/riyadh-time';

// 2026-11-23 15:30 Riyadh = 12:30 UTC. The Riyadh day began at 2026-11-22 21:00 UTC.
const NOW = Date.parse('2026-11-23T12:30:00Z');
const todayStart = riyadhStartOfDayUtc(NOW).getTime();
const utc = (iso: string) => new Date(iso);

test('the Riyadh day starts at 21:00 UTC the evening before', () => {
  assert.equal(new Date(todayStart).toISOString(), '2026-11-22T21:00:00.000Z');
});

test('spreadBuckets maps UTC hour buckets to Riyadh hours of today and yesterday', () => {
  const { today, yesterday } = spreadBuckets(
    {
      placed: [
        { hour: utc('2026-11-22T21:00:00Z'), count: 7 }, // today 00:00 Riyadh
        { hour: utc('2026-11-23T12:00:00Z'), count: 3 }, // today 15:00 Riyadh
        { hour: utc('2026-11-22T20:00:00Z'), count: 9 }, // yesterday 23:00 Riyadh
      ],
      packed: [{ hour: utc('2026-11-21T21:00:00Z'), count: 4 }], // yesterday 00:00 Riyadh
      printed: [{ hour: utc('2026-11-21T20:00:00Z'), count: 99 }], // two days ago: dropped
    },
    todayStart,
  );
  assert.equal(today.placed[0], 7);
  assert.equal(today.placed[15], 3);
  assert.equal(yesterday.placed[23], 9);
  assert.equal(yesterday.packed[0], 4);
  assert.equal(today.printed.concat(yesterday.printed).reduce((a, b) => a + b, 0), 0);
  assert.equal(today.placed.length, 24);
});

test('spreadBuckets accepts counts that come back as strings or bigints from SQL', () => {
  const { today } = spreadBuckets(
    { placed: [{ hour: utc('2026-11-22T22:00:00Z'), count: '5' as unknown as number }], packed: [], printed: [] },
    todayStart,
  );
  assert.equal(today.placed[1], 5);
});
