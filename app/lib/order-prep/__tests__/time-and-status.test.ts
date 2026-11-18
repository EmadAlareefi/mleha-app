import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatAgeAr,
  orderAgeMs,
  placedAtCutoff,
  riyadhStartOfDayUtc,
  toSqlTimestamp,
} from '@/app/lib/order-prep/riyadh-time';
import { deriveStatusCustomId, extractDates, isOutOfOrderPayload, remoteUpdatedKey, sallaDate } from '@/app/lib/salla-orders';

// 2026-11-09 18:51:12 UTC = 21:51:12 in Riyadh.
const NOW = Date.UTC(2026, 10, 9, 18, 51, 12);

test('placedAt is a real UTC instant: age and cutoffs line up', () => {
  // An order placed 21:51:12 Riyadh time (18:51:12 UTC), 0 minutes ago.
  assert.equal(orderAgeMs(new Date('2026-11-09T18:51:12Z'), NOW), 0);
  assert.equal(orderAgeMs('2026-11-09T16:51:12.000Z', NOW), 2 * 3_600_000);
  assert.equal(orderAgeMs(null, NOW), null);
  assert.equal(toSqlTimestamp(placedAtCutoff(48, NOW)), '2026-11-07 18:51:12');
});

test('the Riyadh day starts at 21:00 UTC the evening before', () => {
  assert.equal(riyadhStartOfDayUtc(NOW).toISOString(), '2026-11-08T21:00:00.000Z');
  // 22:30 UTC is already the next Riyadh day.
  assert.equal(riyadhStartOfDayUtc(Date.UTC(2026, 10, 9, 22, 30)).toISOString(), '2026-11-09T21:00:00.000Z');
});

test('age labels', () => {
  assert.equal(formatAgeAr(null), '—');
  assert.equal(formatAgeAr(30_000), 'الآن');
  assert.equal(formatAgeAr(5 * 60_000), 'منذ 5 د');
  assert.equal(formatAgeAr(3 * 3_600_000), 'منذ 3 س');
  assert.equal(formatAgeAr(26 * 3_600_000), 'منذ يوم');
  assert.equal(formatAgeAr(50 * 3_600_000), 'منذ يومين');
  assert.equal(formatAgeAr(5 * 86_400_000), 'منذ 5 أيام');
});

test('custom status id tells "طلب جديد" apart from its review sub-statuses', () => {
  assert.equal(
    deriveStatusCustomId({ status: { id: 566146469, slug: 'under_review', customized: { id: 449146439, name: 'طلب جديد' } } }),
    '449146439',
  );
  assert.equal(deriveStatusCustomId({ status: { id: 566146469, customized: { id: 2046404155, name: 'X4' } } }), '2046404155');
  assert.equal(deriveStatusCustomId({ status: { id: 1939592358, slug: 'in_progress' } }), '1939592358');
  assert.equal(deriveStatusCustomId({ status: 'under_review' }), null);
  assert.equal(deriveStatusCustomId({}), null);
});

test('an older webhook payload is recognised and skipped', () => {
  const stamp = (date: string, timezone = 'Asia/Riyadh') => ({ date, timezone, timezone_type: 3 });
  const stored = stamp('2026-11-09 21:51:13.000000');
  assert.equal(isOutOfOrderPayload({ updated_at: stamp('2026-11-09 21:50:00.000000') }, stored), true);
  assert.equal(isOutOfOrderPayload({ updated_at: stamp('2026-11-09 21:51:13.000000') }, stored), false);
  assert.equal(isOutOfOrderPayload({ updated_at: stamp('2026-11-09 21:52:00.000000') }, stored), false);
  // Different timezone or missing stamps: never skip.
  assert.equal(isOutOfOrderPayload({ updated_at: stamp('2026-11-09 10:00:00.000000', 'UTC') }, stored), false);
  assert.equal(isOutOfOrderPayload({}, stored), false);
  assert.equal(isOutOfOrderPayload({ updated_at: stamp('2026-11-09 21:50:00.000000') }, null), false);
  assert.deepEqual(remoteUpdatedKey({ date: { updated: stamp('2026-01-01 00:00:00.000000') } }), {
    timezone: 'Asia/Riyadh',
    date: '2026-01-01 00:00:00.000000',
  });
});

test('Salla dates (Riyadh wall clock) are stored as real UTC instants', () => {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  assert.equal(iso(sallaDate('2026-11-09 21:51:12.000000')), '2026-11-09T18:51:12.000Z');
  assert.equal(iso(sallaDate({ date: '2026-11-10 01:30:00.000000', timezone: 'Asia/Riyadh' })), '2026-11-09T22:30:00.000Z');
  assert.equal(iso(sallaDate({ date: '2026-11-09 10:00:00', timezone: 'UTC' })), '2026-11-09T10:00:00.000Z');
  assert.equal(iso(sallaDate('2026-01-05T10:00:00Z')), '2026-01-05T10:00:00.000Z');
  assert.equal(iso(sallaDate('2026-01-05T10:00:00+03:00')), '2026-01-05T07:00:00.000Z');
  assert.equal(iso(sallaDate('2026-11-09')), '2026-11-08T21:00:00.000Z');
  assert.equal(sallaDate(''), null);
  assert.equal(sallaDate('not a date'), null);

  const dates = extractDates({
    date: { date: '2026-11-09 21:51:12.000000', timezone: 'Asia/Riyadh' },
    updated_at: { date: '2026-11-09 22:00:00.000000', timezone: 'Asia/Riyadh' },
  });
  assert.equal(iso(dates.created), '2026-11-09T18:51:12.000Z');
  assert.equal(iso(dates.updated), '2026-11-09T19:00:00.000Z');
  assert.equal(iso(extractDates({ date: { created: '2026-08-01 10:00:00', updated: '2026-08-05 12:00:00' } }).created), '2026-08-01T07:00:00.000Z');
});
