import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTIFY_ME_WIDGET_SOURCE } from '../../embed/notify-me-widget';
import { addDays, arabicDays, daysBetween, isIsoDate, riyadhToday } from '../restock-eta';

test('arabicDays uses correct number agreement', () => {
  assert.equal(arabicDays(1), 'يوم واحد');
  assert.equal(arabicDays(2), 'يومين');
  assert.equal(arabicDays(3), '3 أيام');
  assert.equal(arabicDays(10), '10 أيام');
  assert.equal(arabicDays(11), '11 يوماً');
  assert.equal(arabicDays(25), '25 يوماً');
});

test('widget dayPhrase matches arabicDays', () => {
  const match = NOTIFY_ME_WIDGET_SOURCE.match(/function dayPhrase\(days\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'dayPhrase not found in widget source');
  const dayPhrase = new Function(`${match[0]}; return dayPhrase;`)() as (days: number) => string;
  for (const days of [1, 2, 3, 7, 10, 11, 25, 90, 365]) {
    assert.equal(dayPhrase(days), arabicDays(days), `mismatch at ${days}`);
  }
});

test('calendar helpers', () => {
  assert.equal(daysBetween('2026-11-09', '2026-12-04'), 25);
  assert.equal(daysBetween('2026-11-09', '2026-11-08'), -1);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.ok(isIsoDate('2026-02-28'));
  assert.ok(!isIsoDate('2026-02-30'));
  assert.ok(!isIsoDate('2026-2-3'));
});

test('riyadhToday rolls over at Riyadh midnight, not UTC', () => {
  // 21:30 UTC is already 00:30 the next day in Riyadh (UTC+3).
  assert.equal(riyadhToday(new Date('2026-11-09T21:30:00Z')), '2026-11-10');
  assert.equal(riyadhToday(new Date('2026-11-09T20:30:00Z')), '2026-11-09');
});
