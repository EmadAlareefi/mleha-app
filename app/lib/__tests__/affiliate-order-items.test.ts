import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { loadAffiliateOrderItems } from '../affiliate-order-items';

function mockItemQuery(t: TestContext, implementation: (args: any) => Promise<any[]>) {
  const original = prisma.sallaOrderItem.findMany;
  const mocked = t.mock.fn(implementation);
  prisma.sallaOrderItem.findMany = mocked as typeof original;
  t.after(() => { prisma.sallaOrderItem.findMany = original; });
  return mocked;
}

test('loads every item across a large date range using bounded merchant queries', async (t) => {
  const orders = Array.from({ length: 1201 }, (_, index) => ({
    id: `record-${index}`,
    merchantId: 'merchant-a',
    orderId: `order-${index}`,
  }));
  const queriedOrderIds: string[] = [];
  const findMany = mockItemQuery(t, async (args) => {
    assert.equal(args.where.merchantId, 'merchant-a');
    const ids: string[] = args.where.orderId.in;
    assert.ok(ids.length <= 500);
    queriedOrderIds.push(...ids);
    return ids.map((orderId) => ({
      orderId,
      productId: `product-${orderId}`,
      totalAmount: new Prisma.Decimal(100),
    }));
  });

  const result = await loadAffiliateOrderItems(orders);

  assert.equal(findMany.mock.callCount(), 3);
  assert.deepEqual(queriedOrderIds, orders.map((order) => order.orderId));
  assert.equal(result.length, orders.length);
  for (const [index, order] of result.entries()) {
    assert.equal(order.id, orders[index].id);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].productId, `product-${order.orderId}`);
    assert.equal(Number(order.items[0].totalAmount), 100);
  }
});

test('keeps merchants with the same order ID separate and preserves empty orders', async (t) => {
  mockItemQuery(t, async (args) => [
    { orderId: 'shared', productId: args.where.merchantId, totalAmount: null },
    { orderId: 'shared', productId: null, totalAmount: new Prisma.Decimal(25) },
  ]);

  const result = await loadAffiliateOrderItems([
    { merchantId: 'a', orderId: 'shared' },
    { merchantId: 'b', orderId: 'shared' },
    { merchantId: 'a', orderId: 'empty' },
  ]);

  assert.equal(result[0].items[0].productId, 'a');
  assert.equal(result[1].items[0].productId, 'b');
  assert.equal(result[0].items.length, 2);
  assert.equal(result[1].items.length, 2);
  assert.deepEqual(result[2].items, []);
});

test('does not query items when no orders match the filters', async (t) => {
  const findMany = mockItemQuery(t, async () => []);
  assert.deepEqual(await loadAffiliateOrderItems([]), []);
  assert.equal(findMany.mock.callCount(), 0);
});
