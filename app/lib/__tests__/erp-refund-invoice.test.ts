import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateERPPayloadTotal, transformOrderToERPInvoice } from '../erp-invoice';

// Barcode lookups are stubbed; the Salla items call has no token here, so the
// transform falls back to rawOrder.items.
process.env.ERP_BARCODE_API_URL = 'https://erp.test/api';
process.env.ERP_API_KEY = 'k';
globalThis.fetch = (async (url: string) => {
  const m = String(url).match(/getItemDetails\/(.+)$/);
  if (m) return new Response(JSON.stringify({ barcode: `BC-${m[1]}` }), { status: 200 });
  throw new Error(`unexpected fetch ${url}`);
}) as any;

function item(sku: string, productSku: string, qty: number, net: number, discount: number) {
  return {
    sku, product: { sku: productSku }, quantity: qty, name: sku,
    amounts: {
      price_without_tax: { amount: net }, tax: { amount: { amount: net * 0.15 } },
      total_discount: { amount: discount }, total: { amount: net * 1.15 * qty - discount },
    },
  };
}

function order(discountAmount = 0, total = 477.01): any {
  return {
    id: 'rec1', merchantId: 'm1', orderId: 'o1', orderNumber: '227000001',
    statusSlug: 'refund', statusName: 'refund', currency: 'SAR', paymentMethod: 'cod',
    taxAmount: 62.22, shippingAmount: 26.09, discountAmount, subtotalAmount: 400, totalAmount: total,
    erpInvoiceId: '5555', erpSyncedAt: new Date(), placedAt: new Date('2026-01-05T10:00:00Z'),
    rawOrder: {
      date: { created: '2026-01-05T10:00:00Z' },
      amounts: { total: { amount: total }, cash_on_delivery: { amount: 8.7 }, shipping_cost: { amount: 26.09 } },
      items: [item('A1-S', 'A1', 2, 100, 23), item('B1', 'B1', 1, 200, 0)],
    },
  };
}

test('full reversal unchanged: whole order, original date, hrtnref 0', async () => {
  const p = await transformOrderToERPInvoice(order());
  assert.equal(p.ltrtype, '26');
  assert.equal(calculateERPPayloadTotal(p), 477.01);
  assert.ok(p.API_Inv.some((i) => i.barcode === '019'));
  assert.equal(p.hrtnref, 0);
  assert.equal(p.datetime_stamp, '2026-01-05T10:00:00.000Z');
});

test('partial return credits only returned qty, no shipping/COD, refund date, hrtnref', async () => {
  const p = await transformOrderToERPInvoice(order(), {
    returnedItems: [{ sku: 'A1-S', quantity: 1 }],
    invoiceDate: new Date('2026-10-20T00:00:00Z'),
    returnReference: '5555',
  });
  assert.equal(p.API_Inv.length, 1);
  assert.deepEqual({ qty: p.API_Inv[0].qty, price: p.API_Inv[0].price, discpc: p.API_Inv[0].discpc }, { qty: 1, price: 115, discpc: 10 });
  assert.equal(calculateERPPayloadTotal(p), 103.5);
  assert.equal(p.transport_amt, 0);
  assert.equal(p.hrtnref, 5555);
  assert.equal(p.datetime_stamp, '2026-10-20T00:00:00.000Z');
  assert.equal(p.hvat_amt_rcvd, 13.5);
});

test('matches return items stored with the parent product SKU', async () => {
  const p = await transformOrderToERPInvoice(order(), { returnedItems: [{ sku: 'A1', quantity: 2 }] });
  assert.equal(p.API_Inv.length, 1);
  assert.equal(p.API_Inv[0].qty, 2);
  assert.equal(calculateERPPayloadTotal(p), 207);
});

test('prorates order-level discount by returned gross', async () => {
  // order gross = 230 + 230 = 460; returning B1 (230) => half the 46 discount
  const p = await transformOrderToERPInvoice(order(46, 431.01), { returnedItems: [{ sku: 'B1', quantity: 1 }] });
  assert.equal(p.hinvdsvl, 23);
  assert.equal(calculateERPPayloadTotal(p), 207);
});

test('refuses unmatched or excess returned quantities', async () => {
  await assert.rejects(transformOrderToERPInvoice(order(), { returnedItems: [{ sku: 'ZZZ', quantity: 1 }] }), /غير موجودة/);
  await assert.rejects(transformOrderToERPInvoice(order(), { returnedItems: [{ sku: 'B1', quantity: 3 }] }), /غير موجودة/);
});
