import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReturnItems } from '../resolve-return-items';

const orderItem = (over: Record<string, any> = {}) => ({
  id: 111,
  name: 'فستان سهرة',
  sku: 'DR-001',
  quantity: 1,
  product: { id: 55, name: 'فستان سهرة', sku: 'DR-001', price: 725 },
  variant: { id: 9, name: 'أحمر / M' },
  amounts: {
    price_without_tax: { amount: 630 },
    tax: { amount: { amount: 94.5 } },
    total_discount: { amount: 0 },
    total: { amount: 724.5 },
  },
  ...over,
});

const order = (items: Record<string, any>[]) => ({ items });

test('prices a line from the order, ignoring anything the client sent', () => {
  const result = resolveReturnItems(order([orderItem()]), [
    {
      orderItemId: 111,
      productId: '55',
      quantity: 1,
      // Fields a hostile client might add — all must be ignored.
      price: 999999,
      productName: 'FREE MONEY',
      productSku: 'HACK',
    } as never,
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].price, 724.5);
  assert.equal(result.items[0].productName, 'فستان سهرة');
  assert.equal(result.items[0].productSku, 'DR-001');
  assert.equal(result.items[0].productId, '55');
  assert.equal(result.items[0].variantId, '9');
  assert.equal(result.items[0].variantName, 'أحمر / M');
});

test('an inflated client price cannot change the refund', () => {
  const honest = resolveReturnItems(order([orderItem()]), [
    { orderItemId: 111, productId: '55', quantity: 1 },
  ]);
  const hostile = resolveReturnItems(order([orderItem()]), [
    { orderItemId: 111, productId: '55', quantity: 1, price: 500000 } as never,
  ]);

  assert.equal(honest.ok && hostile.ok, true);
  if (!honest.ok || !hostile.ok) return;
  assert.deepEqual(hostile.items, honest.items);
});

test('rejects an item that is not on the order', () => {
  const result = resolveReturnItems(order([orderItem()]), [
    { orderItemId: 999, productId: '55', quantity: 1 },
  ]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unknown_item');
  assert.equal(result.orderItemId, '999');
});

test('rejects a missing or empty order item id', () => {
  for (const orderItemId of [undefined, null, '', '   ']) {
    const result = resolveReturnItems(order([orderItem()]), [
      { orderItemId, productId: '55', quantity: 1 } as never,
    ]);
    assert.equal(result.ok, false, `expected ${JSON.stringify(orderItemId)} to be rejected`);
  }
});

test('matches a numeric id sent as a string', () => {
  const result = resolveReturnItems(order([orderItem()]), [
    { orderItemId: '111', productId: '55', quantity: 1 },
  ]);
  assert.equal(result.ok, true);
});

test('rejects a quantity above what was ordered', () => {
  const result = resolveReturnItems(order([orderItem({ quantity: 2 })]), [
    { orderItemId: 111, productId: '55', quantity: 3 },
  ]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid_quantity');
});

test('rejects the same item split across lines to exceed the ordered quantity', () => {
  const result = resolveReturnItems(order([orderItem({ quantity: 2 })]), [
    { orderItemId: 111, productId: '55', quantity: 2 },
    { orderItemId: 111, productId: '55', quantity: 2 },
  ]);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid_quantity');
});

test('allows the same item split within the ordered quantity', () => {
  const result = resolveReturnItems(order([orderItem({ quantity: 3 })]), [
    { orderItemId: 111, productId: '55', quantity: 1 },
    { orderItemId: 111, productId: '55', quantity: 2 },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 2);
});

test('rejects zero, negative, fractional and non-numeric quantities', () => {
  for (const quantity of [
    0,
    -1,
    1.5,
    Number.NaN,
    Infinity,
    null as never,
    undefined as never,
    'two' as never,
    '' as never,
  ]) {
    const result = resolveReturnItems(order([orderItem({ quantity: 5 })]), [
      { orderItemId: 111, productId: '55', quantity },
    ]);
    assert.equal(result.ok, false, `expected quantity ${String(quantity)} to be rejected`);
  }
});

test('accepts a whole-number quantity sent as a string', () => {
  // Coerced, then held to the same integer and ceiling checks as a number.
  const result = resolveReturnItems(order([orderItem({ quantity: 5 })]), [
    { orderItemId: 111, productId: '55', quantity: '2' as never },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].quantity, 2);
});

test('tells two lines of the same product apart by order item id', () => {
  // The exact case a productId join would get wrong: one product, two variants.
  const small = orderItem({
    id: 111,
    variant: { id: 1, name: 'S' },
    amounts: { price_without_tax: { amount: 100 }, tax: { amount: { amount: 15 } } },
  });
  const large = orderItem({
    id: 222,
    variant: { id: 2, name: 'L' },
    amounts: { price_without_tax: { amount: 200 }, tax: { amount: { amount: 30 } } },
  });

  const result = resolveReturnItems(order([small, large]), [
    { orderItemId: 222, productId: '55', quantity: 1 },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].price, 230);
  assert.equal(result.items[0].variantName, 'L');
});

test('falls back to the client product id only when the order carries none', () => {
  const bare = { id: 111, name: 'منتج', quantity: 1, amounts: { total: { amount: 100 } } };

  const result = resolveReturnItems(order([bare]), [
    { orderItemId: 111, productId: '777', quantity: 1 },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0].productId, '777');
  assert.equal(result.items[0].price, 100);
});

test('handles an order with no items and an empty request', () => {
  assert.equal(resolveReturnItems(order([]), [{ orderItemId: 1, quantity: 1 }]).ok, false);
  assert.equal(resolveReturnItems(null, [{ orderItemId: 1, quantity: 1 }]).ok, false);

  const empty = resolveReturnItems(order([orderItem()]), []);
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.deepEqual(empty.items, []);
});
