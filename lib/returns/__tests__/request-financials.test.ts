import assert from 'node:assert/strict';
import test from 'node:test';

import { recalculateReturnRequestFinancials } from '../request-financials';

test('changes a stale exchange fee to the return fee while preserving the gross amount', () => {
  const result = recalculateReturnRequestFinancials({
    type: 'return',
    currency: 'SAR',
    exchangeRate: 1,
    totalRefundAmount: 459,
    returnFee: 40,
    shippingAmount: 30,
    items: [{ price: 469, quantity: 1 }],
  });

  assert.deepEqual(result, {
    returnFee: 60,
    totalRefundAmount: 439,
    feeExchangeRate: 1,
    feeExchangeRateSource: 'sar',
  });
});

test('changes a return fee to the lower exchange fee', () => {
  const result = recalculateReturnRequestFinancials({
    type: 'exchange',
    currency: 'SAR',
    exchangeRate: 1,
    totalRefundAmount: 439,
    returnFee: 60,
    shippingAmount: 30,
    items: [{ price: 469, quantity: 1 }],
  });

  assert.equal(result.returnFee, 40);
  assert.equal(result.totalRefundAmount, 459);
});

test('falls back to item and shipping values for legacy records without stored totals', () => {
  const result = recalculateReturnRequestFinancials({
    type: 'return',
    currency: 'SAR',
    items: [{ price: '100', quantity: 2 }],
    shippingAmount: '30',
  });

  assert.equal(result.returnFee, 60);
  assert.equal(result.totalRefundAmount, 170);
});

import { splitRequestFinancials } from '../request-financials';
import { calculateExchangeCouponAmount } from '../exchange-coupon-amount';

test('pure return split equals items + shipping − return fee', () => {
  const split = splitRequestFinancials({
    pieces: [{ type: 'return', price: 469 }],
    originalShipping: 30,
    returnProcessingFee: 60,
    exchangeProcessingFee: 40,
  });
  assert.equal(split.requestType, 'return');
  assert.equal(split.refundAmount, 439);
  assert.equal(split.couponAmount, 0);
});

test('pure exchange split matches the exchange coupon calculation', () => {
  const split = splitRequestFinancials({
    pieces: [{ type: 'exchange', price: 250 }, { type: 'exchange', price: 150 }],
    originalShipping: 30,
    returnProcessingFee: 60,
    exchangeProcessingFee: 40,
  });
  const coupon = calculateExchangeCouponAmount(
    { items: [{ price: 250, quantity: 1 }, { price: 150, quantity: 1 }], shippingAmount: 30, currency: 'SAR' },
  );
  assert.equal(split.couponAmount, coupon.fullAmount);
  assert.equal(split.refundAmount, 0);
});

test('mixed request charges one return fee from the refund and keeps the full coupon', () => {
  const split = splitRequestFinancials({
    pieces: [{ type: 'return', price: 200 }, { type: 'exchange', price: 200 }],
    originalShipping: 30,
    returnProcessingFee: 60,
    exchangeProcessingFee: 40,
  });
  assert.equal(split.requestType, 'mixed');
  assert.equal(split.processingFee, 60);
  assert.equal(split.refundAmount, 170);
  assert.equal(split.couponAmount, 200);
  assert.equal(split.feeTakenFromCoupon, 0);
});

test('fee the refund cannot cover comes out of the coupon', () => {
  const split = splitRequestFinancials({
    pieces: [{ type: 'return', price: 20 }, { type: 'exchange', price: 300 }],
    originalShipping: 0,
    returnProcessingFee: 60,
    exchangeProcessingFee: 40,
  });
  assert.equal(split.refundAmount, 0);
  assert.equal(split.feeTakenFromCoupon, 40);
  assert.equal(split.couponAmount, 260);
});

test('pieces excluded from the refund are not paid back', () => {
  const split = splitRequestFinancials({
    pieces: [{ type: 'return', price: 200 }, { type: 'return', price: 200, refundIncluded: false }],
    originalShipping: 30,
    returnProcessingFee: 60,
    exchangeProcessingFee: 40,
  });
  assert.equal(split.refundAmount, 170);
});
