import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluatePromoUsage,
  extractPromoLineItems,
  getPromoLimitConfig,
  mergePromoProductIds,
  type PromoPriorOrder,
} from '../promo-limit';

const promoIds = new Set(['100', '101']);
const prior: PromoPriorOrder = {
  orderId: '900',
  orderNumber: '24001',
  placedAt: '2026-10-30T10:00:00.000Z',
  statusName: 'تم التنفيذ',
  quantity: 1,
};

test('config defaults to the free category with a limit of 1, and can be switched off', () => {
  assert.deepEqual(getPromoLimitConfig({}), { enabled: true, categoryIds: ['289631972'], maxPerCustomer: 1 });
  assert.equal(getPromoLimitConfig({ PROMO_LIMIT_CATEGORY_IDS: 'off' }).enabled, false);
  assert.deepEqual(getPromoLimitConfig({ PROMO_LIMIT_CATEGORY_IDS: '1, 2', PROMO_LIMIT_MAX_PER_CUSTOMER: '2' }), {
    enabled: true,
    categoryIds: ['1', '2'],
    maxPerCustomer: 2,
  });
});

test('extracts line items from webhook-shaped and detail-shaped payloads', () => {
  const items = extractPromoLineItems({ data: { items: [{ quantity: 2, name: 'A', product: { id: 100, sku: 'X' } }] } });
  assert.deepEqual(items, [{ productId: '100', quantity: 2, name: 'A', sku: 'X' }]);
  assert.deepEqual(extractPromoLineItems({ items: [{ product_id: '101', quantity: 1 }] })[0].productId, '101');
  assert.deepEqual(extractPromoLineItems(null), []);
});

test('one promo unit and no history is fine', () => {
  const result = evaluatePromoUsage({ maxPerCustomer: 1, items: [{ productId: '100', quantity: 1 }], promoIds, priorOrders: [] });
  assert.equal(result.violation, false);
  assert.equal(result.message, null);
});

test('two promo units in one order is a violation', () => {
  const result = evaluatePromoUsage({
    maxPerCustomer: 1,
    items: [{ productId: '100', quantity: 1 }, { productId: '101', quantity: 1 }, { productId: '5', quantity: 3 }],
    promoIds,
    priorOrders: [],
  });
  assert.equal(result.violation, true);
  assert.equal(result.promoUnitsInOrder, 2);
  assert.match(result.message!, /2 قطع/);
});

test('a promo unit after an earlier promo order is a violation that names the order', () => {
  const result = evaluatePromoUsage({ maxPerCustomer: 1, items: [{ productId: '101', quantity: 1 }], promoIds, priorOrders: [prior] });
  assert.equal(result.violation, true);
  assert.match(result.message!, /#24001/);
});

test('orders without promo items are never flagged, even for past promo customers', () => {
  const result = evaluatePromoUsage({ maxPerCustomer: 1, items: [{ productId: '5', quantity: 1 }], promoIds, priorOrders: [prior] });
  assert.equal(result.violation, false);
  assert.deepEqual(result.priorOrders, []);
});

test('the promo id list keeps products that left the category', () => {
  assert.deepEqual(mergePromoProductIds(['1', '2'], ['2', '3'], ['4']), ['1', '2', '3', '4']);
});
