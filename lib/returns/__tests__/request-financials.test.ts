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
