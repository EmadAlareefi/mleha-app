import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSallaDateTime,
  storeDayEnd,
  storeDayStart,
  storeMonthKey,
  toStoreWallTimeIsoString,
} from '../salla-time';

test('reads Salla date objects as wall-clock time in their time zone', () => {
  const parsed = parseSallaDateTime({ date: '2026-10-25 13:31:02.000000', timezone_type: 3, timezone: 'Asia/Riyadh' });
  assert.equal(parsed?.toISOString(), '2026-10-25T10:31:02.000Z');
});

test('defaults offset-less strings to the store time zone', () => {
  assert.equal(parseSallaDateTime('2026-10-25 00:15:00')?.toISOString(), '2026-10-24T21:15:00.000Z');
  assert.equal(parseSallaDateTime('2026-10-25')?.toISOString(), '2026-10-24T21:00:00.000Z');
});

test('keeps explicit offsets as-is', () => {
  assert.equal(parseSallaDateTime('2026-10-25T13:31:02Z')?.toISOString(), '2026-10-25T13:31:02.000Z');
  assert.equal(parseSallaDateTime('2026-10-25T13:31:02+03:00')?.toISOString(), '2026-10-25T10:31:02.000Z');
});

test('rejects empty and invalid values', () => {
  assert.equal(parseSallaDateTime(null), null);
  assert.equal(parseSallaDateTime('not a date'), null);
  assert.equal(parseSallaDateTime({ date: null, timezone: 'Asia/Riyadh' }), null);
});

test('store day boundaries are Riyadh midnight', () => {
  assert.equal(storeDayStart('2026-10-25')?.toISOString(), '2026-10-24T21:00:00.000Z');
  assert.equal(storeDayEnd('2026-10-25')?.toISOString(), '2026-10-25T20:59:59.999Z');
  assert.equal(storeDayStart(''), undefined);
  assert.equal(storeDayEnd('2026-13-01'), undefined);
});

test('formats instants as store wall-clock time', () => {
  const instant = new Date('2026-10-24T22:30:00.250Z');
  assert.equal(toStoreWallTimeIsoString(instant), '2026-10-25T01:30:00.250Z');
  assert.equal(storeMonthKey(new Date('2026-10-31T21:30:00Z')), '2026-11');
});
