import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReturnFeeInvoicePayload,
  calculateERPPayloadTotal,
  transformOrderToERPInvoice,
} from '../erp-invoice';
import { getRequestCreditAmounts, isCreditedPiece } from '../../../lib/returns/erp-credit';

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

test('partial credit uses the returns-system piece prices, refund date and hrtnref', async () => {
  const p = await transformOrderToERPInvoice(order(), {
    returnedItems: [{ sku: 'A1-S', quantity: 1, price: 103.5 }],
    invoiceDate: new Date('2026-10-20T00:00:00Z'),
    returnReference: '5555',
  });
  assert.deepEqual(p.API_Inv, [{ cmbkey: 'A1-S', barcode: 'BC-A1-S', qty: 1, fqty: 0, price: 103.5, discpc: 0 }]);
  assert.equal(calculateERPPayloadTotal(p), 103.5);
  assert.equal(p.hinvdsvl, 0);
  assert.equal(p.transport_amt, 0);
  assert.equal(p.hrtnref, 5555);
  assert.equal(p.datetime_stamp, '2026-10-20T00:00:00.000Z');
  assert.equal(p.hvat_amt_rcvd, 13.5);
});

test('does not need the pieces to still be on the Salla order', async () => {
  // Salla removes returned lines after a partial return; the credit note must still build.
  const p = await transformOrderToERPInvoice(order(), {
    returnedItems: [{ sku: 'GONE-1', quantity: 2, price: 150 }, { sku: 'GONE-1', quantity: 1, price: 150 }],
  });
  assert.deepEqual(p.API_Inv.map((i) => [i.cmbkey, i.qty, i.price]), [['GONE-1', 3, 150]]);
  assert.equal(calculateERPPayloadTotal(p), 450);
});

test('credits shipping with the pieces and never COD', async () => {
  const p = await transformOrderToERPInvoice(order(), {
    returnedItems: [{ sku: 'B1', quantity: 1, price: 230 }],
    returnedShipping: 30,
  });
  const shipping = p.API_Inv.find((i) => i.barcode === '019');
  assert.deepEqual({ price: shipping?.price, qty: shipping?.qty }, { price: 30, qty: 1 });
  assert.equal(p.transport_amt, 26.09);
  assert.equal(calculateERPPayloadTotal(p), 260);
  assert.ok(!p.API_Inv.some((i) => i.barcode === '000'));
});

test('converts non-SAR piece prices with the order rate', async () => {
  const o = order();
  o.currency = 'AED';
  o.rawOrder.exchange_rate = { rate: 1.02, base_currency: 'SAR', exchange_currency: 'AED' };
  const p = await transformOrderToERPInvoice(o, { returnedItems: [{ sku: 'B1', quantity: 1, price: 100 }] });
  assert.equal(p.API_Inv[0].price, 102);
});

test('refuses pieces without SKU, quantity or price', async () => {
  await assert.rejects(transformOrderToERPInvoice(order(), { returnedItems: [{ sku: '', quantity: 1, price: 10 }] }), /غير صالحة/);
  await assert.rejects(transformOrderToERPInvoice(order(), { returnedItems: [{ sku: 'B1', quantity: 1, price: 0 }] }), /غير صالحة/);
});

const piece = (type: string, price: number, refundIncluded = true) => ({ type, price, quantity: 1, refundIncluded });
const request = (over: Partial<Parameters<typeof getRequestCreditAmounts>[0]>) => ({
  returnFee: 60, shippingAmount: 30, refundStatus: 'none', refundedAmount: null, couponAmountOverride: null, items: [], ...over,
});

test('return: fee is what was kept from the customer', () => {
  assert.deepEqual(getRequestCreditAmounts(request({ items: [piece('return', 391)] })), { credited: 421, customerValue: 361, fee: 60 });
});

test('return refunded in full: no fee invoice', () => {
  const r = request({ shippingAmount: 0, refundStatus: 'refunded', refundedAmount: 498, items: [piece('return', 498)] });
  assert.deepEqual(getRequestCreditAmounts(r), { credited: 498, customerValue: 498, fee: 0 });
});

test('exchange: credit equals coupon plus fee', () => {
  const r = request({ returnFee: 40, items: [piece('exchange', 376)] });
  assert.deepEqual(getRequestCreditAmounts(r), { credited: 406, customerValue: 366, fee: 40 });
});

test('exchange with a hand-set coupon follows the override', () => {
  const r = request({ returnFee: 40, couponAmountOverride: 380, items: [piece('exchange', 376)] });
  assert.deepEqual(getRequestCreditAmounts(r), { credited: 406, customerValue: 380, fee: 26 });
});

test('mixed: fee taken from refund first, pieces excluded from refund not credited', () => {
  const r = request({ items: [piece('return', 396), piece('exchange', 379), piece('return', 100, false)] });
  // credited 396 + 379 + 30; refund 396 + 30 − 60; coupon 379
  assert.deepEqual(getRequestCreditAmounts(r), { credited: 805, customerValue: 745, fee: 60 });
  assert.equal(isCreditedPiece({ type: 'return', refundIncluded: false }), false);
  assert.equal(isCreditedPiece({ type: 'exchange', refundIncluded: false }), true);
});

test('builds the return fee as a type-06 shipping sale', () => {
  const p = buildReturnFeeInvoicePayload(order(), { feeSar: 60, invoiceDate: new Date('2026-10-20T00:00:00Z') });
  assert.equal(p.ltrtype, '06');
  assert.deepEqual(p.API_Inv, [{ cmbkey: '0', barcode: '019', qty: 1, fqty: 0, price: 60, discpc: 0 }]);
  assert.equal(calculateERPPayloadTotal(p), 60);
  assert.equal(p.hvat_amt_rcvd, 7.83);
  assert.equal(p.transport_amt, 52.17);
  assert.equal(p.hrtnref, 0);
  assert.equal(p.Description, 'رسوم إرجاع 227000001');
  assert.equal(p.datetime_stamp, '2026-10-20T00:00:00.000Z');
  assert.throws(() => buildReturnFeeInvoicePayload(order(), { feeSar: 0, invoiceDate: new Date() }));
});
