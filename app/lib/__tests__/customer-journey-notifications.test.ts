import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildJourneyNotificationData,
  extractJourneyRatingLink,
  extractJourneyShipment,
  isDeliveredJourneyStatus,
  stepForJourneyEvent,
} from '../customer-journey-notifications';
import {
  createSignedCustomerDocumentUrl,
  signCustomerDocument,
  verifyCustomerDocumentSignature,
} from '../customer-document-links';
import { buildInvoiceData } from '../salla-invoice-pdf';

test('maps only trust-relevant Salla milestones', () => {
  assert.equal(stepForJourneyEvent('order.created', 'under_review'), 'order_received');
  assert.equal(stepForJourneyEvent('order.updated', 'in_progress'), null);
  assert.equal(stepForJourneyEvent('shipment.created', ''), 'shipped');
  assert.equal(stepForJourneyEvent('order.updated', 'delivering'), null);
  assert.equal(stepForJourneyEvent('order.updated', 'completed'), null);
  assert.equal(stepForJourneyEvent('order.updated', 'delivered'), 'product_rating');
  assert.equal(stepForJourneyEvent('order.updated', 'تم التوصيل'), 'product_rating');
  assert.equal(stepForJourneyEvent('order.refunded', 'restored'), 'refunded');
  assert.equal(stepForJourneyEvent('order.updated', 'restoring'), null);
});

test('recognizes only Salla delivered statuses as the rating milestone', () => {
  assert.equal(isDeliveredJourneyStatus('delivered'), true);
  assert.equal(isDeliveredJourneyStatus('تم التوصيل'), true);
  assert.equal(isDeliveredJourneyStatus('  تم   التوصيل  '), true);
  assert.equal(isDeliveredJourneyStatus('completed'), false);
  assert.equal(isDeliveredJourneyStatus('تم التنفيذ'), false);
});

test('extracts outbound shipment fields from current nested Salla payloads', () => {
  assert.deepEqual(
    extractJourneyShipment({
      shipping: {
        company: 'SMSA',
        shipment: {
          tracking_number: 'ABC123',
          tracking_link: 'https://tracking.example/ABC123',
          label: { url: 'https://labels.example/ABC123.pdf' },
        },
      },
    }),
    {
      carrier: 'SMSA',
      trackingNumber: 'ABC123',
      trackingLink: 'https://tracking.example/ABC123',
      labelUrl: 'https://labels.example/ABC123.pdf',
    }
  );
});

test('ignores return candidates when an outbound shipment is available', () => {
  const result = extractJourneyShipment({
    shipments: [
      { type: 'return', tracking_number: 'RETURN1' },
      { type: 'shipment', tracking_number: 'OUT1', courier_name: 'AJEX' },
    ],
  });
  assert.equal(result.trackingNumber, 'OUT1');
  assert.equal(result.carrier, 'AJEX');
});

test('uses the current Salla rating URL and builds safe customer data', () => {
  const order = {
    id: 42,
    reference_id: 10042,
    customer: { first_name: 'نورة', mobile: '0500000000', mobile_code: '+966' },
    urls: {
      rating: 'https://store.example/rate/order-token',
      customer: 'https://store.example/order/order-token',
    },
  };
  assert.equal(extractJourneyRatingLink(order), order.urls.rating);
  assert.deepEqual(buildJourneyNotificationData(order), {
    customerName: 'نورة',
    orderNumber: '10042',
    carrier: undefined,
    trackingNumber: undefined,
    trackingLink: undefined,
    ratingLink: order.urls.rating,
    customerOrderLink: order.urls.customer,
    refundAmount: undefined,
    currency: undefined,
  });
});

test('signs expiring document links and rejects tampering or expiry', () => {
  process.env.CUSTOMER_DOCUMENT_SIGNING_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  process.env.CUSTOMER_DOCUMENT_BASE_URL = 'https://app.example';
  const exp = 2_000_000_000;
  const signature = signCustomerDocument('invoice', 'merchant-1', 'order-1', exp);
  assert.equal(
    verifyCustomerDocumentSignature({
      kind: 'invoice',
      merchantId: 'merchant-1',
      orderId: 'order-1',
      expiresAt: exp,
      signature,
      nowSeconds: exp - 1,
    }),
    true
  );
  assert.equal(
    verifyCustomerDocumentSignature({
      kind: 'invoice',
      merchantId: 'merchant-1',
      orderId: 'different-order',
      expiresAt: exp,
      signature,
      nowSeconds: exp - 1,
    }),
    false
  );
  assert.equal(
    verifyCustomerDocumentSignature({
      kind: 'invoice',
      merchantId: 'merchant-1',
      orderId: 'order-1',
      expiresAt: exp,
      signature,
      nowSeconds: exp + 1,
    }),
    false
  );
  const url = new URL(
    createSignedCustomerDocumentUrl({
      kind: 'invoice',
      merchantId: 'merchant-1',
      orderId: 'order-1',
      expiresAt: exp,
    })
  );
  assert.equal(url.pathname, '/api/public/order-documents/invoice/merchant-1/order-1');
  assert.equal(url.searchParams.get('exp'), String(exp));
});

test('local invoice fallback uses complete order amounts', () => {
  const order: any = {
    id: 1,
    reference_id: '1001',
    status: { slug: 'under_review', name: 'تحت المراجعة' },
    date: { created: '2026-08-09 10:00:00', updated: '2026-08-09 10:00:00' },
    customer: { id: 1, first_name: 'سارة', last_name: '', mobile: '0500000000', email: '' },
    amounts: {
      sub_total: { amount: 100, currency: 'SAR' },
      shipping_cost: { amount: 20, currency: 'SAR' },
      cash_on_delivery: { amount: 5, currency: 'SAR' },
      total_discount: { amount: 10, currency: 'SAR' },
      tax: { percent: 15, amount: { amount: 15, currency: 'SAR' } },
      total: { amount: 130, currency: 'SAR' },
    },
    items: [
      {
        id: 1,
        name: 'فستان',
        quantity: 1,
        currency: 'SAR',
        amounts: {
          price_without_tax: { amount: 100, currency: 'SAR' },
          total_discount: { amount: 0, currency: 'SAR' },
          tax: { percent: '15', amount: { amount: 15, currency: 'SAR' } },
          total: { amount: 115, currency: 'SAR' },
        },
      },
    ],
  };
  const invoice = buildInvoiceData(order, null);
  assert.equal(invoice.subtotal, 100);
  assert.equal(invoice.shipping, 20);
  assert.equal(invoice.codFee, 5);
  assert.equal(invoice.couponAmount, 10);
  assert.equal(invoice.taxAmount, 15);
  assert.equal(invoice.total, 130);
});
