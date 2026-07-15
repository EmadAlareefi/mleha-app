import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateReturnWindowByProductId,
  getReturnWindowPolicy,
  getWindowExpiredProductIds,
} from '../policy';

const EVENING_DRESS = 'فساتين سهرة';
const OTHER_CATEGORY = 'نواعم';
const DAY_MS = 1000 * 60 * 60 * 24;

const daysAgo = (days: number, from = new Date('2026-06-21T12:00:00.000Z')): Date =>
  new Date(from.getTime() - days * DAY_MS);

test('evening dresses use the 24h window, other categories use 3 days', () => {
  assert.equal(getReturnWindowPolicy([EVENING_DRESS]).windowHours, 24);
  assert.equal(getReturnWindowPolicy([OTHER_CATEGORY]).windowHours, 72);
});

test('exchanges extend the other-category window to 7 days but keep evening dresses at 24h', () => {
  assert.equal(getReturnWindowPolicy([OTHER_CATEGORY], 'exchange').windowHours, 168);
  assert.equal(getReturnWindowPolicy([OTHER_CATEGORY], 'return').windowHours, 72);
  assert.equal(getReturnWindowPolicy([EVENING_DRESS], 'exchange').windowHours, 24);
});

test('other-category item at 4 days is expired for return but still exchangeable', () => {
  const now = new Date('2026-06-21T12:00:00.000Z');
  const categoriesByProductId = { 'other-1': [OTHER_CATEGORY] };
  const returnExpired = getWindowExpiredProductIds(categoriesByProductId, daysAgo(4, now), now, 'return');
  const exchangeExpired = getWindowExpiredProductIds(categoriesByProductId, daysAgo(4, now), now, 'exchange');

  assert.ok(returnExpired.has('other-1'), 'past the 3-day return window');
  assert.ok(!exchangeExpired.has('other-1'), 'still within the 7-day exchange window');
});

test('other-category item past 7 days is expired for exchange too', () => {
  const now = new Date('2026-06-21T12:00:00.000Z');
  const categoriesByProductId = { 'other-1': [OTHER_CATEGORY] };
  const exchangeExpired = getWindowExpiredProductIds(categoriesByProductId, daysAgo(8, now), now, 'exchange');

  assert.ok(exchangeExpired.has('other-1'), 'past the 7-day exchange window');
});

test('mixed order at ~2.5 days expires only the evening dress item', () => {
  const now = new Date('2026-06-21T12:00:00.000Z');
  const categoriesByProductId = {
    'evening-1': [EVENING_DRESS],
    'other-1': [OTHER_CATEGORY],
  };
  const expired = getWindowExpiredProductIds(categoriesByProductId, daysAgo(2.5, now), now);

  assert.ok(expired.has('evening-1'), 'evening dress should be expired past 24h');
  assert.ok(!expired.has('other-1'), 'non evening-dress should still be returnable within 3 days');
  assert.equal(expired.size, 1);
});

test('all-evening-dress order at ~2.5 days marks every item expired', () => {
  const now = new Date('2026-06-21T12:00:00.000Z');
  const categoriesByProductId = {
    'evening-1': [EVENING_DRESS],
    'evening-2': [EVENING_DRESS],
  };
  const expired = getWindowExpiredProductIds(categoriesByProductId, daysAgo(2.5, now), now);

  assert.equal(expired.size, 2);
});

test('all-non-evening-dress order at ~2.5 days marks nothing expired', () => {
  const now = new Date('2026-06-21T12:00:00.000Z');
  const categoriesByProductId = {
    'other-1': [OTHER_CATEGORY],
    'other-2': [OTHER_CATEGORY],
  };
  const expired = getWindowExpiredProductIds(categoriesByProductId, daysAgo(2.5, now), now);

  assert.equal(expired.size, 0);
});

test('evaluateReturnWindowByProductId judges each product by its own category', () => {
  const now = new Date('2026-06-21T12:00:00.000Z');
  const evaluations = evaluateReturnWindowByProductId({
    categoriesByProductId: {
      'evening-1': [EVENING_DRESS],
      'other-1': [OTHER_CATEGORY],
    },
    deliveryDate: daysAgo(2.5, now),
    now,
  });

  assert.equal(evaluations['evening-1'].eligible, false);
  assert.equal(evaluations['evening-1'].policy.windowHours, 24);
  assert.equal(evaluations['other-1'].eligible, true);
  assert.equal(evaluations['other-1'].policy.windowHours, 72);
});
