import assert from 'node:assert/strict';
import test from 'node:test';
import { missingConfirmations, planPieceChanges, type CategoryRules, type PlanRequest } from '../piece-changes';

const piece = (id: string, type: string, price = 200, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  price,
  quantity: 1,
  refundIncluded: true,
  productId: `p-${id}`,
  productName: `منتج ${id}`,
  ...extra,
});

const request = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  status: 'delivered',
  processingStatus: 'idle',
  refundStatus: 'none',
  couponCode: null,
  couponId: null,
  couponAmount: null,
  couponAmountOverride: null,
  exchangeMode: 'coupon',
  exchangeOrderId: null,
  exchangePaymentStatus: 'none',
  erpFeeSyncedAt: null,
  leftoverCouponCode: null,
  shippingAmount: 30,
  currency: 'SAR',
  feeExchangeRate: 1,
  exchangeLinesCount: 0,
  items: [piece('a', 'return')],
  ...overrides,
});

const rules = (overrides: Partial<CategoryRules> = {}): CategoryRules => ({
  known: true,
  exchangeOnly: new Map(),
  blocked: new Map(),
  ...overrides,
});

test('a closed, busy or unchanged request is refused with a reason staff can act on', () => {
  for (const [overrides, code] of [
    [{ status: 'completed' }, 'CLOSED'],
    [{ processingStatus: 'processing' }, 'PROCESSING'],
    [{ refundStatus: 'refunded' }, 'REFUNDED'],
    [{ refundStatus: 'unknown' }, 'REFUND_IN_FLIGHT'],
    [{ exchangePaymentStatus: 'creating' }, 'EXCHANGE_ORDER_BUSY'],
    [{ erpFeeSyncedAt: new Date() }, 'ERP_POSTED'],
  ] as const) {
    const result = planPieceChanges(request(overrides as Partial<PlanRequest>), { setAll: 'exchange' });
    assert.equal(result.ok, false, code);
    if (!result.ok) assert.equal(result.code, code);
  }
  const same = planPieceChanges(request(), { setAll: 'return' });
  assert.equal(!same.ok && same.code, 'NO_CHANGE');
  const unknownPiece = planPieceChanges(request(), { changes: [{ itemId: 'zzz', type: 'exchange' }] });
  assert.equal(!unknownPiece.ok && unknownPiece.code, 'INVALID');
});

test('a failed or manual refund (no money moved) does not block a switch', () => {
  for (const refundStatus of ['failed', 'manual']) {
    const plan = planPieceChanges(request({ refundStatus }), { setAll: 'exchange' }, rules());
    assert.equal(plan.ok, true);
    if (plan.ok) assert.equal(plan.resetRefundStatus, true);
  }
});

test('an active replacement order must be cancelled first', () => {
  const plan = planPieceChanges(
    request({ exchangeMode: 'order', exchangeOrderId: '777', exchangePaymentStatus: 'paid', items: [piece('a', 'exchange')] }),
    { setAll: 'return' },
  );
  assert.equal(!plan.ok && plan.code, 'ACTIVE_REPLACEMENT');
});

test('return → exchange moves the money from refund to credit with the lower fee', () => {
  const plan = planPieceChanges(request(), { setAll: 'exchange' }, rules());
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.before.type, 'return');
  assert.equal(plan.before.refundAmount, 170); // 200 + 30 − 60
  assert.equal(plan.after.type, 'exchange');
  assert.equal(plan.after.refundAmount, 0);
  assert.equal(plan.after.creditAmount, 190); // 200 + 30 − 40
  assert.equal(plan.diffs.length, 1);
  assert.equal(plan.couponAction, null);
});

test('an issued coupon is deleted when no exchange piece is left, updated when the credit changes', () => {
  const revoke = planPieceChanges(
    request({ couponCode: 'EXCHANGE1', couponId: 'c1', couponAmount: 190, items: [piece('a', 'exchange')] }),
    { setAll: 'return' },
    rules(),
  );
  assert.ok(revoke.ok);
  if (revoke.ok) {
    assert.equal(revoke.couponAction, 'revoke');
    assert.deepEqual(missingConfirmations(revoke), ['coupon']);
    assert.deepEqual(missingConfirmations(revoke, { coupon: true }), []);
  }

  const update = planPieceChanges(
    request({ couponCode: 'EXCHANGE1', couponId: 'c1', couponAmount: 200, items: [piece('a', 'return'), piece('b', 'exchange')] }),
    { changes: [{ itemId: 'a', type: 'exchange' }] },
    rules(),
  );
  assert.ok(update.ok);
  if (update.ok) assert.equal(update.couponAction, 'update');
});

test('a coupon entered by hand needs staff to settle it in Salla themselves', () => {
  const plan = planPieceChanges(
    request({ couponCode: 'MANUAL1', couponId: null, couponAmount: 190, items: [piece('a', 'exchange')] }),
    { setAll: 'return' },
    rules(),
  );
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.ok(plan.warnings.some((warning) => warning.code === 'MANUAL_COUPON'));
    assert.deepEqual(missingConfirmations(plan, { coupon: true }).sort(), ['manualCoupon']);
  }
});

test('a hand-set credit belongs to the old pieces and is cleared when they change', () => {
  const plan = planPieceChanges(
    request({ couponAmountOverride: 300, items: [piece('a', 'exchange'), piece('b', 'exchange')] }),
    { changes: [{ itemId: 'b', type: 'return' }] },
    rules(),
  );
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.equal(plan.clearsOverride, true);
    assert.ok(plan.warnings.some((warning) => warning.code === 'CLEARS_OVERRIDE'));
  }
});

test('exchange-only products need a policy confirmation to become a return; unknown categories only warn', () => {
  const outlet = rules({ exchangeOnly: new Map([['p-a', 'منتجات اوتليت مليحة متاحة للاستبدال فقط']]) });
  const plan = planPieceChanges(request({ items: [piece('a', 'exchange')] }), { setAll: 'return' }, outlet);
  assert.ok(plan.ok);
  if (plan.ok) assert.deepEqual(missingConfirmations(plan), ['policy']);

  const unknown = planPieceChanges(request({ items: [piece('a', 'exchange')] }), { setAll: 'return' }, rules({ known: false }));
  assert.ok(unknown.ok);
  if (unknown.ok) {
    assert.ok(unknown.warnings.some((warning) => warning.code === 'POLICY_UNKNOWN'));
    assert.deepEqual(missingConfirmations(unknown), []);
  }
});

test('turning the last exchange piece into a return drops saved replacement lines', () => {
  const plan = planPieceChanges(
    request({ exchangeMode: 'order', exchangePaymentStatus: 'expired', exchangeLinesCount: 2, items: [piece('a', 'exchange')] }),
    { setAll: 'return' },
    rules(),
  );
  assert.ok(plan.ok);
  if (plan.ok) assert.equal(plan.dropsExchangeLines, true);
});

test('excluding a return piece from the refund lowers the refund only', () => {
  const plan = planPieceChanges(
    request({ items: [piece('a', 'return'), piece('b', 'return', 100)] }),
    { changes: [{ itemId: 'b', refundIncluded: false }] },
  );
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.equal(plan.typeChanged, false);
    assert.equal(plan.before.refundAmount, 270);
    assert.equal(plan.after.refundAmount, 170);
  }
});
