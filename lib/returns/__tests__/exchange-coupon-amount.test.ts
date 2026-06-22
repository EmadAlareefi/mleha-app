import assert from 'node:assert/strict';
import test from 'node:test';
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
    itemsTotal: 410,
    originalShipping: 30,
    processingFee: 40,
  });
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
