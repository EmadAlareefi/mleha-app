import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRequestMoney, type MoneyInput } from '../money-summary';

const base = (overrides: Partial<MoneyInput>): MoneyInput => ({
  type: 'return',
  currency: 'SAR',
  totalRefundAmount: null,
  couponAmount: null,
  returnFee: 60,
  shippingAmount: 0,
  refundStatus: 'none',
  items: [],
  ...overrides,
});

test('an exchange-only request never shows a refund (totalRefundAmount holds its credit)', () => {
  const money = summarizeRequestMoney(base({ type: 'exchange', totalRefundAmount: 190, couponAmount: null, items: [{ type: 'exchange', price: 200 }] }));
  assert.equal(money.refund, null);
  assert.equal(money.credit?.amount, 190);
  assert.equal(money.credit?.via, 'not_issued');
  assert.equal(money.typeMismatch, false);
});

test('a return shows the refund and its status; refunded shows what was paid', () => {
  const money = summarizeRequestMoney(base({ totalRefundAmount: 140, refundStatus: 'refunded', refundedAmount: 135, items: [{ type: 'return', price: 200 }] }));
  assert.deepEqual(money.refund, { amount: 135, status: 'refunded', refunded: true });
  assert.equal(money.credit, null);
});

test('mixed shows both; the credit says where it went', () => {
  const coupon = summarizeRequestMoney(
    base({ type: 'mixed', totalRefundAmount: 170, couponAmount: 200, couponCode: 'EXCHANGE1', items: [{ type: 'return', price: 200 }, { type: 'exchange', price: 200 }] }),
  );
  assert.equal(coupon.refund?.amount, 170);
  assert.equal(coupon.credit?.via, 'coupon');
  assert.equal(coupon.credit?.code, 'EXCHANGE1');

  const replacement = summarizeRequestMoney(
    base({
      type: 'exchange',
      couponAmount: 190,
      exchangeMode: 'order',
      exchangeOrderId: '777',
      exchangeOrderNumber: '297842943',
      exchangePaymentStatus: 'paid',
      exchangeCreditAmount: 190,
      items: [{ type: 'exchange', price: 200 }],
    }),
  );
  assert.equal(replacement.credit?.via, 'replacement');
  assert.equal(replacement.credit?.orderNumber, '297842943');
});

test('old data: an "exchange" request whose pieces say return is flagged and recomputed from the pieces', () => {
  const money = summarizeRequestMoney(base({ type: 'exchange', totalRefundAmount: 190, items: [{ type: 'return', price: 200 }], shippingAmount: 30 }));
  assert.equal(money.typeMismatch, true);
  assert.equal(money.derivedType, 'return');
  assert.equal(money.refund?.amount, 170);
});
