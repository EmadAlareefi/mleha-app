import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPieceChanges, type PieceChangeDeps } from '../returns/piece-changes-service';
import { withStaffLock } from '../returns/request-lock';
import { storedRequestAmounts } from '@/lib/returns/request-financials';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if (Array.isArray(condition.in)) return condition.in.includes(row[key]);
      if ('not' in condition) return (row[key] ?? null) !== condition.not;
    }
    return (row[key] ?? null) === condition;
  });
}

function setup(request: Row, items: Row[], options: { couponUnused?: boolean; deleteOk?: boolean; lines?: number } = {}) {
  const state = {
    request: { processingAudit: [], ...request } as Row,
    items: items.map((item) => ({ ...item })),
    lines: Array.from({ length: options.lines ?? 0 }, (_, index) => ({ id: `l${index}` })),
  };
  const calls = { deleted: [] as any[], updated: [] as any[], notified: [] as any[], checks: 0 };
  const snapshot = () => ({ ...state.request, items: state.items.map((item) => ({ ...item })), exchangeLines: state.lines.map((line) => ({ id: line.id })) });
  const db: any = {
    returnRequest: {
      async findUnique({ where }: any) {
        return where.id === state.request.id ? snapshot() : null;
      },
      async update({ data }: any) {
        Object.assign(state.request, data);
        return snapshot();
      },
      async updateMany({ where, data }: any) {
        if (!matches(state.request, where)) return { count: 0 };
        Object.assign(state.request, data);
        return { count: 1 };
      },
    },
    returnItem: {
      async update({ where, data }: any) {
        const item = state.items.find((candidate) => candidate.id === where.id)!;
        Object.assign(item, data);
        return item;
      },
    },
    returnExchangeLine: {
      async deleteMany() {
        const count = state.lines.length;
        state.lines = [];
        return { count };
      },
    },
    async $transaction(fn: any) {
      return fn(db);
    },
  };
  const deps: PieceChangeDeps = {
    db,
    loadCategories: async () => ({ known: true, blocked: new Map(), exchangeOnly: new Map() }),
    getOrder: async () => null,
    computeAmounts: async (req: any) => {
      const amounts = storedRequestAmounts({
        items: req.items,
        shippingAmount: req.shippingAmount,
        currency: req.currency,
        couponAmountOverride: req.couponAmountOverride,
      });
      return {
        requestType: amounts.type,
        refundAmount: amounts.refundAmount,
        couponAmount: amounts.creditAmount,
        couponAmountSar: amounts.creditAmount,
        couponSource: 'calculated',
        processingFee: amounts.returnFee,
        originalShipping: 30,
        currency: 'SAR',
        exchangeRate: 1,
        exchangeRateSource: 'sar',
      };
    },
    checkCoupon: async () => {
      calls.checks++;
      return options.couponUnused === false ? { unused: false, reason: 'الكوبون مستخدم في الطلب #5' } : { unused: true };
    },
    deleteCoupon: async (...args) => {
      calls.deleted.push(args);
      return options.deleteOk !== false;
    },
    updateCouponAmount: async (...args) => {
      calls.updated.push(args);
      return { success: true };
    },
    notifyCoupon: async (input: any) => {
      calls.notified.push(input);
      return { status: 'sent' };
    },
    lock: withStaffLock,
    now: () => new Date('2026-11-10T10:00:00Z'),
  };
  return { state, calls, deps };
}

const base = {
  id: 'r1',
  merchantId: 'm1',
  orderId: 'o1',
  orderNumber: '1001',
  customerName: 'عميلة',
  customerPhone: '+966500000000',
  createdAt: new Date('2026-11-01T10:00:00Z'),
  type: 'exchange',
  status: 'delivered',
  processingStatus: 'idle',
  processingError: null,
  refundStatus: 'none',
  couponCode: 'EXCHANGE1',
  couponId: 'c1',
  couponCreatedAt: new Date('2026-11-02T10:00:00Z'),
  couponAmount: 190,
  couponAmountOverride: null,
  totalRefundAmount: 190,
  returnFee: 40,
  shippingAmount: 30,
  currency: 'SAR',
  feeExchangeRate: 1,
  exchangeMode: 'coupon',
  exchangeOrderId: null,
  exchangePaymentStatus: 'none',
  erpFeeSyncedAt: null,
  leftoverCouponCode: null,
};
const exchangePiece = { id: 'i1', type: 'exchange', price: 200, quantity: 1, refundIncluded: true, productId: 'p1', productName: 'فستان', variantName: 'M' };

test('a dry run previews the money and the coupon outcome without writing anything', async () => {
  const { state, calls, deps } = setup(base, [exchangePiece]);
  const result = await applyPieceChanges({ id: 'r1', actor: 'نورة', setAll: 'return', dryRun: true }, deps);
  assert.ok(result.ok && !result.executed);
  if (result.ok) {
    assert.equal(result.preview.before.credit, 190);
    assert.equal(result.preview.after.refund, 170);
    assert.equal(result.preview.after.credit, 0);
    assert.equal(result.preview.coupon?.action, 'revoke');
    assert.deepEqual(result.preview.coupon?.check, { unused: true });
    assert.deepEqual(result.preview.needs, ['coupon']);
  }
  assert.equal(state.items[0].type, 'exchange');
  assert.equal(calls.deleted.length, 0);
});

test('exchange → return with an unused coupon: confirmation required, then the coupon is deleted and the money moves', async () => {
  const { state, calls, deps } = setup(base, [exchangePiece]);
  const unconfirmed = await applyPieceChanges({ id: 'r1', actor: 'نورة', setAll: 'return' }, deps);
  assert.equal(!unconfirmed.ok && unconfirmed.code, 'NEEDS_CONFIRMATION');
  assert.equal(calls.deleted.length, 0);

  const result = await applyPieceChanges({ id: 'r1', actor: 'نورة', setAll: 'return', confirm: { coupon: true }, note: 'العميلة طلبت استرجاع المبلغ' }, deps);
  assert.ok(result.ok && result.executed, JSON.stringify(result));
  assert.deepEqual(calls.deleted, [['m1', 'c1']]);
  assert.equal(state.items[0].type, 'return');
  assert.equal(state.request.type, 'return');
  assert.equal(state.request.totalRefundAmount, 170);
  assert.equal(state.request.couponAmount, null);
  assert.equal(state.request.couponCode, null);
  assert.equal(state.request.processingStatus, 'idle');
  const steps = state.request.processingAudit.map((entry: Row) => entry.step);
  assert.deepEqual(steps, ['coupon', 'type_change']);
  assert.equal(state.request.processingAudit[1].details.note, 'العميلة طلبت استرجاع المبلغ');
});

test('a used coupon blocks the switch and nothing changes', async () => {
  const { state, calls, deps } = setup(base, [exchangePiece], { couponUnused: false });
  const result = await applyPieceChanges({ id: 'r1', actor: 'نورة', setAll: 'return', confirm: { coupon: true } }, deps);
  assert.equal(!result.ok && result.code, 'COUPON_USED');
  assert.equal(calls.deleted.length, 0);
  assert.equal(state.items[0].type, 'exchange');
  assert.equal(state.request.couponCode, 'EXCHANGE1');
});

test('Salla refusing the delete leaves the request untouched and unlocked', async () => {
  const { state, deps } = setup(base, [exchangePiece], { deleteOk: false });
  const result = await applyPieceChanges({ id: 'r1', actor: 'نورة', setAll: 'return', confirm: { coupon: true } }, deps);
  assert.equal(!result.ok && result.code, 'COUPON_DELETE_FAILED');
  assert.equal(state.items[0].type, 'exchange');
  assert.equal(state.request.couponCode, 'EXCHANGE1');
  assert.equal(state.request.processingStatus, 'idle');
});

test('mixed → exchange keeps the coupon code and sets it to the new credit in Salla', async () => {
  const { state, calls, deps } = setup(
    { ...base, type: 'mixed', couponAmount: 200, totalRefundAmount: 170, returnFee: 60 },
    [{ ...exchangePiece, id: 'i1' }, { ...exchangePiece, id: 'i2', type: 'return', productName: 'عباية' }],
  );
  const result = await applyPieceChanges(
    { id: 'r1', actor: 'نورة', changes: [{ itemId: 'i2', type: 'exchange' }], confirm: { coupon: true }, notifyCustomer: true },
    deps,
  );
  assert.ok(result.ok && result.executed, JSON.stringify(result));
  // 400 + 30 − 40 = 390 credit; Salla gets it before VAT.
  assert.equal(state.request.couponAmount, 390);
  assert.equal(state.request.totalRefundAmount, 390);
  assert.equal(state.request.type, 'exchange');
  assert.equal(calls.updated[0][2], Number((390 / 1.15).toFixed(2)));
  assert.equal(calls.notified[0].couponCode, 'EXCHANGE1');
});

test('a "needs attention" request keeps its status and reason after the change', async () => {
  const { state, deps } = setup(
    { ...base, couponCode: null, couponId: null, couponAmount: null, processingStatus: 'needs_attention', processingError: 'فشل الاسترجاع' },
    [exchangePiece],
  );
  const result = await applyPieceChanges({ id: 'r1', actor: 'نورة', setAll: 'return' }, deps);
  assert.ok(result.ok && result.executed);
  assert.equal(state.request.processingStatus, 'needs_attention');
  assert.equal(state.request.processingError, 'فشل الاسترجاع');
});

test('a request being processed is refused', async () => {
  const { deps } = setup({ ...base, processingStatus: 'processing' }, [exchangePiece]);
  const result = await applyPieceChanges({ id: 'r1', actor: 'نورة', setAll: 'return', confirm: { coupon: true } }, deps);
  assert.equal(!result.ok && result.status, 409);
});
