import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRefundAmount,
  parseHistoryRefunds,
  pickRefundableTransaction,
  refundTransaction,
  setSallaTransactionsTransport,
} from '../salla-transactions';

const tx = (overrides: Record<string, any> = {}) => ({
  id: 77,
  total: { amount: 500, currency: 'SAR' },
  status: { slug: 'paid' },
  available_actions: ['refund'],
  payment_method: { slug: 'mada', is_refundable: true, within_refund_period: true },
  ...overrides,
});

test('picks the single refundable payment', () => {
  const option = pickRefundableTransaction([tx(), tx({ id: 78, status: { slug: 'failed' } })]);
  assert.equal(option.ok, true);
  if (option.ok) {
    assert.equal(option.transaction.id, 77);
    assert.equal(option.total, 500);
  }
});

test('explains why no refund is possible', () => {
  const code = (txs: any[]) => {
    const option = pickRefundableTransaction(txs);
    return option.ok ? 'ok' : option.code;
  };
  assert.equal(code([]), 'NO_PAYMENT');
  assert.equal(code([tx({ available_actions: [] })]), 'NO_PAYMENT');
  assert.equal(code([tx(), tx({ id: 2 })]), 'MULTIPLE_PAYMENTS');
  assert.equal(code([tx({ payment_method: { is_refundable: false } })]), 'NOT_REFUNDABLE');
  assert.equal(code([tx({ payment_method: { within_refund_period: false } })]), 'PERIOD_EXPIRED');
  assert.equal(code([tx({ status: { slug: 'partial_refunded' } })]), 'ok');
});

test('never sends 0 (Salla full refund) or more than the payment', () => {
  assert.throws(() => assertRefundAmount(0, 500));
  assert.throws(() => assertRefundAmount(-1, 500));
  assert.throws(() => assertRefundAmount(500.01, 500));
  assert.doesNotThrow(() => assertRefundAmount(500, 500));
});

test('refund sends the action payload and refuses bad amounts without calling Salla', async () => {
  const calls: any[] = [];
  setSallaTransactionsTransport({ async call(...args) { calls.push(args); return { success: true }; } });
  try {
    await refundTransaction('m1', 77, 170.004, 'SAR', 500);
    assert.deepEqual(calls[0], ['m1', 'PUT', '/transactions/77', { action: 'refund', amount: 170, currency: 'SAR' }]);
    await assert.rejects(() => refundTransaction('m1', 77, 0, 'SAR', 500));
    assert.equal(calls.length, 1);
  } finally {
    setSallaTransactionsTransport(null);
  }
});

test('reads refunds from order history notes, including Arabic digits', () => {
  const refunds = parseHistoryRefunds([
    { note: '<p>تم إرجاع مبلغ (35 ر.س) إلى العميل من رصيد المدفوعات الإلكترونية</p>', created_by: { name: 'Sara' } },
    { note: 'تم استرجاع المبلغ (١٧٠٫٥ ر.س)' },
    { note: 'تم تغيير حالة الطلب' },
  ]);
  assert.deepEqual(refunds.map((r) => r.amount), [35, 170.5]);
  assert.equal(refunds[0].by, 'Sara');
});
