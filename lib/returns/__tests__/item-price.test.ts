import assert from 'node:assert/strict';
import test from 'node:test';
import { getOrderItemUnitPrice, getReturnLineAmount } from '../item-price';

/**
 * Salla reports `price_without_tax` and `tax.amount` per unit, but
 * `total_discount` and `total` as line totals.
 */
const item = (over: Record<string, any> = {}) => ({
  quantity: 1,
  amounts: {
    price_without_tax: { amount: 630 },
    tax: { amount: { amount: 94.5 } },
    total_discount: { amount: 0 },
    total: { amount: 724.5 },
  },
  ...over,
});

test('undiscounted unit price is price_without_tax + tax', () => {
  assert.equal(getOrderItemUnitPrice(item()), 724.5);
});

test('quantity alone does not change the unit price', () => {
  assert.equal(getOrderItemUnitPrice(item({ quantity: 3 })), 724.5);
});

test('a line discount is spread across the ordered quantity', () => {
  // 100 off a line of 2 is 50 off each unit.
  const discounted = item({
    quantity: 2,
    amounts: {
      price_without_tax: { amount: 630 },
      tax: { amount: { amount: 94.5 } },
      total_discount: { amount: 100 },
      total: { amount: 1349 },
    },
  });

  assert.equal(getOrderItemUnitPrice(discounted), 674.5);
  assert.equal(getReturnLineAmount(discounted, 2), 1349);
});

test('the old formula under-refunded discounted multi-quantity lines', () => {
  // Regression pin. The previous client-side formula subtracted the whole line
  // discount from every unit: (630 + 94.5 - 100) * 3 = 1873.5, where the
  // customer actually paid (630 + 94.5) * 3 - 100 = 2073.5 — a 200 SAR shortfall.
  const discounted = item({
    quantity: 3,
    amounts: {
      price_without_tax: { amount: 630 },
      tax: { amount: { amount: 94.5 } },
      total_discount: { amount: 100 },
      total: { amount: 2073.5 },
    },
  });

  // 2073.51, not 2073.50: a discount that does not divide evenly is rounded at
  // the unit, because `ReturnItem.price` stores a per-unit Decimal(10,2) that
  // downstream consumers multiply back out. One halala on the line is accepted.
  assert.equal(getReturnLineAmount(discounted, 3), 2073.51);
  assert.notEqual(getReturnLineAmount(discounted, 3), 1873.5);
});

test('a single-quantity discount is unchanged by the fix', () => {
  const discounted = item({
    quantity: 1,
    amounts: {
      price_without_tax: { amount: 630 },
      tax: { amount: { amount: 94.5 } },
      total_discount: { amount: 100 },
      total: { amount: 624.5 },
    },
  });

  assert.equal(getOrderItemUnitPrice(discounted), 624.5);
});

test('falls back to the line total spread over the quantity', () => {
  const noBreakdown = {
    quantity: 4,
    amounts: { total: { amount: 400 } },
  };

  assert.equal(getOrderItemUnitPrice(noBreakdown), 100);
  assert.equal(getReturnLineAmount(noBreakdown, 2), 200);
});

test('accepts the string and nested amount shapes Salla sends', () => {
  const stringy = {
    quantity: '2',
    amounts: {
      price_without_tax: { amount: '630' },
      // Some payloads flatten tax.amount to a number rather than { amount }.
      tax: { amount: 94.5 },
      total_discount: { amount: '100' },
    },
  } as never;

  assert.equal(getOrderItemUnitPrice(stringy), 674.5);
});

test('never returns a negative price', () => {
  const overDiscounted = {
    quantity: 1,
    amounts: {
      price_without_tax: { amount: 100 },
      tax: { amount: { amount: 15 } },
      total_discount: { amount: 500 },
    },
  };

  assert.equal(getOrderItemUnitPrice(overDiscounted), 0);
});

test('handles missing, empty and malformed items', () => {
  assert.equal(getOrderItemUnitPrice(null), 0);
  assert.equal(getOrderItemUnitPrice(undefined), 0);
  assert.equal(getOrderItemUnitPrice({}), 0);
  assert.equal(getOrderItemUnitPrice({ quantity: 0, amounts: { total: { amount: 50 } } }), 50);
  assert.equal(getReturnLineAmount(item(), 0), 0);
  assert.equal(getReturnLineAmount(item(), -3), 0);
  assert.equal(getReturnLineAmount(item(), Number.NaN), 0);
});

test('rounds to two decimals', () => {
  const awkward = {
    quantity: 3,
    amounts: {
      price_without_tax: { amount: 10 },
      tax: { amount: { amount: 1.5 } },
      total_discount: { amount: 1 },
    },
  };

  // 11.5 - (1/3) = 11.1666… → 11.17
  assert.equal(getOrderItemUnitPrice(awkward), 11.17);
});
