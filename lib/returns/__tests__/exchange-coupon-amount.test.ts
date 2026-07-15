import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReturnFeeQuote } from '../fees';
import { calculateExchangeCouponAmount } from '../exchange-coupon-amount';

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
