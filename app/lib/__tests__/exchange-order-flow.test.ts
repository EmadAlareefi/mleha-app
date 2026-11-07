import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyExchangeOrderState,
  createExchangeOrderForRequest,
  priceExchangeCart,
  runExchangePaymentMaintenance,
  type ExchangeFlowDeps,
} from '../returns/exchange-order-flow';
import { normalizeProduct } from '../returns/exchange-catalog';
import type { ExchangeOrderState } from '../salla-exchange-order';

type Row = Record<string, any>;

const product = normalizeProduct({
  id: 100,
  name: 'فستان',
  status: 'sale',
  price: { amount: 245 },
  options: [{ id: 1, name: 'المقاس', values: [{ id: 11, name: 'S' }, { id: 12, name: 'M' }] }],
  skus: [
    { id: 501, stock_quantity: 3, price: { amount: 245 }, related_option_values: [11] },
    { id: 502, stock_quantity: 0, price: { amount: 245 }, related_option_values: [12] },
  ],
});

const shipping = {
  courierId: 1009048180,
  shipTo: { country: 1, city: 2, block: 'b', street_number: '1', address_line: 'x', geo_coordinates: { lat: 21, lng: 39 } },
};

const orderState = (overrides: Partial<ExchangeOrderState> = {}): ExchangeOrderState => ({
  id: '777',
  referenceId: '297842943',
  statusSlug: 'payment_pending',
  total: 75,
  currency: 'SAR',
  remainingAmount: 75,
  paidAmount: 0,
  checkoutUrl: 'https://mtjr.at/pay',
  pendingSecondsLeft: 75600,
  paymentMethod: 'mada',
  ...overrides,
});

function setup(request: Row, overrides: Partial<ExchangeFlowDeps> = {}) {
  const state = { request: { ...request } };
  const calls = { coupons: [] as any[], deleted: [] as string[], orders: [] as any[], status: [] as any[], cancelled: [] as string[], notify: [] as any[] };
  const db = {
    returnRequest: {
      async findUnique() {
        return { ...state.request };
      },
      async findFirst({ where }: any) {
        return where.exchangeOrderId === state.request.exchangeOrderId && state.request.exchangePaymentStatus === 'pending'
          ? { ...state.request }
          : null;
      },
      async findMany() {
        return state.request.exchangePaymentStatus === 'pending' ? [{ ...state.request }] : [];
      },
      async update({ data }: any) {
        Object.assign(state.request, data);
        return { ...state.request };
      },
    },
    returnExchangeLine: {},
  };
  const deps: ExchangeFlowDeps = {
    db: db as any,
    getProduct: async (_m, id) => (id === '100' ? product : null),
    getOriginalShipping: async () => shipping,
    createOrder: async (_m, input) => {
      calls.orders.push(input);
      return orderState();
    },
    getOrder: async () => orderState(),
    setStatus: async (...args) => {
      calls.status.push(args);
    },
    cancelOrder: async (_m, id) => {
      calls.cancelled.push(id);
    },
    createCoupon: async (_m, amount, prefix, options) => {
      calls.coupons.push({ amount, prefix, options });
      return { id: `c${calls.coupons.length}`, code: `${prefix}CODE${calls.coupons.length}` };
    },
    deleteCoupon: async (_m, id) => {
      calls.deleted.push(id);
      return true;
    },
    notify: async (...args) => {
      calls.notify.push(args);
    },
    notifyCoupon: async () => ({ status: 'sent' }),
    now: () => new Date('2026-11-04T10:00:00Z'),
    ...overrides,
  };
  return { state, calls, deps };
}

const baseRequest = {
  id: 'r1',
  merchantId: 'm1',
  orderId: 'o1',
  orderNumber: '1001',
  customerId: '1768583791',
  customerName: 'عميلة',
  customerPhone: '+966500000000',
  currency: 'SAR',
  createdAt: new Date('2026-11-04T10:00:00Z'),
  exchangeMode: 'order',
  exchangeCreditAmount: 170,
  exchangePaymentMethod: 'mada',
  exchangePaymentStatus: 'none',
  exchangeOrderId: null,
  exchangeLines: [{ productId: '100', skuId: '501', quantity: 1, unitPrice: 245, options: [{ id: '1', value: ['11'] }] }],
};

test('cart is priced from Salla: unknown, out-of-stock and over-quantity lines are refused', async () => {
  const { deps } = setup(baseRequest);
  const ok = await priceExchangeCart('m1', [{ productId: '100', skuId: '501', quantity: 1 }, { productId: '100', skuId: '501', quantity: 1 }], deps);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.lines.length, 1);
    assert.equal(ok.lines[0].quantity, 2);
    assert.equal(ok.total, 490);
    assert.deepEqual(ok.lines[0].options, [{ id: '1', value: ['11'] }]);
  }
  assert.equal((await priceExchangeCart('m1', [{ productId: '100', skuId: '502', quantity: 1 }], deps)).ok, false);
  assert.equal((await priceExchangeCart('m1', [{ productId: '100', skuId: '501', quantity: 4 }], deps)).ok, false);
  assert.equal((await priceExchangeCart('m1', [{ productId: '999', skuId: '1', quantity: 1 }], deps)).ok, false);
  assert.equal((await priceExchangeCart('m1', [], deps)).ok, false);
});

test('difference to pay: credit coupon on the order, payment link stored, not held until paid', async () => {
  const { state, calls, deps } = setup(baseRequest);
  const result = await createExchangeOrderForRequest('r1', deps);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.paymentUrl, 'https://mtjr.at/pay');
    assert.equal(result.amountDue, 75);
  }
  assert.deepEqual(calls.coupons[0], { amount: 170, prefix: 'EXO', options: { freeShipping: true, expiryDays: 3 } });
  assert.equal(calls.orders[0].couponCode, 'EXOCODE1');
  assert.equal(calls.orders[0].paymentMethod, 'mada');
  assert.equal(calls.orders[0].courierId, 1009048180);
  assert.equal(calls.status.length, 0);
  assert.equal(state.request.exchangePaymentStatus, 'pending');
  assert.equal(state.request.exchangeOrderId, '777');
  assert.equal(state.request.exchangeCheckoutUrl, 'https://mtjr.at/pay');
  assert.equal(state.request.exchangePaymentDueAt.toISOString(), '2026-11-05T07:00:00.000Z');
});

test('fully covered: held immediately, no payment link, leftover kept for processing', async () => {
  const { state, calls, deps } = setup(
    { ...baseRequest, exchangeCreditAmount: 300 },
    { createOrder: async (_m, input) => { calls.orders.push(input); return orderState({ total: 0, remainingAmount: 0, checkoutUrl: null }); } },
  );
  const result = await createExchangeOrderForRequest('r1', deps);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.paymentUrl, null);
    assert.equal(result.leftover, 55);
  }
  assert.equal(calls.orders[0].paymentMethod, null);
  assert.equal(calls.coupons[0].amount, 245);
  assert.equal(calls.status.length, 1);
  assert.equal(state.request.exchangePaymentStatus, 'not_required');
  assert.equal(state.request.exchangeOrderHoldActive, true);
  assert.equal(state.request.leftoverCouponAmount, 55);
});

test('order creation failure deletes the credit coupon and falls back to the classic coupon', async () => {
  const { state, calls, deps } = setup(baseRequest, {
    createOrder: async () => {
      throw new Error('سلة (422): courier_id');
    },
  });
  const result = await createExchangeOrderForRequest('r1', deps);
  assert.equal(result.ok, false);
  assert.deepEqual(calls.deleted, ['c1']);
  assert.equal(state.request.exchangeMode, 'coupon');
  assert.equal(state.request.exchangePaymentStatus, 'failed');
  assert.match(state.request.exchangeOrderError, /courier_id/);
});

test('missing payment link after creation cancels the order and falls back', async () => {
  const { state, calls, deps } = setup(baseRequest, { createOrder: async () => orderState({ checkoutUrl: null }) });
  const result = await createExchangeOrderForRequest('r1', deps);
  assert.equal(result.ok, false);
  assert.deepEqual(calls.cancelled, ['777']);
  assert.deepEqual(calls.deleted, ['c1']);
  assert.equal(state.request.exchangeMode, 'coupon');
});

test('a paid order is held and marked paid; repeat events change nothing', async () => {
  const { state, calls, deps } = setup({ ...baseRequest, exchangeOrderId: '777', exchangePaymentStatus: 'pending' });
  const paid = orderState({ statusSlug: 'under_review', remainingAmount: 0, paidAmount: 75 });
  assert.equal(await applyExchangeOrderState(state.request as any, paid, deps), 'paid');
  assert.equal(state.request.exchangePaymentStatus, 'paid');
  assert.equal(state.request.exchangeOrderHoldActive, true);
  assert.equal(calls.status.length, 1);
  assert.equal(await applyExchangeOrderState(state.request as any, paid, deps), 'unchanged');
  assert.equal(calls.status.length, 1);
});

test('maintenance: one reminder in the second half, then expiry cancels and falls back', async () => {
  const pending = {
    ...baseRequest,
    exchangeOrderId: '777',
    exchangeOrderNumber: '297842943',
    exchangePaymentStatus: 'pending',
    exchangeAmountDue: 75,
    exchangeCreditCouponId: 'c9',
    exchangeOrderLinkedAt: new Date('2026-11-04T00:00:00Z'),
    exchangePaymentDueAt: new Date('2026-11-04T20:00:00Z'),
    exchangeReminderSentAt: null,
  };
  // 10:00 is past halfway (00:00 → 20:00): remind once.
  const first = setup(pending);
  const report = await runExchangePaymentMaintenance(first.deps);
  assert.equal(report.reminded, 1);
  assert.equal(first.calls.notify[0][0], 'ZOKO_TPL_EXCHANGE_PAYMENT_PENDING');
  assert.ok(first.state.request.exchangeReminderSentAt);
  const again = await runExchangePaymentMaintenance(first.deps);
  assert.equal(again.reminded, 0);

  // Past the deadline: cancel, drop the credit coupon, fall back to coupon mode.
  const late = setup(pending, { now: () => new Date('2026-11-04T21:00:00Z') });
  const expired = await runExchangePaymentMaintenance(late.deps);
  assert.equal(expired.expired, 1);
  assert.deepEqual(late.calls.cancelled, ['777']);
  assert.deepEqual(late.calls.deleted, ['c9']);
  assert.equal(late.state.request.exchangeMode, 'coupon');
  assert.equal(late.state.request.exchangePaymentStatus, 'expired');
});

test('maintenance marks orders paid when the webhook was missed', async () => {
  const { state, deps } = setup(
    { ...baseRequest, exchangeOrderId: '777', exchangePaymentStatus: 'pending', exchangePaymentDueAt: new Date('2026-11-05T00:00:00Z') },
    { getOrder: async () => orderState({ statusSlug: 'under_review', remainingAmount: 0, paidAmount: 75 }) },
  );
  const report = await runExchangePaymentMaintenance(deps);
  assert.equal(report.paid, 1);
  assert.equal(state.request.exchangePaymentStatus, 'paid');
});
