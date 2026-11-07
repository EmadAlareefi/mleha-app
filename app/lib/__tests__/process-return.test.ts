import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  markRefundedManually,
  processReturnRequest,
  setProcessReturnDb,
  type ProcessDependencies,
} from '../returns/process-return';
import { SallaCallError } from '../salla-transactions';

// ---------------------------------------------------------------------------
// Minimal in-memory stand-in for prisma.returnRequest / prisma.returnItem.
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some((branch) => matches(row, branch));
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('in' in condition) return condition.in.includes(row[key]);
      if ('notIn' in condition) return !condition.notIn.includes(row[key]);
      if ('lt' in condition) return row[key] instanceof Date && row[key].getTime() < condition.lt.getTime();
    }
    return row[key] === condition;
  });
}

function createDb(request: Row, items: Row[]) {
  const state = { request: { ...request }, items: items.map((item) => ({ ...item })) };
  currentState = state;
  const withItems = () => ({ ...state.request, items: state.items.map((item) => ({ ...item })) });
  const db = {
    returnRequest: {
      async findUnique({ where }: any) {
        return where.id === state.request.id ? withItems() : null;
      },
      async update({ where, data }: any) {
        assert.equal(where.id, state.request.id);
        Object.assign(state.request, data);
        return withItems();
      },
      async updateMany({ where, data }: any) {
        if (!matches(state.request, where)) return { count: 0 };
        Object.assign(state.request, data);
        return { count: 1 };
      },
    },
    returnItem: {
      async update({ where, data }: any) {
        const item = state.items.find((row) => row.id === where.id);
        Object.assign(item!, data);
        return item;
      },
    },
  };
  return { db: db as any, state };
}

const baseRequest = {
  id: 'r1',
  merchantId: 'm1',
  orderId: 'o1',
  orderNumber: '1001',
  type: 'mixed',
  status: 'delivered',
  processingStatus: 'idle',
  refundStatus: 'none',
  couponCode: null,
  couponAmountOverride: null,
  totalRefundAmount: 170,
  returnFee: 60,
  shippingAmount: 30,
  currency: 'SAR',
  feeExchangeRate: 1,
  feeExchangeRateSource: 'sar',
  processingAudit: [],
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

const pieces = (overrides: Row[] = []) => [
  { id: 'i1', type: 'return', price: 200, quantity: 1, productId: 'p1', variantId: 'v1', productName: 'Dress', variantName: 'M', conditionStatus: 'good', refundIncluded: true, restockStatus: 'none', ...overrides[0] },
  { id: 'i2', type: 'exchange', price: 200, quantity: 1, productId: 'p1', variantId: 'v2', productName: 'Dress', variantName: 'L', conditionStatus: 'damaged', refundIncluded: false, restockStatus: 'none', ...overrides[1] },
];

const paidTx = { id: 77, total: { amount: 430, currency: 'SAR' }, status: { slug: 'paid' }, available_actions: ['refund'], payment_method: { slug: 'mada' } };

let currentState: { request: Row } | null = null;

function fakeDeps(overrides: Partial<ProcessDependencies> = {}) {
  const calls = { restock: [] as any[], refund: [] as any[], coupon: [] as any[], status: [] as any[], history: [] as any[], release: [] as any[], leftover: [] as any[] };
  const deps: ProcessDependencies = {
    getOrder: async () => null,
    listTransactions: async () => [paidTx],
    historyRefunds: async () => [],
    refund: async (...args) => {
      calls.refund.push(args);
      return { success: true };
    },
    restock: async (_merchantId, item) => {
      calls.restock.push(item);
      return { ok: true };
    },
    issueCoupon: async (id) => {
      calls.coupon.push(id);
      // The real issuer stores the code on the request.
      if (currentState) currentState.request.couponCode = 'EXCHANGE1';
      return { ok: true, couponCode: 'EXCHANGE1' };
    },
    setOrderStatus: async (...args) => {
      calls.status.push(args);
      return { success: true };
    },
    addOrderHistory: async (...args) => {
      calls.history.push(args);
      return { success: true };
    },
    afterStatusChange: async () => undefined,
    releaseExchangeOrder: async (id) => {
      calls.release.push(id);
      if (currentState) currentState.request.exchangeOrderHoldActive = false;
      return { released: true };
    },
    issueLeftoverCoupon: async (id) => {
      calls.leftover.push(id);
      if (currentState) currentState.request.leftoverCouponCode = 'EXCHANGELEFT';
      return { code: 'EXCHANGELEFT', amount: Number(currentState?.request.leftoverCouponAmount) || 0 };
    },
    ...overrides,
  };
  return { deps, calls };
}

afterEach(() => {
  setProcessReturnDb(null);
  currentState = null;
});

test('processes a mixed request: restock good piece, refund return, coupon for exchange, close', async () => {
  const { db, state } = createDb(baseRequest, pieces());
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps();

  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);

  assert.equal(result.completed, true);
  assert.deepEqual(calls.restock, [{ productId: 'p1', variantId: 'v1', quantity: 1 }]);
  assert.deepEqual(state.items.map((item) => item.restockStatus), ['done', 'skipped']);
  // 200 return piece + 30 shipping − 60 return fee
  assert.equal(calls.refund.length, 1);
  assert.deepEqual(calls.refund[0], ['m1', 77, 170, 'SAR', 430]);
  assert.equal(state.request.refundStatus, 'refunded');
  assert.deepEqual(calls.coupon, ['r1']);
  assert.equal(state.request.status, 'completed');
  assert.equal(state.request.processingStatus, 'done');
  assert.equal(calls.history.length, 1);
  assert.ok(state.request.processingAudit.some((entry: any) => entry.step === 'complete'));
});

test('refuses to process before every piece is inspected', async () => {
  const { db, state } = createDb(baseRequest, pieces([{}, { conditionStatus: null }]));
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps();
  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(result.ok, false);
  assert.equal(calls.refund.length + calls.restock.length, 0);
  assert.equal(state.request.processingStatus, 'idle');
});

test('a second click while processing is rejected by the claim', async () => {
  const { db } = createDb({ ...baseRequest, processingStatus: 'processing' }, pieces());
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps();
  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(result.status, 409);
  assert.equal(calls.refund.length, 0);
});

test('a processing claim left by a run that died is taken over after 5 minutes', async () => {
  const fresh = createDb({ ...baseRequest, processingStatus: 'processing', updatedAt: new Date() }, pieces());
  setProcessReturnDb(fresh.db);
  assert.equal((await processReturnRequest('r1', { actor: 'staff' }, fakeDeps().deps)).status, 409);

  const stale = createDb(
    { ...baseRequest, processingStatus: 'processing', updatedAt: new Date(Date.now() - 6 * 60 * 1000) },
    pieces(),
  );
  setProcessReturnDb(stale.db);
  const result = await processReturnRequest('r1', { actor: 'staff' }, fakeDeps().deps);
  assert.notEqual(result.status, 409);
});

test('a restock whose outcome was never recorded is not sent again until staff confirm it', async () => {
  const { db, state } = createDb(baseRequest, pieces([{ restockStatus: 'requested' }]));
  setProcessReturnDb(db);
  const first = fakeDeps();
  const blocked = await processReturnRequest('r1', { actor: 'staff' }, first.deps);
  assert.equal(first.calls.restock.length, 0);
  assert.equal(blocked.completed, false);
  assert.equal(state.items[0].restockStatus, 'requested');

  state.request.processingStatus = 'needs_attention';
  const second = fakeDeps();
  await processReturnRequest('r1', { actor: 'staff', confirmUnknownRestocks: true }, second.deps);
  assert.equal(second.calls.restock.length, 0);
  assert.equal(state.items[0].restockStatus, 'done');
});

test('restock is marked as sent before the Salla call', async () => {
  const { db, state } = createDb(baseRequest, pieces());
  setProcessReturnDb(db);
  let statusDuringCall: string | undefined;
  const { deps } = fakeDeps({
    restock: async () => {
      statusDuringCall = state.items[0].restockStatus;
      return { ok: true };
    },
  });
  await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(statusDuringCall, 'requested');
  assert.equal(state.items[0].restockStatus, 'done');
});

test('an unknown refund outcome is never resent, and a retry does not duplicate finished steps', async () => {
  const { db, state } = createDb(baseRequest, pieces());
  setProcessReturnDb(db);
  let refundAttempts = 0;
  const { deps, calls } = fakeDeps({
    refund: async () => {
      refundAttempts++;
      throw new SallaCallError('timeout', undefined, true);
    },
  });

  const first = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(first.completed, false);
  assert.equal(state.request.refundStatus, 'unknown');
  assert.equal(state.request.processingStatus, 'needs_attention');

  const second = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(second.completed, false);
  assert.equal(refundAttempts, 1);
  // Restock and coupon were done once, not repeated by the retry.
  assert.equal(calls.restock.length, 1);
  assert.equal(calls.coupon.length, 1);
});

test('a failed (4xx) refund can be retried', async () => {
  const { db, state } = createDb(baseRequest, pieces());
  setProcessReturnDb(db);
  let fail = true;
  const { deps, calls } = fakeDeps({
    refund: async (...args) => {
      calls.refund.push(args);
      if (fail) throw new SallaCallError('سلة (422): invalid', 422, false);
      return { success: true };
    },
  });
  await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(state.request.refundStatus, 'failed');
  fail = false;
  const retry = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(retry.completed, true);
  assert.equal(calls.refund.length, 2);
});

test('no electronic payment (COD) becomes a manual refund, then closes after confirmation', async () => {
  const { db, state } = createDb({ ...baseRequest, type: 'return' }, pieces([{}, { type: 'return' }]));
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps({ listTransactions: async () => [] });

  const first = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(first.completed, false);
  assert.equal(state.request.refundStatus, 'manual');
  assert.equal(calls.refund.length, 0);

  await markRefundedManually('r1', { actor: 'staff', amount: 170 }, deps);
  assert.equal(state.request.refundStatus, 'refunded');
  const second = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(second.completed, true);
  assert.equal(calls.refund.length, 0);
});

test('an existing refund in the Salla history blocks an automatic second refund', async () => {
  const { db, state } = createDb(baseRequest, pieces());
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps({
    historyRefunds: async () => [{ amount: 170, note: 'تم إرجاع مبلغ (170 ر.س)', at: '2026-11-02T10:00:00Z' }],
  });
  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(result.completed, false);
  assert.equal(calls.refund.length, 0);
  assert.equal(state.request.refundStatus, 'none');

  const confirmed = await processReturnRequest('r1', { actor: 'staff', ignoreExistingRefunds: true }, deps);
  assert.equal(confirmed.completed, true);
  assert.equal(calls.refund.length, 1);
});

test('closing as refunded in Salla requires a refund in the order history', async () => {
  const { db, state } = createDb(baseRequest, pieces());
  setProcessReturnDb(db);
  const { deps } = fakeDeps();
  const missing = await markRefundedManually('r1', { actor: 'staff', requireSallaEvidence: true }, deps);
  assert.equal(missing.ok, false);
  const { deps: withEvidence } = fakeDeps({
    historyRefunds: async () => [{ amount: 170, note: 'تم إرجاع مبلغ (170 ر.س)' }],
  });
  const found = await markRefundedManually('r1', { actor: 'staff', requireSallaEvidence: true }, withEvidence);
  assert.equal(found.ok, true);
  assert.equal(state.request.refundedAmount, 170);
});

// ---------------------------------------------------------------------------
// Exchange v3: app-created replacement orders
// ---------------------------------------------------------------------------
const orderMode = (overrides: Row = {}) => ({
  ...baseRequest,
  exchangeMode: 'order',
  exchangeOrderId: '555',
  exchangeOrderNumber: '297842943',
  exchangePaymentStatus: 'paid',
  exchangeOrderHoldActive: true,
  leftoverCouponAmount: null,
  leftoverCouponCode: null,
  ...overrides,
});

test('order mode: paid + exchanged piece good releases the replacement instead of issuing a coupon', async () => {
  const { db, state } = createDb(orderMode(), pieces([{}, { conditionStatus: 'good', refundIncluded: true }]));
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps();
  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(result.completed, true);
  assert.deepEqual(calls.release, ['r1']);
  assert.equal(calls.coupon.length, 0);
  assert.equal(state.request.status, 'completed');
});

test('order mode: payment still pending blocks processing without releasing', async () => {
  const { db, state } = createDb(orderMode({ exchangePaymentStatus: 'pending', exchangeOrderHoldActive: false }), pieces([{}, { conditionStatus: 'good' }]));
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps();
  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(result.completed, false);
  assert.equal(calls.release.length, 0);
  assert.equal(calls.coupon.length, 0);
  assert.equal(state.request.processingStatus, 'needs_attention');
  assert.match(state.request.processingError, /بانتظار دفع العميل/);
});

test('order mode: a damaged exchanged piece needs a staff decision', async () => {
  const { db } = createDb(orderMode(), pieces());
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps();
  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(result.completed, false);
  assert.equal(calls.release.length, 0);
  assert.match(result.blockers.join(' '), /قرري إرسال طلب الاستبدال/);
});

test('order mode: leftover credit becomes a coupon once, at processing', async () => {
  const { db, state } = createDb(orderMode({ leftoverCouponAmount: 45 }), pieces([{}, { conditionStatus: 'good' }]));
  setProcessReturnDb(db);
  const { deps, calls } = fakeDeps();
  const result = await processReturnRequest('r1', { actor: 'staff' }, deps);
  assert.equal(result.completed, true);
  assert.deepEqual(calls.leftover, ['r1']);
  assert.equal(state.request.leftoverCouponCode, 'EXCHANGELEFT');
});
