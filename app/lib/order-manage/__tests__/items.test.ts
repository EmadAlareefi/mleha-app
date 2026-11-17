import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogProduct } from '@/app/lib/returns/exchange-catalog';
import { balanceOf, cancelsWholeOrder, decideItemsRefund, liveLines, planItemChanges, type LiveLine } from '../items';

// Shapes and figures from the live probe on test order #300550101 (2026-11-17).
const product = (id: string, optionId: string, values: Array<[string, string, number]>, price = 96): CatalogProduct => ({
  id,
  name: `p${id}`,
  imageUrl: null,
  price,
  regularPrice: price,
  currency: 'SAR',
  images: [],
  options: [{ id: optionId, name: 'المقاسات', values: values.map(([vid, name]) => ({ id: vid, name })) }],
  skus: values.map(([vid, , stock]) => ({
    id: `sku${vid}`,
    sku: null,
    optionValueIds: [vid],
    price,
    regularPrice: price,
    stock,
    inStock: stock > 0,
  })),
});

const brown = product('2074135624', '636052671', [['873760962', 'S', 7], ['32610243', 'M', 0]]);
const black = product('1851811051', '1841474635', [['1434204827', 'S', 10], ['660167140', 'M', 4]]);
const purple = product('406553826', '637926039', [['1786438605', 'S', 14], ['1145504462', 'M', 15]], 249);
const products = new Map([brown, black, purple].map((p) => [p.id, p]));

const lines: LiveLine[] = [
  { id: '73906233', productId: '2074135624', name: 'brown', quantity: 1, unitPrice: 96, valueIds: ['873760962'] },
  { id: '1447872314', productId: '1851811051', name: 'black', quantity: 1, unitPrice: 96, valueIds: ['1434204827'] },
];

test('a one-piece size change is edited in place and costs nothing', () => {
  const result = planItemChanges(lines, [{ itemId: '1447872314', action: 'size', reason: 'x', optionValueIds: ['660167140'] }], products);
  assert.ok(result.ok);
  assert.equal(result.plan.kind, 'swap');
  assert.deepEqual(result.plan.ops, [
    {
      type: 'update',
      itemId: '1447872314',
      quantity: 1,
      options: [{ id: '1841474635', value: ['660167140'] }],
      previousOptions: [{ id: '1841474635', value: ['1434204827'] }],
    },
  ]);
  assert.equal(result.plan.expectedDelta, 0);
});

test('a product change adds the new line before deleting the old one', () => {
  const result = planItemChanges(lines, [{ itemId: '1447872314', action: 'product', reason: 'x', productId: '406553826', optionValueIds: ['1145504462'] }], products);
  assert.ok(result.ok);
  assert.equal(result.plan.kind, 'items');
  assert.deepEqual(result.plan.ops.map((op) => op.type), ['add', 'delete']);
  assert.equal(result.plan.expectedDelta, 153);
});

test('cancelling one piece deletes its line and expects a refund', () => {
  const result = planItemChanges(lines, [{ itemId: '1447872314', action: 'cancel', reason: 'x' }], products);
  assert.ok(result.ok);
  assert.deepEqual(result.plan.ops.map((op) => op.type), ['delete']);
  assert.equal(result.plan.expectedDelta, -96);
});

test('one piece of a two-piece line reduces the quantity', () => {
  const two: LiveLine[] = [{ ...lines[1], quantity: 2 }];
  const result = planItemChanges(two, [{ itemId: '1447872314', action: 'size', reason: 'x', optionValueIds: ['660167140'] }], products);
  assert.ok(result.ok);
  assert.deepEqual(result.plan.ops.map((op) => op.type), ['add', 'reduce']);
});

test('refuses out-of-stock sizes, the same size and missing reasons', () => {
  assert.equal(planItemChanges(lines, [{ itemId: '73906233', action: 'size', reason: 'x', optionValueIds: ['32610243'] }], products).ok, false);
  assert.equal(planItemChanges(lines, [{ itemId: '73906233', action: 'size', reason: 'x', optionValueIds: ['873760962'] }], products).ok, false);
  assert.equal(planItemChanges(lines, [{ itemId: '73906233', action: 'cancel', reason: ' ' }], products).ok, false);
  assert.equal(planItemChanges(lines, [{ itemId: '999', action: 'cancel', reason: 'x' }], products).ok, false);
});

test('cancelling every piece is a whole-order cancel', () => {
  const all = lines.map((line) => ({ itemId: line.id, action: 'cancel' as const, reason: 'x' }));
  assert.equal(cancelsWholeOrder(lines, all), true);
  assert.equal(cancelsWholeOrder(lines, all.slice(1)), false);
});

test('reads lines and balances from a live order', () => {
  const detail = {
    amounts: { total: { amount: 126 } },
    items: [{ id: 73906233, product_id: 2074135624, quantity: 1, amounts: { total: { amount: 96 } }, options: [{ id: 1, value: { id: 873760962 } }] }],
    payment_actions: {
      refund_action: { has_refund_amount: true, refund_amount: { amount: 96 }, pending_refund_amount: null, paid_amount: { amount: 222 } },
      remaining_action: { has_remaining_amount: false, paid_amount: { amount: 222 }, remaining_amount: null },
    },
  };
  assert.deepEqual(liveLines(detail), [{ id: '73906233', productId: '2074135624', name: '', quantity: 1, unitPrice: 96, valueIds: ['873760962'] }]);
  assert.deepEqual(balanceOf(detail), { due: 0, owed: 96, paid: 222, total: 126 });
  // After the refund is sent, Salla keeps refund_amount and adds a pending amount.
  const pending = { ...detail, payment_actions: { ...detail.payment_actions, refund_action: { ...detail.payment_actions.refund_action, pending_refund_amount: { amount: 96 } } } };
  assert.equal(balanceOf(pending).owed, 0);
});

test('refund decision: automatic only for a clean single SAR payment', () => {
  const tx = [{ id: 379688611, status: { slug: 'paid' }, total: { amount: 222, currency: 'SAR' }, available_actions: ['refund'], payment_method: { slug: 'mada', is_refundable: true, within_refund_period: true } }] as never;
  const settings = { autoRefundEnabled: true, autoRefundDailyCapSar: 5000 };
  assert.equal(decideItemsRefund({ amount: 96, transactions: tx, priorRefunds: 0, settings, autoRefundedTodaySar: 0 }).action, 'auto');
  assert.equal(decideItemsRefund({ amount: 96, transactions: tx, priorRefunds: 1, settings, autoRefundedTodaySar: 0 }).action, 'manual');
  assert.equal(decideItemsRefund({ amount: 300, transactions: tx, priorRefunds: 0, settings, autoRefundedTodaySar: 0 }).action, 'manual');
  assert.equal(decideItemsRefund({ amount: 96, transactions: tx, priorRefunds: 0, settings: { ...settings, autoRefundEnabled: false }, autoRefundedTodaySar: 0 }).action, 'manual');
});
