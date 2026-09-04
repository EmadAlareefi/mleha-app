import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReturnFeeQuote } from '../fees';
import {
  applyCouponAmountOverride,
  calculateExchangeCouponAmount,
  toSallaCouponAmount,
} from '../exchange-coupon-amount';

test('uses the current 40 SAR exchange fee with live order shipping', () => {
  const result = calculateExchangeCouponAmount(
    {
      items: [{ price: 410, quantity: 1 }],
      totalRefundAmount: 365.5,
      returnFee: 44.5,
    },
    {
      shipping_cost: { amount: 26.09 },
    },
  );

  assert.deepEqual(result, {
    fullAmount: 400,
    fullAmountSar: 400,
    itemsTotal: 410,
    originalShipping: 30,
    orderOptionsTotal: 0,
    processingFee: 40,
    processingFeeSar: 40,
    currency: 'SAR',
    exchangeRate: 1,
    exchangeRateSource: 'sar',
  });
});

test('deducts paid packaging from exchange credit', () => {
  const result = calculateExchangeCouponAmount(
    {
      items: [{ price: 720, quantity: 1 }],
    },
    { shipping_cost: { amount: 0 } },
    buildReturnFeeQuote('exchange', 'SAR'),
    [
      {
        quantity: 1,
        amounts: {
          price_without_tax: { amount: 13.04 },
          tax: { amount: { amount: 1.96 } },
          total: { amount: 15 },
        },
      },
    ],
  );

  assert.equal(result.orderOptionsTotal, 15);
  assert.equal(result.fullAmount, 680);
});

test('does not reuse a legacy stored exchange fee calculation', () => {
  const result = calculateExchangeCouponAmount({
    items: [{ price: 410, quantity: 1 }],
    totalRefundAmount: 365.5,
    returnFee: 44.5,
    shippingAmount: 30,
  });

  assert.equal(result.fullAmount, 400);
  assert.equal(result.processingFee, 40);
  assert.equal(result.fullAmountSar, 400);
});

test('reconstructs shipping from newer stored totals when needed', () => {
  const result = calculateExchangeCouponAmount({
    items: [{ price: 410, quantity: 1 }],
    totalRefundAmount: 400,
    returnFee: 40,
  });

  assert.equal(result.originalShipping, 30);
  assert.equal(result.fullAmount, 400);
});

test('calculates customer and SAR coupon amounts for non-SAR exchanges', () => {
  const result = calculateExchangeCouponAmount(
    {
      items: [{ price: 100, quantity: 1 }],
      currency: 'USD',
      feeExchangeRate: 3.75,
      feeExchangeRateSource: 'env',
    },
    null,
    buildReturnFeeQuote('exchange', 'USD', 3.75, 'env'),
  );

  assert.equal(result.processingFee, 10.67);
  assert.equal(result.processingFeeSar, 40);
  assert.equal(result.fullAmount, 89.33);
  assert.equal(result.fullAmountSar, 335);
  assert.equal(result.currency, 'USD');
});

test('an agent-set amount replaces the credit but keeps the fee breakdown', () => {
  // A National Day 1+1 line Salla priced at 0: the calculation collapses to 0
  // and the agent states the real credit instead.
  const calculated = calculateExchangeCouponAmount(
    { items: [{ price: 0, quantity: 1 }], shippingAmount: 16 },
    undefined,
  );
  assert.equal(calculated.fullAmount, 0);

  const overridden = applyCouponAmountOverride(calculated, 72);

  assert.equal(overridden.amountSource, 'override');
  assert.equal(overridden.fullAmount, 72);
  assert.equal(overridden.fullAmountSar, 72);
  assert.equal(overridden.processingFee, calculated.processingFee);
  assert.equal(overridden.originalShipping, 16);
  assert.equal(overridden.itemsTotal, 0);
});

test('converts a foreign-currency override into its SAR equivalent', () => {
  const calculated = calculateExchangeCouponAmount(
    {
      items: [{ price: 0, quantity: 1 }],
      currency: 'AED',
      feeExchangeRate: 1.02,
      feeExchangeRateSource: 'salla',
    },
    undefined,
  );

  const overridden = applyCouponAmountOverride(calculated, 100);

  assert.equal(overridden.fullAmount, 100);
  assert.equal(overridden.fullAmountSar, 102);
});

test('ignores an absent or non-positive override', () => {
  const calculated = calculateExchangeCouponAmount(
    { items: [{ price: 200, quantity: 1 }], shippingAmount: 16 },
    undefined,
  );

  for (const override of [null, undefined, 0, -5, 'abc']) {
    const result = applyCouponAmountOverride(calculated, override);
    assert.equal(result.amountSource, 'calculated');
    assert.equal(result.fullAmount, calculated.fullAmount);
  }
});

test('strips Salla 15% markup from the amount sent to the coupon API', () => {
  assert.equal(toSallaCouponAmount(72), 62.61);
  assert.equal(toSallaCouponAmount(171.99), 149.56);
});
