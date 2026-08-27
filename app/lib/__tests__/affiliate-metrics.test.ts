import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCommissionableNetAmount,
  getAffiliateCommissionRate,
  isNationalDayOffersCategory,
} from '../affiliate-metrics';

test('keeps the historical rate through July 24 in Riyadh', () => {
  assert.equal(getAffiliateCommissionRate(new Date('2026-07-24T20:59:59.999Z'), 10), 10);
});

test('uses 5% from July 25 in Riyadh regardless of the stored rate', () => {
  assert.equal(getAffiliateCommissionRate(new Date('2026-07-24T21:00:00.000Z'), 10), 5);
  assert.equal(getAffiliateCommissionRate(new Date('2026-08-01T00:00:00.000Z'), 12), 5);
});

test('removes National Day items from the commission base only', () => {
  assert.equal(calculateCommissionableNetAmount(230, 30, 80), 102);
  assert.equal(calculateCommissionableNetAmount(230, 30, 250), 0);
});

test('matches the National Day offers category for every order date', () => {
  assert.equal(isNationalDayOffersCategory('  عروض  اليوم الوطني '), true);
  assert.equal(isNationalDayOffersCategory('عروض أخرى'), false);
});
