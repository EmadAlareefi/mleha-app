import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { Prisma } from '@prisma/client';
import type { NextRequest, NextResponse } from 'next/server';
import { GET as searchOrders, POST as searchOrdersPost } from '@/app/api/integrations/hermes/orders/search/route';
import { GET as getOrder } from '@/app/api/integrations/hermes/orders/[orderReference]/route';
import { GET as searchCustomers } from '@/app/api/integrations/hermes/customers/search/route';
import { GET as customerSummary } from '@/app/api/integrations/hermes/customers/[customerRef]/summary/route';
import { GET as searchShipments } from '@/app/api/integrations/hermes/shipments/search/route';
import { GET as getShipment } from '@/app/api/integrations/hermes/shipments/[shipmentReference]/route';
import { GET as salesReport } from '@/app/api/integrations/hermes/reports/sales/route';
import { GET as operationsReport } from '@/app/api/integrations/hermes/reports/order-operations/route';
import { GET as shipmentReport } from '@/app/api/integrations/hermes/reports/shipment-performance/route';
import { GET as customerReport } from '@/app/api/integrations/hermes/reports/customers/route';
import { GET as productReport } from '@/app/api/integrations/hermes/reports/products/route';
import { GET as trendReport } from '@/app/api/integrations/hermes/reports/daily-trend/route';
import { signActor } from '../actor';
import { clearReportCache } from '../cache';
import { setHermesStore } from '../handler';
import { customerRef } from '../identifiers';
import { HERMES_SCOPES } from '../scopes';
import {
  addCredential,
  createMemoryStore,
  emptyDb,
  makeOrder,
  MERCHANT_A,
  MERCHANT_B,
  request,
  routeParams,
  SENTINELS,
  TEST_PEPPER,
  type CallLog,
  type FixtureDb,
} from './fixtures';

process.env.HERMES_API_KEY_PEPPER = TEST_PEPPER;
process.env.HERMES_API_ENABLED = 'true';

const SUPPORT = [HERMES_SCOPES.SUPPORT_READ];
const MANAGER = [HERMES_SCOPES.SUPPORT_READ, HERMES_SCOPES.MANAGER_REPORTS, HERMES_SCOPES.MANAGER_PII];
const REPORTS_ONLY = [HERMES_SCOPES.MANAGER_REPORTS];

type Handler = (req: NextRequest, ctx?: { params?: Promise<Record<string, string>> }) => Promise<NextResponse>;

let db: FixtureDb;
let calls: CallLog;

beforeEach(() => {
  db = emptyDb();
  calls = {};
  setHermesStore(createMemoryStore(db, calls));
  clearReportCache();
  delete process.env.HERMES_RATE_LIMIT_PER_MINUTE;
  delete process.env.HERMES_LOOKUP_MISS_BUDGET;
  delete process.env.HERMES_GATEWAY_SIGNING_SECRET;
});

async function call(handler: Handler, path: string, options: Parameters<typeof request>[1] = {}, params?: Record<string, string>) {
  const response = await handler(request(path, options), params ? routeParams(params) : undefined);
  const body = await response.json();
  return { status: response.status, body, headers: response.headers, text: JSON.stringify(body) };
}

const REPORT_QUERY = '?from=2026-10-01&to=2026-10-31';
const REPORT_HANDLERS: [string, Handler][] = [
  ['sales', salesReport],
  ['order-operations', operationsReport],
  ['shipment-performance', shipmentReport],
  ['customers', customerReport],
  ['products', productReport],
  ['daily-trend', trendReport],
];

describe('authentication', () => {
  test('requests without a credential are rejected and audited', async () => {
    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthenticated');
    assert.equal(res.body.data, null);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer realm="hermes"');
    assert.equal(db.audits.length, 1);
    assert.equal(db.audits[0].outcome, 'unauthenticated');
    assert.equal(db.audits[0].credentialId, null);
  });

  test('malformed keys, unknown key ids and wrong secrets all get the same 401', async () => {
    const { apiKey } = addCredential(db, SUPPORT);
    const wrongSecret = apiKey.slice(0, -4) + (apiKey.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const unknownId = apiKey.replace(/^hrm_[a-z0-9]{16}/, 'hrm_zzzzzzzzzzzzzzzz');
    for (const key of ['not-a-key', wrongSecret, unknownId]) {
      const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1', { apiKey: key });
      assert.equal(res.status, 401);
      assert.equal(res.body.error.message, 'Missing or invalid credentials.');
    }
  });

  test('revoked credentials are denied', async () => {
    const { apiKey, credential } = addCredential(db, SUPPORT, { revokedAt: new Date('2026-01-01') });
    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1', { apiKey });
    assert.equal(res.status, 401);
    assert.equal(db.audits[0].credentialId, credential.id);
    assert.equal(db.audits[0].outcome, 'unauthenticated');
  });

  test('expired credentials are denied', async () => {
    const { apiKey } = addCredential(db, SUPPORT, { expiresAt: new Date(Date.now() - 1000) });
    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1', { apiKey });
    assert.equal(res.status, 401);
  });

  test('keys in the query string are refused rather than accepted', async () => {
    const { apiKey } = addCredential(db, SUPPORT);
    const res = await call(searchOrders, `/api/integrations/hermes/orders/search?order_number=1&api_key=${apiKey}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details.reason, 'credentials_must_use_authorization_header');
  });

  test('the kill switch disables the API without touching the database', async () => {
    process.env.HERMES_API_ENABLED = 'false';
    try {
      const { apiKey } = addCredential(db, SUPPORT);
      const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1', { apiKey });
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'temporarily_unavailable');
      assert.equal(calls.findCredentialByKeyId ?? 0, 0);
    } finally {
      process.env.HERMES_API_ENABLED = 'true';
    }
  });

  test('plain HTTP is refused in production', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const { apiKey } = addCredential(db, SUPPORT);
      const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1', { apiKey, proto: 'http' });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'https_required');
    } finally {
      env.NODE_ENV = previous;
    }
  });
});

describe('authorization', () => {
  test('a support credential is denied every manager report with 403', async () => {
    const { apiKey } = addCredential(db, SUPPORT);
    for (const [name, handler] of REPORT_HANDLERS) {
      const res = await call(handler, `/api/integrations/hermes/reports/${name}${REPORT_QUERY}`, { apiKey });
      assert.equal(res.status, 403, name);
      assert.equal(res.body.error.code, 'forbidden');
      assert.equal(res.body.error.details.required_scope, HERMES_SCOPES.MANAGER_REPORTS);
    }
    assert.equal(calls.loadReportOrders ?? 0, 0);
    assert.ok(db.audits.every((row) => row.outcome === 'denied'));
  });

  test('scopes do not imply each other: a reports-only credential cannot do support lookups', async () => {
    const { apiKey } = addCredential(db, REPORTS_ONLY);
    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1', { apiKey });
    assert.equal(res.status, 403);
  });

  test('role claims in the request cannot raise privileges', async () => {
    const { apiKey } = addCredential(db, SUPPORT);
    const res = await call(salesReport, `/api/integrations/hermes/reports/sales${REPORT_QUERY}&role=manager`, {
      apiKey,
      headers: { 'x-hermes-role': 'manager', 'x-hermes-actor-id': 'mgr-1', 'x-hermes-actor-channel': 'whatsapp' },
    });
    assert.equal(res.status, 403);
  });
});

describe('support lookups', () => {
  test('finds an order by order number with a compact, masked summary', async () => {
    const order = makeOrder({ referenceId: '71234567', orderNumber: '71234567' });
    db.orders.push(order);
    const { apiKey } = addCredential(db, SUPPORT);
    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=٧١٢٣٤٥٦٧', { apiKey });
    assert.equal(res.status, 200);
    assert.equal(res.body.error, null);
    assert.equal(res.body.data.items.length, 1);
    const item = res.body.data.items[0];
    assert.equal(item.order_reference, '71234567');
    assert.equal(item.status.code, 'delivered');
    assert.equal(item.status.label_ar, 'تم التوصيل');
    assert.equal(item.total.amount, '115.00');
    assert.equal(item.customer.phone, '+966*******01');
    assert.match(res.body.meta.request_id, /^[0-9a-f-]{36}$/);
    assert.equal(res.headers.get('cache-control'), 'private, no-store, max-age=0');
  });

  test('phone search matches every stored spelling but rejects other countries\' numbers', async () => {
    const e164 = makeOrder({ customerMobile: '+966500000001' });
    const localSaudi = makeOrder({ customerMobile: '500000001', raw: { mobile: 500000001, mobileCode: '+966' } });
    // Same local digits, but this customer is in the UAE: must not match a Saudi search.
    const uae = makeOrder({ customerMobile: '500000001', raw: { mobile: 500000001, mobileCode: '+971' } });
    const other = makeOrder({ customerMobile: '+966500000002' });
    db.orders.push(e164, localSaudi, uae, other);
    const { apiKey } = addCredential(db, SUPPORT);

    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?phone=0500000001', { apiKey });
    assert.equal(res.status, 200);
    const refs = res.body.data.items.map((item: { order_reference: string }) => item.order_reference).sort();
    assert.deepEqual(refs, [e164.referenceId, localSaudi.referenceId].sort());
  });

  test('phone search does not accept partial numbers', async () => {
    db.orders.push(makeOrder());
    const { apiKey } = addCredential(db, SUPPORT);
    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?phone=50000', { apiKey });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details.reason, 'invalid_phone');
  });

  test('email search is case-insensitive and immune to LIKE wildcards', async () => {
    const mixed = makeOrder({ customerEmail: 'Real.User@Example.test' });
    const wildcardVictim = makeOrder({ customerEmail: 'axb@example.test' });
    db.orders.push(mixed, wildcardVictim);
    const { apiKey } = addCredential(db, SUPPORT);

    const found = await call(searchOrders, '/api/integrations/hermes/orders/search?email=real.user@example.test', { apiKey });
    assert.equal(found.body.data.items.length, 1);
    assert.equal(found.body.data.items[0].order_reference, mixed.referenceId);

    // `_` is a LIKE wildcard; the store's ILIKE fallback would match "axb".
    const wildcard = await call(searchOrders, '/api/integrations/hermes/orders/search?email=a_b@example.test', { apiKey });
    assert.equal(wildcard.body.data.items.length, 0);
  });

  test('POST search keeps identifiers out of the URL', async () => {
    db.orders.push(makeOrder({ customerMobile: '+966500000001' }));
    const { apiKey } = addCredential(db, SUPPORT);
    const res = await call(searchOrdersPost, '/api/integrations/hermes/orders/search', { apiKey, method: 'POST', body: { phone: '+966500000001' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 1);
  });

  test('finds orders by tracking number from any shipment source', async () => {
    const order = makeOrder();
    db.orders.push(order);
    db.sallaShipments.push({
      merchantId: MERCHANT_A, orderId: order.orderId, orderNumber: order.orderNumber!, trackingNumber: 'AJX123456',
      courierName: 'إيجكس', courierCode: 'ajex', status: 'delivered', trackingLink: null, createdAt: new Date('2026-10-05T12:00:00Z'), updatedAt: new Date('2026-10-06T12:00:00Z'),
    });
    const { apiKey } = addCredential(db, SUPPORT);
    const res = await call(searchOrders, '/api/integrations/hermes/orders/search?tracking_number=ajx123456', { apiKey });
    assert.equal(res.body.data.items.length, 1);
  });

  test('order details expose allow-listed fields only', async () => {
    const order = makeOrder({
      referenceId: '72000001',
      raw: {
        discounts: ['10.00'],
        refundedItems: [25],
        items: [{ id: 11, notes: 'مقاس 54', options: [{ name: 'المقاس', value: { name: '54' } }] }],
        shipments: [{ tracking_number: 'SMSA1', courier_name: 'سمسا', status: 'delivered', tracking_link: 'https://track.example/SMSA1' }, { tracking_number: 'SMSA2', courier_name: 'سمسا', status: 'shipped' }],
      },
    });
    db.orders.push(order);
    db.items.push({ merchantId: MERCHANT_A, orderId: order.orderId, itemId: '11', productId: 'p1', sku: 'SKU-54', name: 'عباية تجريبية', quantity: 2, priceAmount: new Prisma.Decimal('57.5'), totalAmount: new Prisma.Decimal('115'), currency: 'SAR' });
    db.returns.push({
      merchantId: MERCHANT_A, id: 'ret1', orderId: order.orderId, orderNumber: order.orderNumber, type: 'return', status: 'pending_review', reason: 'size',
      totalRefundAmount: new Prisma.Decimal('57.5'), currency: 'SAR', couponIssued: false, returnTrackingNumber: null, exchangeOrderNumber: null,
      createdAt: new Date('2026-10-08T10:00:00Z'), updatedAt: new Date('2026-10-08T10:00:00Z'),
      items: [{ productId: 'p1', productName: 'عباية تجريبية', productSku: 'SKU-54', variantName: '54', quantity: 1, price: new Prisma.Decimal('57.5') }],
    });
    db.events.push(
      { orderId: order.orderId, status: 'under_review', receivedAt: new Date('2026-10-05T10:00:00Z') },
      { orderId: order.orderId, status: 'under_review', receivedAt: new Date('2026-10-05T10:01:00Z') },
      { orderId: order.orderId, status: 'delivered', receivedAt: new Date('2026-10-07T10:00:00Z') },
    );
    db.flags.push({ merchantId: MERCHANT_A, orderId: order.orderId, kind: 'highPriority' });
    const { apiKey } = addCredential(db, SUPPORT);

    const res = await call(getOrder, '/api/integrations/hermes/orders/72000001', { apiKey }, { orderReference: '72000001' });
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.amounts.discount_total, '10.00');
    assert.equal(data.amounts.discounts[0].code, 'CODE0');
    assert.equal(data.items[0].unit_price, '57.50');
    assert.deepEqual(data.items[0].options, [{ name: 'المقاس', value: '54' }]);
    assert.equal(data.items[0].customer_note, 'مقاس 54');
    assert.equal(data.shipments.length, 2, 'multiple shipments are listed');
    assert.equal(data.shipments[0].tracking_url, 'https://track.example/SMSA1');
    assert.equal(data.refunds.partially_refunded_items, 1);
    assert.equal(data.refunds.partially_refunded_amount, '25.00');
    assert.deepEqual(data.timeline.map((entry: { salla_status: string }) => entry.salla_status), ['under_review', 'delivered']);
    assert.equal(data.returns[0].status_label_ar, 'قيد المراجعة');
    assert.equal(data.flags.high_priority, true);
    assert.equal(data.customer.email, 'cu***@example.test');
    assert.equal(data.shipping_address.city, 'الرياض');
    assert.equal(data.shipping_address.address_line, undefined, 'street address is PII-scope only');
    assert.equal(data.shipping_address.receiver_phone, '+966*******09');

    for (const sentinel of Object.values(SENTINELS)) {
      assert.ok(!res.text.includes(sentinel), `response leaked ${sentinel}`);
    }
    for (const forbidden of ['rawOrder', 'secretHash', 'password', 'cost_price', 'payment_methods', 'transaction_reference', 'adminNotes']) {
      assert.ok(!res.text.includes(forbidden), `response leaked ${forbidden}`);
    }
  });

  test('manager PII scope unmasks contact details and the full address', async () => {
    const order = makeOrder({ referenceId: '72000002' });
    db.orders.push(order);
    const { apiKey } = addCredential(db, MANAGER);
    const res = await call(getOrder, '/api/integrations/hermes/orders/72000002', { apiKey }, { orderReference: '72000002' });
    assert.equal(res.body.data.customer.phone, '+966500000001');
    assert.equal(res.body.data.customer.email, 'customer@example.test');
    assert.equal(res.body.data.shipping_address.address_line, 'شارع تجريبي 1');
    assert.equal(db.audits.at(-1)!.classification, 'pii:full');
  });

  test('unknown orders return 404 and count as a miss', async () => {
    const { apiKey } = addCredential(db, SUPPORT);
    const res = await call(getOrder, '/api/integrations/hermes/orders/123', { apiKey }, { orderReference: '123' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
    assert.equal(db.audits[0].outcome, 'not_found');
  });

  test('customer search and summary work end to end through the opaque reference', async () => {
    const older = makeOrder({ customerId: '8801', statusSlug: 'delivered', placedAt: new Date('2026-08-01T10:00:00Z') });
    const active = makeOrder({ customerId: '8801', statusSlug: 'shipped', trackingNumber: 'SM777', placedAt: new Date('2026-10-10T10:00:00Z') });
    db.orders.push(older, active);
    db.returns.push({
      merchantId: MERCHANT_A, id: 'r9', orderId: older.orderId, orderNumber: older.orderNumber, type: 'exchange', status: 'completed', reason: 'size',
      totalRefundAmount: null, currency: 'SAR', couponIssued: true, returnTrackingNumber: null, exchangeOrderNumber: null,
      createdAt: new Date('2026-08-05T10:00:00Z'), updatedAt: new Date('2026-08-06T10:00:00Z'), items: [],
    });
    const { apiKey } = addCredential(db, SUPPORT);

    const search = await call(searchCustomers, '/api/integrations/hermes/customers/search?customer_id=8801', { apiKey });
    assert.equal(search.status, 200);
    assert.equal(search.body.data.items.length, 1);
    const ref = search.body.data.items[0].customer_ref;
    assert.match(ref, /^cus_8801_/);

    const summary = await call(customerSummary, `/api/integrations/hermes/customers/${ref}/summary`, { apiKey }, { customerRef: ref });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.order_count, 2);
    assert.equal(summary.body.data.active_orders.length, 1);
    assert.equal(summary.body.data.active_shipments[0].tracking_number, 'SM777');
    assert.equal(summary.body.data.returns.total, 1);
    assert.equal(summary.body.data.first_order_at, '2026-08-01T10:00:00.000Z');
  });

  test('shipment lookups handle carrier tracking and orders with no tracking at all', async () => {
    const tracked = makeOrder({ referenceId: '73000001', fulfillmentCompany: 'إيجكس', statusSlug: 'shipped' });
    const untracked = makeOrder({ referenceId: '73000002', statusSlug: 'in_progress' });
    db.orders.push(tracked, untracked);
    db.sallaShipments.push({
      merchantId: MERCHANT_A, orderId: tracked.orderId, orderNumber: tracked.orderNumber!, trackingNumber: 'AJ900',
      courierName: 'إيجكس', courierCode: 'ajex', status: 'shipped', trackingLink: null, createdAt: new Date('2026-10-05T12:00:00Z'), updatedAt: new Date('2026-10-05T12:00:00Z'),
    });
    db.scans.push({
      trackingNumber: 'AJ900', company: 'ajex', scannedAt: new Date('2026-10-06T08:00:00Z'), handoverScannedAt: null,
      smsaLiveStatus: null, smsaLiveStatusUpdatedAt: null,
      ajexLiveStatus: { code: '606', failureReason: 'العميل لا يرد', city: 'جدة', timestamp: '2026-10-08T09:00:00Z' },
      ajexLiveStatusUpdatedAt: new Date('2026-10-08T09:00:05Z'), ajexLiveStatusEventAt: new Date('2026-10-08T09:00:00Z'),
    });
    const { apiKey } = addCredential(db, SUPPORT);

    const shipment = await call(getShipment, '/api/integrations/hermes/shipments/AJ900', { apiKey }, { shipmentReference: 'AJ900' });
    assert.equal(shipment.status, 200);
    assert.equal(shipment.body.data.carrier.code, 'ajex');
    assert.equal(shipment.body.data.status.code, 'exception');
    assert.equal(shipment.body.data.exception_reason, 'العميل لا يرد');
    assert.equal(shipment.body.data.carrier_status.text, 'تعذر التسليم');
    assert.equal(shipment.body.data.tracking_url, 'https://aj-ex.com/ar/shipment-status/AJ900');
    assert.ok(shipment.body.data.events.some((event: { code: string }) => event.code === 'warehouse_dispatch'));

    const none = await call(searchShipments, '/api/integrations/hermes/shipments/search?order_number=73000002', { apiKey });
    assert.equal(none.status, 200);
    assert.deepEqual(none.body.data.items, []);
  });
});

describe('enumeration, IDOR and tenant isolation', () => {
  test('the miss budget stops guessing with 429', async () => {
    process.env.HERMES_LOOKUP_MISS_BUDGET = '3';
    const { apiKey } = addCredential(db, SUPPORT);
    for (let i = 0; i < 3; i += 1) {
      const res = await call(getOrder, `/api/integrations/hermes/orders/${100 + i}`, { apiKey }, { orderReference: `${100 + i}` });
      assert.equal(res.status, 404);
    }
    const blocked = await call(getOrder, '/api/integrations/hermes/orders/200', { apiKey }, { orderReference: '200' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '600');
  });

  test('searches need exactly one identifier', async () => {
    const { apiKey } = addCredential(db, SUPPORT);
    const none = await call(searchOrders, '/api/integrations/hermes/orders/search', { apiKey });
    assert.equal(none.status, 400);
    assert.equal(none.body.error.details.reason, 'one_criterion_required');
    const two = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1&phone=0500000001', { apiKey });
    assert.equal(two.body.error.details.reason, 'exactly_one_criterion_allowed');
  });

  test('forged or incremented customer references are answered as not found', async () => {
    db.orders.push(makeOrder({ customerId: '9001' }), makeOrder({ customerId: '9002' }));
    const { apiKey } = addCredential(db, SUPPORT);
    const valid = customerRef(MERCHANT_A, '9001', TEST_PEPPER)!;
    const forged = valid.replace('cus_9001_', 'cus_9002_');
    const res = await call(customerSummary, `/api/integrations/hermes/customers/${forged}/summary`, { apiKey }, { customerRef: forged });
    assert.equal(res.status, 404);
  });

  test('a credential cannot read another merchant\'s orders, customers or reports', async () => {
    const foreign = makeOrder({ merchantId: MERCHANT_B, referenceId: '74000001', customerId: '7001' });
    db.orders.push(foreign);
    const { apiKey } = addCredential(db, MANAGER, { merchantId: MERCHANT_A });

    const order = await call(getOrder, '/api/integrations/hermes/orders/74000001', { apiKey }, { orderReference: '74000001' });
    assert.equal(order.status, 404);
    const foreignRef = customerRef(MERCHANT_B, '7001', TEST_PEPPER)!;
    const summary = await call(customerSummary, `/api/integrations/hermes/customers/${foreignRef}/summary`, { apiKey }, { customerRef: foreignRef });
    assert.equal(summary.status, 404);
    const sales = await call(salesReport, `/api/integrations/hermes/reports/sales${REPORT_QUERY}`, { apiKey });
    assert.equal(sales.body.data.metrics.order_count.value, 0);
  });
});

describe('validation and pagination', () => {
  test('unknown, repeated and oversized parameters are rejected', async () => {
    const { apiKey } = addCredential(db, SUPPORT);
    const unknown = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1&name=x', { apiKey });
    assert.equal(unknown.body.error.details.reason, 'unsupported_parameter');
    const repeated = await call(searchOrders, '/api/integrations/hermes/orders/search?order_number=1&order_number=2', { apiKey });
    assert.equal(repeated.body.error.details.reason, 'repeated_parameter');
    const long = await call(searchOrders, `/api/integrations/hermes/orders/search?order_number=${'1'.repeat(300)}`, { apiKey });
    assert.equal(long.body.error.details.reason, 'too_long');
  });

  test('pagination returns metadata and enforces the maximum page size', async () => {
    for (let i = 0; i < 12; i += 1) db.orders.push(makeOrder({ customerMobile: '+966500000005', placedAt: new Date(Date.UTC(2026, 9, 1 + i)) }));
    const { apiKey } = addCredential(db, SUPPORT);
    const page2 = await call(searchOrders, '/api/integrations/hermes/orders/search?phone=%2B966500000005&page=2&page_size=5', { apiKey });
    assert.equal(page2.body.data.items.length, 5);
    assert.deepEqual(page2.body.meta.pagination, { page: 2, page_size: 5, total_items: 12, total_pages: 3, has_more: true });
    const tooBig = await call(searchOrders, '/api/integrations/hermes/orders/search?phone=%2B966500000005&page_size=51', { apiKey });
    assert.equal(tooBig.status, 400);
    assert.equal(tooBig.body.error.details.reason, 'must_be_at_most_50');
  });

  test('report date ranges are bounded and validated', async () => {
    const { apiKey } = addCredential(db, MANAGER);
    const long = await call(salesReport, '/api/integrations/hermes/reports/sales?from=2026-01-01&to=2026-06-30', { apiKey });
    assert.equal(long.status, 400);
    assert.equal(long.body.error.details.reason, 'range_exceeds_92_days');
    const reversed = await call(salesReport, '/api/integrations/hermes/reports/sales?from=2026-10-10&to=2026-10-01', { apiKey });
    assert.equal(reversed.body.error.details.reason, 'must_not_be_after_to');
    const badTz = await call(salesReport, `/api/integrations/hermes/reports/sales${REPORT_QUERY}&timezone=Mars/Base`, { apiKey });
    assert.equal(badTz.body.error.details.reason, 'invalid_iana_timezone');
    const badStatus = await call(salesReport, `/api/integrations/hermes/reports/sales${REPORT_QUERY}&status=hacked`, { apiKey });
    assert.equal(badStatus.body.error.details.reason, 'unsupported_filter_value');
  });
});

describe('reports', () => {
  test('sales summary: Decimal totals, currency conversion, refunds and comparison', async () => {
    // Current period: two SAR orders, one KWD order, one cancelled, one partial refund.
    db.orders.push(
      makeOrder({ subtotalAmount: new Prisma.Decimal('100.10'), taxAmount: new Prisma.Decimal('15.02'), shippingAmount: new Prisma.Decimal('0.10'), totalAmount: new Prisma.Decimal('105.22'), raw: { discounts: ['10.00'] } }),
      makeOrder({ subtotalAmount: new Prisma.Decimal('0.10'), taxAmount: new Prisma.Decimal('0.20'), shippingAmount: new Prisma.Decimal('0'), totalAmount: new Prisma.Decimal('0.30'), raw: { refundedItems: [0.1] } }),
      makeOrder({ currency: 'KWD', subtotalAmount: new Prisma.Decimal('10'), taxAmount: new Prisma.Decimal('0'), shippingAmount: new Prisma.Decimal('0'), totalAmount: new Prisma.Decimal('10'), raw: { currency: 'KWD', exchangeRate: { rate: '12.25', base_currency: 'SAR', exchange_currency: 'KWD' } } }),
      makeOrder({ statusSlug: 'canceled', totalAmount: new Prisma.Decimal('999') }),
    );
    const restored = makeOrder({ statusSlug: 'restored', placedAt: new Date('2026-09-20T10:00:00Z'), totalAmount: new Prisma.Decimal('50') });
    db.orders.push(restored);
    db.events.push({ orderId: restored.orderId, status: 'restored', receivedAt: new Date('2026-10-03T10:00:00Z') });
    // Previous period (2026-08-31 .. 2026-09-30): the restored order plus one more.
    db.orders.push(makeOrder({ placedAt: new Date('2026-09-10T10:00:00Z'), totalAmount: new Prisma.Decimal('100') }));

    const { apiKey } = addCredential(db, MANAGER);
    const res = await call(salesReport, `/api/integrations/hermes/reports/sales${REPORT_QUERY}&compare=previous_period`, { apiKey });
    assert.equal(res.status, 200);
    const m = res.body.data.metrics;
    assert.equal(m.order_count.value, 3);
    assert.equal(m.gross_sales.value, '222.70'); // 100.10 + 0.10 + 10 × 12.25
    assert.equal(m.total_sales.value, '228.02'); // 105.22 + 0.30 + 122.50 — exact, no float drift
    assert.equal(m.discounts.value, '10.00');
    assert.equal(m.tax.value, '15.22');
    assert.equal(m.full_refunds.value, '50.00');
    assert.equal(m.partial_refunds.value, '0.10');
    assert.equal(m.net_sales.value, '177.92'); // 228.02 − (50 full + 0.10 partial)
    assert.equal(m.average_order_value.value, '76.01');
    assert.equal(m.cancelled_orders.value, 1);
    assert.equal(m.order_count.comparison.previous, 2);
    assert.equal(m.total_sales.comparison.previous, '150.00');
    assert.equal(m.total_sales.comparison.percent_change, '52.01');

    const meta = res.body.meta;
    assert.equal(meta.currency, 'SAR');
    assert.equal(meta.timezone, 'Asia/Riyadh');
    assert.equal(meta.applied_range.utc_start, '2026-09-30T21:00:00.000Z');
    assert.equal(meta.applied_range.utc_end_exclusive, '2026-10-31T21:00:00.000Z');
    assert.equal(meta.comparison_range.from, '2026-08-31');
    assert.ok(meta.definitions.net_sales);
    assert.ok(meta.data_freshness.computed_at);
    assert.deepEqual(meta.applied_filters, { status: [], payment_method: [], city: [], carrier: [], source: [] });
  });

  test('timezone boundaries decide which day an order belongs to', async () => {
    db.orders.push(
      makeOrder({ placedAt: new Date('2026-10-01T20:59:59Z'), totalAmount: new Prisma.Decimal('1') }), // 23:59:59 Oct 1 in Riyadh
      makeOrder({ placedAt: new Date('2026-10-01T21:00:00Z'), totalAmount: new Prisma.Decimal('2') }), // 00:00 Oct 2 in Riyadh
      makeOrder({ placedAt: new Date('2026-09-30T20:59:59Z'), totalAmount: new Prisma.Decimal('4') }), // Sep 30 in Riyadh — outside
    );
    const { apiKey } = addCredential(db, MANAGER);
    const res = await call(trendReport, '/api/integrations/hermes/reports/daily-trend?from=2026-10-01&to=2026-10-02', { apiKey });
    assert.deepEqual(
      res.body.data.series.map((day: { date: string; orders: number; revenue: string }) => [day.date, day.orders, day.revenue]),
      [['2026-10-01', 1, '1.00'], ['2026-10-02', 1, '2.00']]
    );
    const utc = await call(trendReport, '/api/integrations/hermes/reports/daily-trend?from=2026-10-01&to=2026-10-02&timezone=UTC', { apiKey });
    assert.deepEqual(utc.body.data.series.map((day: { orders: number }) => day.orders), [2, 0]);
  });

  test('empty datasets produce zeros, not errors', async () => {
    const { apiKey } = addCredential(db, MANAGER);
    for (const [name, handler] of REPORT_HANDLERS) {
      const res = await call(handler, `/api/integrations/hermes/reports/${name}${REPORT_QUERY}&compare=previous_year`, { apiKey });
      assert.equal(res.status, 200, name);
      assert.equal(res.body.error, null);
    }
    const sales = await call(salesReport, `/api/integrations/hermes/reports/sales${REPORT_QUERY}`, { apiKey });
    assert.equal(sales.body.data.metrics.average_order_value.value, '0.00');
  });

  test('order operations: statuses, payment/fulfillment split, aging and pending work', async () => {
    const now = Date.now();
    db.orders.push(
      makeOrder({ statusSlug: 'under_review', placedAt: new Date(now - 2 * 3_600_000) }),
      makeOrder({ statusSlug: 'in_progress', placedAt: new Date(now - 100 * 3_600_000) }),
      makeOrder({ statusSlug: 'payment_pending', placedAt: new Date(now - 3_600_000), raw: { isPendingPayment: true } }),
      makeOrder({ statusSlug: 'delivered', paymentMethod: 'cod', placedAt: new Date(now - 3_600_000) }),
      makeOrder({ statusSlug: 'shipped', paymentMethod: 'cod', placedAt: new Date(now - 3_600_000) }),
    );
    const { apiKey } = addCredential(db, MANAGER);
    const today = new Date(now).toISOString().slice(0, 10);
    const from = new Date(now - 10 * 86_400_000).toISOString().slice(0, 10);
    const res = await call(operationsReport, `/api/integrations/hermes/reports/order-operations?from=${from}&to=${today}&timezone=UTC`, { apiKey });
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.orders_total.value, 5);
    assert.equal(data.payment.unpaid, 2); // awaiting payment + COD not yet delivered
    assert.equal(data.fulfillment.fulfilled, 2);
    assert.equal(data.awaiting_action.new_orders, 1);
    assert.equal(data.awaiting_action.awaiting_payment, 1);
    assert.equal(data.aging_open_orders.buckets.under_24h, 1);
    assert.equal(data.aging_open_orders.buckets.from_3_to_7_days, 1);
    assert.equal(data.aging_open_orders.oldest_first.items[0].age_hours >= 99, true);
    assert.equal(data.aging_open_orders.oldest_first.items[0].customer, undefined, 'no customer data in operations lists');
  });

  test('shipment performance: carrier tracking, delays, exceptions and success rate', async () => {
    const delivered = makeOrder({ fulfillmentCompany: 'سمسا', placedAt: new Date('2026-10-02T08:00:00Z') });
    const returned = makeOrder({ fulfillmentCompany: 'سمسا', placedAt: new Date('2026-10-02T08:00:00Z'), statusSlug: 'restored' });
    const stuck = makeOrder({ fulfillmentCompany: 'إيجكس', placedAt: new Date('2026-10-02T08:00:00Z'), statusSlug: 'shipped' });
    db.orders.push(delivered, returned, stuck);
    const label = (order: typeof delivered, tracking: string, courier: string) =>
      db.sallaShipments.push({ merchantId: MERCHANT_A, orderId: order.orderId, orderNumber: order.orderNumber!, trackingNumber: tracking, courierName: courier, courierCode: courier, status: order.statusSlug!, trackingLink: null, createdAt: new Date('2026-10-02T12:00:00Z'), updatedAt: new Date('2026-10-02T12:00:00Z') });
    label(delivered, 'S1', 'سمسا');
    label(returned, 'S2', 'سمسا');
    label(stuck, 'A1', 'إيجكس');
    const scan = (tracking: string, live: Partial<{ smsa: object; ajex: object }>) =>
      db.scans.push({ trackingNumber: tracking, company: live.ajex ? 'ajex' : 'smsa', scannedAt: new Date('2026-10-03T08:00:00Z'), handoverScannedAt: null, smsaLiveStatus: live.smsa ?? null, smsaLiveStatusUpdatedAt: null, ajexLiveStatus: live.ajex ?? null, ajexLiveStatusUpdatedAt: null, ajexLiveStatusEventAt: null });
    scan('S1', { smsa: { code: 'DL', delivered: true, timestamp: '2026-10-05T08:00:00Z' } });
    scan('S2', { smsa: { code: 'RT', description: 'Return to shipper' } });
    scan('A1', { ajex: { code: '300' } });

    const { apiKey } = addCredential(db, MANAGER);
    const res = await call(shipmentReport, `/api/integrations/hermes/reports/shipment-performance${REPORT_QUERY}`, { apiKey });
    const data = res.body.data;
    assert.equal(data.shipments_total.value, 3);
    assert.deepEqual(data.delivery_success_rate, { percent: '50.00', delivered: 1, returned_to_sender: 1, sample_size: 2 });
    assert.equal(data.average_hours_order_to_dispatch.hours, '24.0');
    assert.equal(data.average_hours_dispatch_to_delivery.hours, '48.0');
    assert.equal(data.average_hours_dispatch_to_delivery.sample_size, 1);
    assert.equal(data.delayed_shipments.total, 1);
    assert.equal(data.delayed_shipments.items[0].tracking_number, 'A1');
    assert.equal(data.carrier_performance.find((row: { carrier: string }) => row.carrier === 'smsa').shipments, 2);
  });

  test('customer analytics: new vs returning and PII-gated top customers', async () => {
    db.orders.push(
      makeOrder({ customerId: 'c-old', placedAt: new Date('2026-06-01T10:00:00Z') }),
      makeOrder({ customerId: 'c-old', placedAt: new Date('2026-10-05T10:00:00Z') }),
      makeOrder({ customerId: 'c-new', placedAt: new Date('2026-10-06T10:00:00Z') }),
      makeOrder({ customerId: 'c-new', placedAt: new Date('2026-10-07T10:00:00Z') }),
    );
    const withPii = addCredential(db, MANAGER).apiKey;
    const withoutPii = addCredential(db, REPORTS_ONLY).apiKey;

    const full = await call(customerReport, `/api/integrations/hermes/reports/customers${REPORT_QUERY}`, { apiKey: withPii });
    assert.equal(full.body.data.customers_total.value, 2);
    assert.equal(full.body.data.new_customers.value, 1);
    assert.equal(full.body.data.returning_customers.value, 1);
    assert.equal(full.body.data.repeat_purchase_rate.percent, '50.00');
    assert.equal(full.body.data.top_customers.items.length, 2);
    assert.equal(full.body.data.customer_lifetime_value.available, false);

    const masked = await call(customerReport, `/api/integrations/hermes/reports/customers${REPORT_QUERY}`, { apiKey: withoutPii });
    assert.equal(masked.body.data.top_customers.items, null);
    assert.ok(!masked.text.includes('عميل تجريبي'), 'no customer names without the PII scope');
  });

  test('product performance: units, revenue, variants and returns', async () => {
    const a = makeOrder();
    const b = makeOrder();
    db.orders.push(a, b);
    db.items.push(
      { merchantId: MERCHANT_A, orderId: a.orderId, itemId: '1', productId: 'P1', sku: 'P1-52', name: 'عباية', quantity: 2, priceAmount: null, totalAmount: new Prisma.Decimal('200'), currency: 'SAR' },
      { merchantId: MERCHANT_A, orderId: b.orderId, itemId: '2', productId: 'P1', sku: 'P1-54', name: 'عباية', quantity: 1, priceAmount: null, totalAmount: new Prisma.Decimal('100'), currency: 'SAR' },
      { merchantId: MERCHANT_A, orderId: b.orderId, itemId: '3', productId: 'P2', sku: 'P2', name: 'طرحة', quantity: 1, priceAmount: null, totalAmount: new Prisma.Decimal('30'), currency: 'SAR' },
    );
    db.returns.push({
      merchantId: MERCHANT_A, id: 'rr', orderId: a.orderId, orderNumber: a.orderNumber, type: 'return', status: 'completed', reason: 'size', totalRefundAmount: null,
      currency: 'SAR', couponIssued: false, returnTrackingNumber: null, exchangeOrderNumber: null, createdAt: new Date('2026-10-09T10:00:00Z'), updatedAt: new Date('2026-10-09T10:00:00Z'),
      items: [{ productId: 'P1', productName: 'عباية', productSku: 'P1-52', variantName: '52', quantity: 1, price: new Prisma.Decimal('100') }],
    });
    const { apiKey } = addCredential(db, MANAGER);
    const res = await call(productReport, `/api/integrations/hermes/reports/products${REPORT_QUERY}&page_size=1`, { apiKey });
    const data = res.body.data;
    assert.equal(data.units_sold, 4);
    assert.equal(data.best_sellers_by_units.items.length, 1);
    assert.equal(data.best_sellers_by_units.pagination.total_items, 2);
    const top = data.best_sellers_by_units.items[0];
    assert.equal(top.product_id, 'P1');
    assert.equal(top.revenue, '300.00');
    assert.deepEqual(top.variants.map((variant: { sku: string }) => variant.sku), ['P1-52', 'P1-54']);
    assert.equal(data.returns_by_product.items[0].return_rate_percent, '33.33');
    assert.equal(data.revenue_by_category.available, false);
  });
});

describe('rate limiting, audit and caching', () => {
  test('requests over the per-minute limit get 429 with Retry-After', async () => {
    process.env.HERMES_RATE_LIMIT_PER_MINUTE = '2';
    db.orders.push(makeOrder({ referenceId: '75000001' }));
    const { apiKey } = addCredential(db, SUPPORT);
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await call(getOrder, '/api/integrations/hermes/orders/75000001', { apiKey }, { orderReference: '75000001' })).status, 200);
    }
    const limited = await call(getOrder, '/api/integrations/hermes/orders/75000001', { apiKey }, { orderReference: '75000001' });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'rate_limited');
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal(db.audits.at(-1)!.outcome, 'rate_limited');
  });

  test('every request writes one audit row with classification and no search inputs', async () => {
    process.env.HERMES_GATEWAY_SIGNING_SECRET = 'gateway-secret';
    const order = makeOrder({ customerMobile: '+966500000003' });
    db.orders.push(order);
    const { apiKey, credential } = addCredential(db, SUPPORT);
    const path = '/api/integrations/hermes/orders/search';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signActor('gateway-secret', { timestamp, actorId: 'emp-42', channel: 'whatsapp', path });
    await call(searchOrders, `${path}?phone=%2B966500000003`, {
      apiKey,
      headers: { 'x-hermes-actor-id': 'emp-42', 'x-hermes-actor-channel': 'whatsapp', 'x-hermes-actor-timestamp': timestamp, 'x-hermes-actor-signature': signature },
    });
    await call(searchOrders, `${path}?phone=%2B966500000003`, { apiKey, headers: { 'x-hermes-actor-id': 'emp-42', 'x-hermes-actor-channel': 'whatsapp' } });

    assert.equal(db.audits.length, 2);
    const [signed, unsigned] = db.audits;
    assert.equal(signed.credentialId, credential.id);
    assert.equal(signed.merchantId, MERCHANT_A);
    assert.equal(signed.action, 'orders.search');
    assert.equal(signed.scopeUsed, HERMES_SCOPES.SUPPORT_READ);
    assert.equal(signed.outcome, 'success');
    assert.equal(signed.classification, 'pii:masked');
    assert.equal(signed.targetId, order.id);
    assert.equal(signed.actorId, 'emp-42');
    assert.equal(signed.actorVerified, true);
    assert.equal(unsigned.actorVerified, false);
    assert.ok(!JSON.stringify(db.audits).includes('500000003'), 'audit rows never contain the searched phone');
  });

  test('report cache is isolated by scope set and by filters', async () => {
    db.orders.push(makeOrder());
    const manager = addCredential(db, MANAGER).apiKey;
    const managerTwin = addCredential(db, MANAGER).apiKey;
    const reportsOnly = addCredential(db, REPORTS_ONLY).apiKey;
    const run = (apiKey: string, extra = '') => call(salesReport, `/api/integrations/hermes/reports/sales${REPORT_QUERY}${extra}`, { apiKey });

    const first = await run(manager);
    assert.equal(first.body.meta.data_freshness.cached, false);
    const second = await run(managerTwin);
    assert.equal(second.body.meta.data_freshness.cached, true, 'same merchant and scope set shares an entry');
    assert.equal(calls.loadReportOrders, 1);

    await run(reportsOnly);
    assert.equal(calls.loadReportOrders, 2, 'a different scope set never reads another\'s entry');
    await run(manager, '&city=جدة');
    assert.equal(calls.loadReportOrders, 3, 'filters are part of the key');
    await run(manager, '&timezone=UTC');
    assert.equal(calls.loadReportOrders, 4, 'timezone is part of the key');
  });

  test('lookups use a fixed number of store calls regardless of result size (no N+1)', async () => {
    for (let i = 0; i < 40; i += 1) db.orders.push(makeOrder({ customerMobile: '+966500000004' }));
    const { apiKey } = addCredential(db, SUPPORT);
    await call(searchOrders, '/api/integrations/hermes/orders/search?phone=%2B966500000004&page_size=50', { apiKey });
    assert.equal(calls.findOrdersByPhoneVariants, 1);
    assert.equal(calls.loadOrderDetail ?? 0, 0);
    assert.equal(calls.loadDialInfo ?? 0, 0, 'E.164 rows need no second query');
  });
});
