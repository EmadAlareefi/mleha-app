import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import { Prisma } from '@prisma/client';
import { GET as searchOrders } from '@/app/api/integrations/hermes/orders/search/route';
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
import { clearReportCache } from '../cache';
import { setHermesStore } from '../handler';
import { customerRef } from '../identifiers';
import { HERMES_SCOPES } from '../scopes';
import { addCredential, createMemoryStore, emptyDb, makeOrder, MERCHANT_A, request, routeParams, TEST_PEPPER, type FixtureDb } from './fixtures';

/**
 * Keeps docs/hermes-openapi.json and docs/hermes-tools-manifest.json honest:
 * real responses are validated against the OpenAPI schemas (which forbid
 * undeclared properties), and every route and tool is cross-checked.
 */

process.env.HERMES_API_KEY_PEPPER = TEST_PEPPER;
process.env.HERMES_API_ENABLED = 'true';

const root = process.cwd();
const spec = JSON.parse(fs.readFileSync(path.join(root, 'docs/hermes-openapi.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/hermes-tools-manifest.json'), 'utf8'));

type Schema = Record<string, any>;

/** Minimal JSON Schema (2020-12 subset used by the spec) validator. */
function validate(schema: Schema, value: unknown, at = '$'): string[] {
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return validate(spec.components.schemas[name], value, at);
  }
  if (schema.allOf) return schema.allOf.flatMap((part: Schema) => validate(part, value, at));
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((part: Schema) => validate(part, value, at).length === 0);
    return passing.length === 1 ? [] : [`${at}: matched ${passing.length} oneOf branches`];
  }
  if ('const' in schema && value !== schema.const) return [`${at}: expected const ${schema.const}`];
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null;
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (types && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    return [`${at}: expected ${types.join('|')}, got ${actual}`];
  }
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: ${value} !~ ${schema.pattern}`);
  if (actual === 'array' && schema.items) (value as unknown[]).forEach((item, i) => errors.push(...validate(schema.items, item, `${at}[${i}]`)));
  if (actual === 'object' && (schema.properties || schema.additionalProperties !== undefined)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${at}: missing ${key}`);
    for (const [key, entry] of Object.entries(record)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], entry, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: undeclared property ${key}`);
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, entry, `${at}.${key}`));
    }
  }
  return errors;
}

let db: FixtureDb;
beforeEach(() => {
  db = emptyDb();
  setHermesStore(createMemoryStore(db));
  clearReportCache();
});

function seed() {
  const order = makeOrder({
    referenceId: '76000001',
    customerId: '6001',
    fulfillmentCompany: 'سمسا',
    raw: {
      discounts: ['5.00'],
      refundedItems: [10],
      items: [{ id: 1, notes: 'ملاحظة', options: [{ name: 'المقاس', value: { name: '52' } }] }],
      shipments: [{ tracking_number: 'SM100', courier_name: 'سمسا', status: 'delivered' }],
    },
  });
  db.orders.push(order, makeOrder({ customerId: '6001', statusSlug: 'in_progress', placedAt: new Date(Date.now() - 50 * 3_600_000) }));
  db.items.push({ merchantId: MERCHANT_A, orderId: order.orderId, itemId: '1', productId: 'P1', sku: 'P1-52', name: 'عباية', quantity: 1, priceAmount: new Prisma.Decimal('115'), totalAmount: new Prisma.Decimal('115'), currency: 'SAR' });
  db.sallaShipments.push({ merchantId: MERCHANT_A, orderId: order.orderId, orderNumber: order.orderNumber!, trackingNumber: 'SM100', courierName: 'سمسا', courierCode: 'smsa', status: 'delivered', trackingLink: null, createdAt: new Date('2026-10-05T12:00:00Z'), updatedAt: new Date('2026-10-05T12:00:00Z') });
  db.scans.push({ trackingNumber: 'SM100', company: 'smsa', scannedAt: new Date('2026-10-06T08:00:00Z'), handoverScannedAt: null, smsaLiveStatus: { code: 'DL', delivered: true, timestamp: '2026-10-07T08:00:00Z' }, smsaLiveStatusUpdatedAt: new Date('2026-10-07T08:00:00Z'), ajexLiveStatus: null, ajexLiveStatusUpdatedAt: null, ajexLiveStatusEventAt: null });
  db.carrierEvents.push({ trackingNumber: 'SM100', scanType: 'DL', description: 'Delivered', city: 'RUH', scanDateTime: '2026-10-07T08:00:00Z', scanTimeZone: '+03:00' });
  db.returns.push({ merchantId: MERCHANT_A, id: 'r', orderId: order.orderId, orderNumber: order.orderNumber, type: 'return', status: 'pending_review', reason: 'size', totalRefundAmount: new Prisma.Decimal('50'), currency: 'SAR', couponIssued: false, returnTrackingNumber: null, exchangeOrderNumber: null, createdAt: new Date('2026-10-08T10:00:00Z'), updatedAt: new Date('2026-10-08T10:00:00Z'), items: [{ productId: 'P1', productName: 'عباية', productSku: 'P1-52', variantName: '52', quantity: 1, price: new Prisma.Decimal('50') }] });
  db.events.push({ orderId: order.orderId, status: 'delivered', receivedAt: new Date('2026-10-07T08:00:00Z') });
  return order;
}

function responseSchema(specPath: string, method: string, status: string) {
  const response = spec.paths[specPath][method].responses[status];
  const resolved = response.$ref ? spec.components.responses[response.$ref.split('/').pop()] : response;
  return resolved.content['application/json'].schema;
}

test('every response matches its OpenAPI schema exactly', async () => {
  seed();
  const ref = customerRef(MERCHANT_A, '6001', TEST_PEPPER)!;
  const reportQuery = '?from=2026-10-01&to=2026-10-31&compare=previous_period';
  const cases: [string, any, string, Record<string, string>?][] = [
    ['/orders/search', searchOrders, '/orders/search?order_number=76000001'],
    ['/orders/{orderReference}', getOrder, '/orders/76000001', { orderReference: '76000001' }],
    ['/customers/search', searchCustomers, '/customers/search?customer_id=6001'],
    ['/customers/{customerRef}/summary', customerSummary, `/customers/${ref}/summary`, { customerRef: ref }],
    ['/shipments/search', searchShipments, '/shipments/search?order_number=76000001'],
    ['/shipments/{shipmentReference}', getShipment, '/shipments/SM100', { shipmentReference: 'SM100' }],
    ['/reports/sales', salesReport, `/reports/sales${reportQuery}`],
    ['/reports/order-operations', operationsReport, `/reports/order-operations${reportQuery}`],
    ['/reports/shipment-performance', shipmentReport, `/reports/shipment-performance${reportQuery}`],
    ['/reports/customers', customerReport, `/reports/customers${reportQuery}`],
    ['/reports/products', productReport, `/reports/products${reportQuery}`],
    ['/reports/daily-trend', trendReport, `/reports/daily-trend${reportQuery}`],
  ];
  for (const scopes of [[HERMES_SCOPES.SUPPORT_READ, HERMES_SCOPES.MANAGER_REPORTS], [HERMES_SCOPES.SUPPORT_READ, HERMES_SCOPES.MANAGER_REPORTS, HERMES_SCOPES.MANAGER_PII]]) {
    clearReportCache();
    const { apiKey } = addCredential(db, scopes);
    for (const [specPath, handler, url, params] of cases) {
      const res = await handler(request(`/api/integrations/hermes${url}`, { apiKey }), params ? routeParams(params) : undefined);
      assert.equal(res.status, 200, specPath);
      const errors = validate(responseSchema(specPath, 'get', '200'), await res.json());
      assert.deepEqual(errors, [], `${specPath} (${scopes.length} scopes)`);
    }
  }
});

test('error responses match the error envelope', async () => {
  const res = await searchOrders(request('/api/integrations/hermes/orders/search?order_number=1'));
  assert.deepEqual(validate(responseSchema('/orders/search', 'get', '401'), await res.json()), []);
});

test('every route file is in the spec and every spec path has a route', () => {
  const base = path.join(root, 'app/api/integrations/hermes');
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name === 'route.ts') routes.push(path.relative(base, dir).split(path.sep).map((part) => part.replace(/^\[(.+)\]$/, '{$1}')).join('/'));
    }
  };
  walk(base);
  assert.deepEqual(routes.map((route) => `/${route}`).sort(), Object.keys(spec.paths).sort());
});

test('the tools manifest points at real operations with matching scopes', () => {
  const expected = ['find_order', 'get_order', 'find_customer', 'get_customer_summary', 'find_shipment', 'get_shipment', 'get_sales_report', 'get_order_operations_report', 'get_shipment_performance_report', 'get_customer_report', 'get_product_report', 'get_daily_trend_report'];
  assert.deepEqual(manifest.tools.map((tool: { name: string }) => tool.name).sort(), [...expected].sort());
  for (const tool of manifest.tools) {
    const [method, ...rest] = tool.endpoint.split(' ');
    const specPath = rest.join(' ').replace(/^\/api\/integrations\/hermes/, '');
    const operation = spec.paths[specPath]?.[method.toLowerCase()];
    assert.ok(operation, `${tool.name} → ${tool.endpoint}`);
    assert.equal(tool.required_scope, operation['x-required-scope'], tool.name);
    assert.equal(tool.operation_id, operation.operationId, tool.name);
    assert.ok(Array.isArray(tool.audience) && tool.audience.length > 0, tool.name);
    assert.ok(!JSON.stringify(tool).match(/hrm_[a-z0-9]{16}_/), 'no credentials in the manifest');
  }
});
