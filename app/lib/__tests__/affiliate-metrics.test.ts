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

test('pauses commissions November 3–7 inclusive in Riyadh', () => {
  assert.equal(getAffiliateCommissionRate(new Date('2026-11-02T20:59:59.999Z'), 10), 5);
  assert.equal(getAffiliateCommissionRate(new Date('2026-11-02T21:00:00.000Z'), 10), 0);
  assert.equal(getAffiliateCommissionRate(new Date('2026-11-05T12:00:00.000Z'), null, 12), 0);
  assert.equal(getAffiliateCommissionRate(new Date('2026-11-07T20:59:59.999Z'), 5), 0);
});

test('automatically resumes 5% on November 8 in Riyadh even for a stored zero rate', () => {
  assert.equal(getAffiliateCommissionRate(new Date('2026-11-07T21:00:00.000Z'), 0), 5);
  assert.equal(getAffiliateCommissionRate(new Date('2026-11-09T00:00:00.000Z'), 0), 5);
});

test('matches the National Day offers category for every order date', () => {
  assert.equal(isNationalDayOffersCategory('  عروض  اليوم الوطني '), true);
  assert.equal(isNationalDayOffersCategory('عروض أخرى'), false);
});
