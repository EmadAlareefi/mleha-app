import assert from 'node:assert/strict';
import test from 'node:test';
import { planExchangeSettlement } from '../exchange-settlement';

test('replacements costing more than the credit leave a difference to pay', () => {
  assert.deepEqual(planExchangeSettlement(170, 245), {
    cartTotal: 245, credit: 170, creditApplied: 170, amountDue: 75, leftover: 0, needsPayment: true,
  });
});

test('cheaper replacements leave credit for a coupon', () => {
  const plan = planExchangeSettlement(200, 138);
  assert.equal(plan.creditApplied, 138);
  assert.equal(plan.amountDue, 0);
  assert.equal(plan.leftover, 62);
  assert.equal(plan.needsPayment, false);
});

test('an exact match is fully covered, and halala noise is ignored', () => {
  assert.equal(planExchangeSettlement(99, 99).needsPayment, false);
  const plan = planExchangeSettlement(99.004, 99.001);
  assert.equal(plan.amountDue, 0);
  assert.equal(plan.leftover, 0);
});

test('bad inputs never produce negative money', () => {
  const plan = planExchangeSettlement(-5, Number.NaN);
  assert.equal(plan.amountDue, 0);
  assert.equal(plan.leftover, 0);
  assert.equal(plan.creditApplied, 0);
});
