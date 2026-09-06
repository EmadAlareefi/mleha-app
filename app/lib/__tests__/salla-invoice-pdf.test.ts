import assert from 'node:assert/strict';
import test from 'node:test';
import type { SallaOrder } from '../salla-api';
import { buildInvoiceData, invoiceTotalMatchesOrder, selectCustomerSalesInvoice } from '../salla-invoice-pdf';

function order(overrides: Record<string, unknown> = {}): SallaOrder {
  return {
    id: 10,
    reference_id: 'ORDER-10',
    date: { created: '2026-08-12 14:30:00' },
    customer: { full_name: 'Buyer', city: 'Riyadh', country: 'Saudi Arabia', mobile_code: '+966', mobile: '0500000000' },
    amounts: {
      sub_total: { amount: 100, currency: 'SAR' },
      shipping_cost: { amount: 20, currency: 'SAR' },
      tax: { percent: 15, amount: { amount: 15, currency: 'SAR' } },
      total: { amount: 135, currency: 'SAR' },
    },
    items: [],
    ...overrides,
  } as unknown as SallaOrder;
}

test('customer PDF uses outbound recipient and destination, excluding return-to-warehouse and profile addresses', () => {
  const data = buildInvoiceData(order({
    shipments: [
      { type: 'return', ship_to: { name: 'Warehouse', city: 'Jeddah', address_line: 'Warehouse street' } },
      { type: 'shipment', ship_to: { name: 'Receiver', city: { id: 12, name: 'Dubai' }, country: { name: 'UAE' }, address_line: 'Delivery street', phone: '+971500000000', postal_code: '12345' } },
      { type: 'shipment', ship_to: { city: 'Old city', address_line: 'Old street' } },
    ],
    shipping: { address: { city: 'Stale city', address_line: 'Stale street' } },
  }), null);
  assert.equal(data.buyerCity, 'Dubai');
  assert.equal(data.buyerCountry, 'UAE');
  assert.equal(data.buyerName, 'Receiver');
  assert.equal(data.buyerPhone, '+971500000000');
  assert.equal(data.buyerAddress, 'Delivery street، 12345');
});

test('shipping receiver supplies contact details while shipping address supplies the location', () => {
  const data = buildInvoiceData(order({ shipping: {
    receiver: { name: 'Recipient', phone: '+96550000000' },
    address: { city: { name: 'Kuwait City', value: 123 }, country: { name: 'Kuwait' }, shipping_address: 'Complete destination address' },
  } }), null);
  assert.equal(data.buyerName, 'Recipient');
  assert.equal(data.buyerPhone, '+96550000000');
  assert.equal(data.buyerCity, 'Kuwait City');
  assert.equal(data.buyerAddress, 'Complete destination address');
});

test('legacy shipping address is preferred over the customer profile', () => {
  const data = buildInvoiceData(order({ shipping_address: { city: 'Dammam', address: 'Delivery address' } }), null);
  assert.equal(data.buyerCity, 'Dammam');
  assert.equal(data.buyerAddress, 'Delivery address');
  assert.equal(data.buyerPhone, '+966500000000');
});

test('already international phone numbers do not receive a duplicated dialing code', () => {
  const data = buildInvoiceData(order({ customer: { mobile: '+966500000000', mobile_code: '+966' } }), null);
  assert.equal(data.buyerPhone, '+966500000000');
});

test('partial shipping destinations do not borrow unrelated profile location fields', () => {
  const data = buildInvoiceData(order({ ship_to: { address_line: 'Destination street' } }), null);
  assert.equal(data.buyerAddress, 'Destination street');
  assert.equal(data.buyerCity, '');
  assert.equal(data.buyerCountry, '');
});

test('official date-only dates retain their date without an invented time', () => {
  const data = buildInvoiceData(order(), { date: '2025-08-17', invoice_number: 'INV-5' });
  assert.equal(data.dateIso, '2025-08-17');
  assert.equal(data.dateLabel, 'Sunday 17 August 2025');
  assert.equal(data.timeLabel, '');
  assert.equal(data.invoiceNumber, 'INV-5');
  assert.equal(data.orderNumber, 'ORDER-10');
});

test('order timestamps are preserved and invalid dates never become today', () => {
  assert.equal(buildInvoiceData(order(), null).timeLabel, '02:30 PM');
  for (const date of ['invalid', '2026-02-31', '2026-15-01']) {
    const data = buildInvoiceData(order(), { date });
    assert.equal(data.dateIso, '');
    assert.equal(data.timeLabel, '');
  }
});

test('official zeros override order amounts and retain a zero tax rate', () => {
  const data = buildInvoiceData(order(), {
    sub_total: 0, shipping_cost: 0, cod_cost: 0, discount: 0, tax: { percent: 0, amount: 0 }, total: 0,
  });
  assert.deepEqual([data.subtotal, data.shipping, data.codFee, data.couponAmount, data.taxPercent, data.taxAmount, data.total], [0, 0, 0, 0, 0, 0, 0]);
});

test('partial official invoices fall back per field to order amounts', () => {
  const data = buildInvoiceData(order(), { invoice_number: 'INV-10' });
  assert.deepEqual([data.subtotal, data.shipping, data.taxAmount, data.total], [100, 20, 15, 135]);
});

test('discounts without coupon metadata still have a visible totals row', () => {
  const data = buildInvoiceData(order(), { discount: { amount: 10 } });
  assert.equal(data.couponAmount, 10);
  assert.equal(data.couponLabel, 'خصم');
});

test('currency comes from authoritative totals even when there are no items', () => {
  assert.equal(buildInvoiceData(order(), { total: { amount: 135, currency: 'AED' } }).currency, 'AED');
  assert.equal(buildInvoiceData(order({ amounts: { total: { amount: 30, currency: 'KWD' } } }), null).currency, 'KWD');
});

test('sales invoice selection rejects refunds and invoices for another order', () => {
  const sales = { type: 'فاتورة ضريبية', order_id: 10, invoice_number: 'INV-10' };
  const refund = { type: 'فاتورة مرتجع مبيعات', order_id: 10 };
  assert.equal(selectCustomerSalesInvoice([refund, { ...sales, order_id: 20 }, sales], 10), sales);
  assert.equal(selectCustomerSalesInvoice([refund, { type: 'Tax Credit Note', order_id: 10 }], 10), null);
});

test('total reconciliation also protects zero-value orders', () => {
  const zeroOrder = order({ amounts: { total: { amount: 0, currency: 'SAR' } } });
  assert.equal(invoiceTotalMatchesOrder(buildInvoiceData(zeroOrder, null), zeroOrder), true);
  assert.equal(invoiceTotalMatchesOrder(buildInvoiceData(order(), null), zeroOrder), false);
  assert.equal(invoiceTotalMatchesOrder(buildInvoiceData(order(), { total: 134 }), order()), false);
});
