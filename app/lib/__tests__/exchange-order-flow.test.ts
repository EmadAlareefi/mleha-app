import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyExchangeOrderState,
  createExchangeOrderForRequest,
  EXCHANGE_HOLD_FAILED_PREFIX,
  EXCHANGE_PIECE_FAILED_MESSAGE,
  priceExchangeCart,
  reconcileExchangeHolds,
  releaseExchangeOrderHold,
  runExchangePaymentMaintenance,
  syncFailedExchangePieceFlag,
  type ExchangeFlowDeps,
} from '../returns/exchange-order-flow';
import { normalizeProduct } from '../returns/exchange-catalog';
import type { ExchangeOrderState } from '../salla-exchange-order';

type Row = Record<string, any>;

/** Enough of Prisma's `where` for these tests: equality, `in`, `not`, NOT. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'NOT') return !matches(row, condition);
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if (Array.isArray(condition.in)) return condition.in.includes(row[key]);
      if ('not' in condition) return (row[key] ?? null) !== condition.not;
    }
    return (row[key] ?? null) === condition;
  });
}

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

const NEW_ORDER = '449146439';
const HOLD = '1576217163';
const PAYMENT_PENDING = '1224232774';

const orderState = (overrides: Partial<ExchangeOrderState> = {}): ExchangeOrderState => ({
  id: '777',
  referenceId: '297842943',
  statusSlug: 'payment_pending',
  customStatusId: PAYMENT_PENDING,
  statusName: 'بإنتظار الدفع',
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
  const calls = {
    coupons: [] as any[],
    deleted: [] as string[],
    orders: [] as any[],
    status: [] as any[],
    cancelled: [] as string[],
    notify: [] as any[],
    echoed: [] as any[],
  };
  const db: any = {
    returnRequest: {
      async findUnique() {
        return { ...state.request };
      },
      async findFirst({ where }: any) {
        return matches(state.request, where) ? { ...state.request } : null;
      },
      async findMany({ where }: any) {
        return matches(state.request, where) ? [{ ...state.request }] : [];
      },
      async update({ data }: any) {
        Object.assign(state.request, data);
        return { ...state.request };
      },
      async updateMany({ where, data }: any) {
        if (!matches(state.request, where)) return { count: 0 };
        Object.assign(state.request, data);
        return { count: 1 };
      },
    },
    returnExchangeLine: {
      async deleteMany() {
        state.request.exchangeLines = [];
        return { count: 0 };
      },
      async createMany({ data }: any) {
        state.request.exchangeLines = data.map((line: Row) => ({ ...line }));
        return { count: data.length };
      },
    },
    async $transaction(fn: any) {
      return fn(db);
    },
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
    echoMirrorStatus: async (...args) => {
      calls.echoed.push(args);
    },
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
  const paid = orderState({ statusSlug: 'under_review', customStatusId: NEW_ORDER, remainingAmount: 0, paidAmount: 75 });
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
    { getOrder: async () => orderState({ statusSlug: 'under_review', customStatusId: NEW_ORDER, remainingAmount: 0, paidAmount: 75 }) },
  );
  const report = await runExchangePaymentMaintenance(deps);
  assert.equal(report.paid, 1);
  assert.equal(state.request.exchangePaymentStatus, 'paid');
});

test('two concurrent creations make one Salla order and one credit coupon', async () => {
  const { calls, deps } = setup(baseRequest);
  const [first, second] = await Promise.all([
    createExchangeOrderForRequest('r1', deps),
    createExchangeOrderForRequest('r1', deps),
  ]);
  assert.equal(calls.orders.length, 1);
  assert.equal(calls.coupons.length, 1);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  const refused = [first, second].find((result) => !result.ok);
  assert.ok(refused && !refused.ok && refused.fellBackToCoupon === false);
});

test('an overdue order paid just before the cron cancels it is marked paid, not cancelled', async () => {
  let reads = 0;
  const { state, calls, deps } = setup(
    {
      ...baseRequest,
      exchangeOrderId: '777',
      exchangePaymentStatus: 'pending',
      exchangeCreditCouponId: 'c9',
      exchangePaymentDueAt: new Date('2026-11-04T09:00:00Z'),
    },
    {
      // First read: still unpaid. Second read (after the claim): paid.
      getOrder: async () =>
        ++reads === 1 ? orderState() : orderState({ statusSlug: 'under_review', customStatusId: NEW_ORDER, remainingAmount: 0, paidAmount: 75 }),
    },
  );
  const report = await runExchangePaymentMaintenance(deps);
  assert.equal(report.paid, 1);
  assert.equal(report.expired, 0);
  assert.deepEqual(calls.cancelled, []);
  assert.equal(state.request.exchangePaymentStatus, 'paid');
});

test('payment is applied once when the webhook and the cron see it together', async () => {
  const paid = orderState({ statusSlug: 'under_review', customStatusId: NEW_ORDER, remainingAmount: 0, paidAmount: 75 });
  const { state, calls, deps } = setup(
    { ...baseRequest, exchangeOrderId: '777', exchangePaymentStatus: 'pending' },
    { getOrder: async () => paid },
  );
  const snapshot = { ...state.request };
  const outcomes = await Promise.all([
    applyExchangeOrderState(snapshot as any, paid, deps),
    applyExchangeOrderState(snapshot as any, paid, deps),
  ]);
  assert.deepEqual(outcomes.sort(), ['paid', 'unchanged']);
  assert.equal(calls.status.length, 1);
});

// ---------------------------------------------------------------------------
// Hold → release to "طلب جديد"
// ---------------------------------------------------------------------------
const paidHeld = {
  ...baseRequest,
  status: 'shipped',
  exchangeOrderId: '777',
  exchangeOrderNumber: '297842943',
  exchangePaymentStatus: 'paid',
  exchangeOrderHoldActive: true,
  processingStatus: 'idle',
  processingAudit: [],
  items: [
    { id: 'i1', type: 'exchange', conditionStatus: null },
    { id: 'i2', type: 'return', conditionStatus: 'damaged' },
  ],
};
const heldLive = orderState({ statusSlug: 'under_review', customStatusId: HOLD, remainingAmount: 0, paidAmount: 75 });

test('paid after the return already passed inspection: straight to "طلب جديد", never held', async () => {
  const { state, calls, deps } = setup(
    {
      ...baseRequest,
      status: 'delivered',
      exchangeOrderId: '777',
      exchangePaymentStatus: 'pending',
      processingStatus: 'idle',
      items: [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }],
    },
  );
  const paid = orderState({ statusSlug: 'under_review', customStatusId: NEW_ORDER, remainingAmount: 0, paidAmount: 75 });
  assert.equal(await applyExchangeOrderState(state.request as any, paid, deps), 'paid');
  // Salla already moved it to "طلب جديد" on payment: nothing to write.
  assert.equal(calls.status.length, 0);
  assert.equal(state.request.exchangeOrderHoldActive, false);
  assert.ok(state.request.exchangeOrderReleasedAt);
  assert.equal(state.request.processingAudit.at(-1).details.outcome, 'already');
});

test('a refused hold is recorded, and the cron re-applies it when Salla still shows "طلب جديد"', async () => {
  let refuse = true;
  const { state, calls, deps } = setup(
    { ...baseRequest, exchangeOrderId: '777', exchangePaymentStatus: 'pending', processingStatus: 'idle', items: [] },
    {
      setStatus: async (...args) => {
        if (refuse) throw new Error('سلة (500)');
        calls.status.push(args);
      },
      getOrder: async () => orderState({ statusSlug: 'under_review', customStatusId: NEW_ORDER, remainingAmount: 0, paidAmount: 75 }),
    },
  );
  const paid = orderState({ statusSlug: 'under_review', customStatusId: NEW_ORDER, remainingAmount: 0, paidAmount: 75 });
  await applyExchangeOrderState(state.request as any, paid, deps);
  assert.equal(state.request.exchangeOrderHoldActive, true);
  assert.ok(state.request.exchangeOrderError.startsWith(EXCHANGE_HOLD_FAILED_PREFIX));

  refuse = false;
  const report = await reconcileExchangeHolds(deps);
  assert.equal(report.reheld, 1);
  assert.deepEqual(calls.status[0], ['m1', '777', Number(HOLD)]);
  assert.equal(state.request.exchangeOrderError, null);
  assert.deepEqual(calls.echoed[0], ['m1', '777', Number(HOLD)]);
});

test('the cron never re-holds an order staff moved by hand (no hold-failed marker)', async () => {
  const { calls, deps } = setup({ ...paidHeld }, { getOrder: async () => orderState({ customStatusId: NEW_ORDER, statusSlug: 'under_review' }) });
  const report = await reconcileExchangeHolds(deps);
  assert.equal(report.reheld, 0);
  assert.equal(calls.status.length, 0);
});

test('release waits for payment and for the exchanged piece; the returned piece does not matter', async () => {
  const unpaid = setup({ ...paidHeld, exchangePaymentStatus: 'pending', items: [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }] });
  assert.equal((await releaseExchangeOrderHold('r1', {}, unpaid.deps)).reason, 'payment_pending');
  // Forcing still needs the money.
  assert.equal((await releaseExchangeOrderHold('r1', { force: true }, unpaid.deps)).reason, 'payment_pending');

  const notInspected = setup({ ...paidHeld });
  assert.equal((await releaseExchangeOrderHold('r1', {}, notInspected.deps)).reason, 'items_not_inspected');

  // The damaged piece is a *return* piece: it does not block the replacement.
  const { state, calls, deps } = setup(
    { ...paidHeld, items: [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }, { id: 'i2', type: 'return', conditionStatus: 'damaged' }] },
    { getOrder: async () => heldLive },
  );
  const result = await releaseExchangeOrderHold('r1', { source: 'inspection' }, deps);
  assert.equal(result.released, true);
  assert.deepEqual(calls.status[0], ['m1', '777', Number(NEW_ORDER)]);
  assert.deepEqual(calls.echoed[0], ['m1', '777', Number(NEW_ORDER)]);
  assert.equal(state.request.exchangeOrderHoldActive, false);
  assert.equal(state.request.processingAudit.at(-1).details.released, true);
});

test('inspection is proof of arrival even when no carrier event came in', async () => {
  const { deps } = setup(
    { ...paidHeld, status: 'pending_review', receivedAt: null, items: [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }] },
    { getOrder: async () => heldLive },
  );
  assert.equal((await releaseExchangeOrderHold('r1', {}, deps)).released, true);
});

test('orders released to the old "تحت المراجعة R" target are moved on to "طلب جديد"', async () => {
  const { calls, deps } = setup(
    { ...paidHeld, items: [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }] },
    { getOrder: async () => orderState({ statusSlug: 'under_review', customStatusId: '1065456688' }) },
  );
  assert.equal((await releaseExchangeOrderHold('r1', {}, deps)).released, true);
  assert.deepEqual(calls.status[0], ['m1', '777', Number(NEW_ORDER)]);
});

test('a cancelled replacement is not released: staff are told; a packed one is recorded as released', async () => {
  const cancelled = setup(
    { ...paidHeld, items: [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }] },
    { getOrder: async () => orderState({ statusSlug: 'canceled', customStatusId: '1183362113' }) },
  );
  const result = await releaseExchangeOrderHold('r1', {}, cancelled.deps);
  assert.equal(result.released, false);
  assert.equal(result.reason, 'cancelled');
  assert.equal(cancelled.calls.status.length, 0);
  assert.equal(cancelled.state.request.processingStatus, 'needs_attention');
  assert.equal(cancelled.state.request.exchangeOrderHoldActive, true);

  const packed = setup(
    { ...paidHeld, items: [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }] },
    { getOrder: async () => orderState({ statusSlug: 'in_progress', customStatusId: '1956875584' }) },
  );
  const packedResult = await releaseExchangeOrderHold('r1', {}, packed.deps);
  assert.equal(packedResult.released, true);
  assert.equal(packedResult.outcome, 'progressed');
  assert.equal(packed.calls.status.length, 0);
  assert.equal(packed.calls.echoed.length, 0);
});

test('staff "ship anyway" releases a held order whose exchanged piece failed', async () => {
  const { state, calls, deps } = setup(
    {
      ...paidHeld,
      processingStatus: 'needs_attention',
      processingError: EXCHANGE_PIECE_FAILED_MESSAGE,
      items: [{ id: 'i1', type: 'exchange', conditionStatus: 'damaged' }],
    },
    { getOrder: async () => heldLive },
  );
  assert.equal((await releaseExchangeOrderHold('r1', {}, deps)).reason, 'items_failed');
  const forced = await releaseExchangeOrderHold('r1', { force: true, actor: 'نورة' }, deps);
  assert.equal(forced.released, true);
  assert.equal(calls.status.length, 1);
  assert.equal(state.request.processingStatus, 'idle');
  assert.equal(state.request.processingAudit.at(-1).by, 'نورة');
});

test('a failed exchanged piece on a replacement order needs attention right away, and clears when fixed', async () => {
  const { state, deps } = setup({ ...paidHeld, items: [{ id: 'i1', type: 'exchange', conditionStatus: 'worn' }] });
  assert.equal(await syncFailedExchangePieceFlag('r1', deps), 'flagged');
  assert.equal(state.request.processingStatus, 'needs_attention');
  assert.equal(state.request.processingError, EXCHANGE_PIECE_FAILED_MESSAGE);
  state.request.items = [{ id: 'i1', type: 'exchange', conditionStatus: 'good' }];
  assert.equal(await syncFailedExchangePieceFlag('r1', deps), 'cleared');
  assert.equal(state.request.processingStatus, 'idle');
});

test('a coupon already issued blocks creating a replacement order (one credit, one carrier)', async () => {
  const { calls, deps } = setup({ ...baseRequest, couponCode: 'EXCHANGE123' });
  const result = await createExchangeOrderForRequest('r1', deps);
  assert.equal(result.ok, false);
  assert.equal(calls.orders.length, 0);
});

