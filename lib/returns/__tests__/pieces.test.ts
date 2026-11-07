import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimedPieceKeys,
  deriveRequestType,
  expandOrderPieces,
  legacyItemsToPieces,
  pieceKey,
  productEligibility,
  resolveRequestedPieces,
  type PieceRuleContext,
} from '../pieces';

const line = (id: number, productId: number, quantity: number, price = 200, variantId?: number) => ({
  id,
  quantity,
  name: `dress ${productId}`,
  product: { id: productId },
  variant: variantId ? { id: variantId, name: `size ${variantId}` } : undefined,
  amounts: {
    price_without_tax: { amount: price / 1.15 },
    tax: { amount: { amount: price - price / 1.15 } },
    total_discount: { amount: 0 },
    total: { amount: price * quantity },
  },
});

const emptyCtx = (): PieceRuleContext => ({
  oneRiyalProductIds: new Set(),
  discountedProductIds: new Set(),
  outletProductIds: new Set(),
  nationalDayProductIds: new Set(),
  windowExpiredProductIds: new Set(),
});

test('a line with quantity 2 becomes two pieces with independent choices', () => {
  const order = { items: [line(1, 10, 2)] };
  const pieces = expandOrderPieces(order);
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces.map((p) => [p.orderItemId, p.unitIndex, p.lineQuantity]), [['1', 0, 2], ['1', 1, 2]]);

  const ctx = emptyCtx();
  const result = resolveRequestedPieces(order, [
    { orderItemId: 1, unitIndex: 0, type: 'return', ribbonRemoved: false },
    { orderItemId: 1, unitIndex: 1, type: 'exchange', ribbonRemoved: false },
  ], { rules: (id) => productEligibility(id, ctx) });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.pieces.map((p) => p.type), ['return', 'exchange']);
    assert.equal(result.pieces[0].unitPrice, 200);
  }
});

test('the same product on two lines follows the same rules', () => {
  const ctx = { ...emptyCtx(), outletProductIds: new Set(['10']) };
  const order = { items: [line(1, 10, 1, 100, 501), line(2, 10, 1, 100, 502)] };
  const rules = (id: string) => productEligibility(id, ctx);
  for (const orderItemId of [1, 2]) {
    const result = resolveRequestedPieces(order, [{ orderItemId, unitIndex: 0, type: 'return', ribbonRemoved: false }], { rules });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'EXCHANGE_ONLY');
  }
});

test('outlet pieces are exchange-only while other pieces can still be returned', () => {
  const ctx = { ...emptyCtx(), outletProductIds: new Set(['20']) };
  const order = { items: [line(1, 10, 1), line(2, 20, 1)] };
  const result = resolveRequestedPieces(order, [
    { orderItemId: 1, unitIndex: 0, type: 'return', ribbonRemoved: false },
    { orderItemId: 2, unitIndex: 0, type: 'exchange', ribbonRemoved: false },
  ], { rules: (id) => productEligibility(id, ctx) });
  assert.equal(result.ok, true);
  assert.deepEqual(productEligibility('20', ctx).allowedTypes, ['exchange']);
});

test('1 SAR and discounted pieces are blocked, 1 SAR first', () => {
  const ctx = { ...emptyCtx(), oneRiyalProductIds: new Set(['30']), discountedProductIds: new Set(['30', '40']), outletProductIds: new Set(['30']) };
  assert.equal(productEligibility('30', ctx).blockedCode, 'ONE_RIYAL_OFFER');
  assert.equal(productEligibility('40', ctx).blockedCode, 'DISCOUNTED_CATEGORY');
  assert.deepEqual(productEligibility('40', ctx).allowedTypes, []);
});

test('window override exempts only the time window', () => {
  const ctx = { ...emptyCtx(), windowExpiredProductIds: new Set(['10']), discountedProductIds: new Set(['20']) };
  assert.equal(productEligibility('10', ctx).blockedCode, 'RETURN_PERIOD_EXPIRED');
  assert.deepEqual(productEligibility('10', { ...ctx, windowOverride: true }).allowedTypes, ['return', 'exchange']);
  assert.equal(productEligibility('20', { ...ctx, windowOverride: true }).blockedCode, 'DISCOUNTED_CATEGORY');
});

test('rejects removed ribbons, missing answers, duplicates, unknown pieces and claimed pieces', () => {
  const order = { items: [line(1, 10, 2)] };
  const ctx = emptyCtx();
  const rules = (id: string) => productEligibility(id, ctx);
  const code = (pieces: any[], claimed?: Set<string>) => {
    const result = resolveRequestedPieces(order, pieces, { rules, claimed });
    return result.ok ? 'ok' : result.code;
  };
  assert.equal(code([{ orderItemId: 1, unitIndex: 0, type: 'return', ribbonRemoved: true }]), 'RIBBON_REMOVED');
  assert.equal(code([{ orderItemId: 1, unitIndex: 0, type: 'return' }]), 'RIBBON_UNANSWERED');
  assert.equal(code([
    { orderItemId: 1, unitIndex: 0, type: 'return', ribbonRemoved: false },
    { orderItemId: 1, unitIndex: 0, type: 'exchange', ribbonRemoved: false },
  ]), 'DUPLICATE_PIECE');
  assert.equal(code([{ orderItemId: 1, unitIndex: 2, type: 'return', ribbonRemoved: false }]), 'UNKNOWN_PIECE');
  assert.equal(code([{ orderItemId: 9, unitIndex: 0, type: 'return', ribbonRemoved: false }]), 'UNKNOWN_PIECE');
  assert.equal(code([{ orderItemId: 1, unitIndex: 0, type: 'refund', ribbonRemoved: false }]), 'INVALID_TYPE');
  assert.equal(code([{ orderItemId: 1, unitIndex: 1, type: 'return', ribbonRemoved: false }], new Set([pieceKey(1, 1)])), 'ALREADY_REQUESTED');
  assert.equal(code([]), 'EMPTY');
});

test('previously requested pieces are claimed exactly (v2) or by count (legacy)', () => {
  const order = { items: [line(1, 10, 2, 100, 501), line(2, 10, 1, 100, 502), line(3, 20, 3)] };
  const pieces = expandOrderPieces(order);
  const claimed = claimedPieceKeys(pieces, [
    { orderItemId: '3', unitIndex: 2, productId: '20', quantity: 1 },
    { productId: '10', variantId: '502', quantity: 1 },
    { productId: '20', quantity: 2 },
  ]);
  assert.deepEqual([...claimed].sort(), ['2:0', '3:0', '3:1', '3:2']);
});

test('legacy payloads become pieces using the first intact pieces', () => {
  const pieces = legacyItemsToPieces([{ orderItemId: 1, quantity: 1, ribbonRemoved: [true, false] }], 'exchange');
  assert.deepEqual(pieces, [{ orderItemId: 1, unitIndex: 1, type: 'exchange', ribbonRemoved: false }]);
  const tooMany = legacyItemsToPieces([{ orderItemId: 1, quantity: 2, ribbonRemoved: [true, false] }], 'return');
  assert.equal(tooMany?.length, 2);
  assert.equal(tooMany?.[1].ribbonRemoved, true);
});

test('request type is derived from the pieces', () => {
  assert.equal(deriveRequestType(['return', 'return']), 'return');
  assert.equal(deriveRequestType(['exchange']), 'exchange');
  assert.equal(deriveRequestType(['exchange', 'return']), 'mixed');
});
