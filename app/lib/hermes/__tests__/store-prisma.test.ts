import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { listCredentials } from '../credential-admin';
import { prismaHermesStore as store } from '../store-prisma';

/**
 * Contract tests for the Prisma store, run against a stubbed client (the
 * project has no test database): every business query is tenant-scoped,
 * selects only allow-listed columns, binds values as parameters and issues a
 * fixed number of queries.
 */

type Call = { model: string; method: string; args: any };
const calls: Call[] = [];
const restores: (() => void)[] = [];

function stub(model: string, method: string, result: (args: any) => unknown) {
  const target = (prisma as any)[model];
  const original = target[method];
  target[method] = async (args: any) => {
    calls.push({ model, method, args });
    return result(args);
  };
  restores.push(() => {
    target[method] = original;
  });
}

const rawQueries: { sql: string; values: unknown[] }[] = [];
function stubRaw(result: (sql: string) => unknown[]) {
  const original = (prisma as any).$queryRaw;
  (prisma as any).$queryRaw = async (strings: TemplateStringsArray | { strings: string[]; values: unknown[] }, ...values: unknown[]) => {
    // Prisma.sql fragments are flattened the same way Prisma does it.
    const flatten = (parts: readonly string[], vals: unknown[]): { sql: string; values: unknown[] } => {
      let sql = parts[0];
      const out: unknown[] = [];
      vals.forEach((value, index) => {
        if (value && typeof value === 'object' && 'strings' in (value as object) && 'values' in (value as object)) {
          const nested = flatten((value as any).strings, (value as any).values);
          sql += nested.sql;
          out.push(...nested.values);
        } else {
          sql += `$${out.length + 1}`;
          out.push(value);
        }
        sql += parts[index + 1];
      });
      return { sql, values: out };
    };
    const query = flatten(strings as TemplateStringsArray, values);
    rawQueries.push(query);
    return result(query.sql);
  };
  restores.push(() => {
    (prisma as any).$queryRaw = original;
  });
}

afterEach(() => {
  while (restores.length) restores.pop()!();
  calls.length = 0;
  rawQueries.length = 0;
});

const SENSITIVE_COLUMNS = [
  'rawPayload', 'password', 'adminNotes', 'reasonDetails', 'damageImageData', 'notes', 'deliveryNotes',
  'customerPhone', 'shippingAddress', 'cancellationReason', 'failureReason', 'deliveryOtpCodeHash',
  'deliveryProofUrl', 'recipientSignature', 'receivedBy', 'scannedBy', 'smsaResponse', 'shipmentData',
  'orderData', 'conditionNotes', 'preInspectionNotes',
];

function selectedKeys(select: Record<string, any> | undefined, prefix = ''): string[] {
  if (!select) return [];
  return Object.entries(select).flatMap(([key, value]) =>
    value && typeof value === 'object' && 'select' in value ? [prefix + key, ...selectedKeys(value.select, `${prefix}${key}.`)] : [prefix + key]
  );
}

test('order detail: tenant-scoped, allow-listed and a fixed number of queries', async () => {
  const order = { id: 'row1', orderId: '9001', merchantId: 'M1', trackingNumber: 'T1', rawOrder: {} };
  stub('sallaOrder', 'findFirst', () => order);
  stub('sallaOrderItem', 'findMany', () => Array.from({ length: 30 }, (_, i) => ({ itemId: String(i) })));
  stub('localShipment', 'findMany', () => [{ trackingNumber: 'L1', assignment: null }]);
  stub('returnRequest', 'findMany', () => [{ couponCode: null, items: [] }]);
  stub('webhookEvent', 'findMany', () => []);
  stub('highPriorityOrder', 'findUnique', () => null);
  stub('orderDoNotShipFlag', 'findUnique', () => ({ id: 'f' }));
  stub('orderGiftFlag', 'findUnique', () => null);
  stubRaw((sql) => (sql.includes('FROM "SallaShipment" s\n') || sql.includes('"shipmentData"') ? [{ trackingNumber: 'S1', orderId: '9001' }] : []));

  const bundle = await store.loadOrderDetail('M1', 'row1');
  assert.equal(bundle!.flags.doNotShip, true);
  assert.equal(bundle!.items.length, 30);
  assert.equal(calls.length + rawQueries.length, 10, 'query count does not grow with items or shipments');
  assert.equal(calls.length, 8, 'one detail read, then one parallel batch');

  for (const call of calls) {
    const where = call.args.where;
    if (call.model === 'webhookEvent') {
      assert.deepEqual(where, { orderId: '9001' }, 'webhook events are keyed by the verified order id');
    } else {
      const merchant = where.merchantId ?? where.merchantId_orderId?.merchantId;
      assert.equal(merchant, 'M1', `${call.model}.${call.method} must filter by merchant`);
    }
    for (const key of selectedKeys(call.args.select)) {
      const leaf = key.split('.').pop()!;
      assert.ok(!SENSITIVE_COLUMNS.includes(leaf), `${call.model} selects sensitive column ${key}`);
    }
  }
  const shipmentSql = rawQueries.find((query) => query.sql.includes('"shipmentData"'))!;
  assert.match(shipmentSql.sql, /"shipmentData"->>'tracking_link'/);
  assert.deepEqual(shipmentSql.values, ['M1', '9001'], 'values are bound, not interpolated');
  assert.ok(!shipmentSql.sql.includes('M1'));
  const scanSql = rawQueries.find((query) => query.sql.includes('FROM "Shipment" sc'))!;
  assert.deepEqual(scanSql.values, ['M1', '9001', 'M1', '9001', ['T1']], 'scans are limited to this order\'s tracking numbers');
  assert.ok(!scanSql.sql.includes('"notes"') && !scanSql.sql.includes('"scannedBy"'));
});

test('lookups are tenant-scoped exact matches', async () => {
  stub('sallaOrder', 'findMany', () => []);
  stub('sallaShipment', 'findMany', () => []);
  stub('localShipment', 'findMany', () => []);
  await store.findOrdersByReference('M1', '123');
  await store.findOrdersByPhoneVariants('M1', ['+966500000001'], 10);
  await store.findOrdersByEmails('M1', ['a@b.test'], 10);
  await store.findOrdersByTracking('M1', ['T1'], 10);
  await store.findOrdersByCustomerId('M1', '55', 10);
  for (const call of calls) {
    assert.equal(call.args.where.merchantId, 'M1', `${call.model}.${call.method}`);
    assert.ok(call.args.take <= 100, 'every lookup is bounded');
    const serialized = JSON.stringify(call.args.where);
    assert.ok(!/contains|startsWith|endsWith|search/.test(serialized), 'no partial matching');
  }
  const emailCalls = calls.filter((call) => call.args.where.customerEmail);
  assert.deepEqual(emailCalls[0].args.where.customerEmail, { in: ['a@b.test'] }, 'indexed exact match first');
  assert.deepEqual(emailCalls[1].args.where.customerEmail, { equals: 'a@b.test', mode: 'insensitive' }, 'case-insensitive fallback on a miss');
});

test('report SQL binds merchant and range and reads precomputed facts first', async () => {
  stubRaw(() => []);
  const range = { start: new Date('2026-09-30T21:00:00Z'), end: new Date('2026-10-31T21:00:00Z') };
  await store.loadReportOrders('M1', range);
  await store.loadRestoredOrders('M1', range);
  await store.loadFirstOrderDates('M1', range);
  await store.loadShipmentFacts('M1', range);
  await store.loadLabelCreationTimes('M1', range);
  await store.loadReportItems('M1', range);
  await store.loadReportReturnItems('M1', range);
  await store.loadOpenOrders('M1', ['under_review'], range.start);
  assert.equal(rawQueries.length, 8);
  for (const query of rawQueries) {
    assert.ok(query.values.includes('M1'), 'merchant bound as a parameter');
    assert.ok(!query.sql.includes("'M1'"));
    assert.ok(!/"rawPayload"|"password"|"adminNotes"/.test(query.sql));
  }
  const reportSql = rawQueries[0].sql;
  assert.match(reportSql, /CASE WHEN o\."factsComputedAt" IS NOT NULL THEN COALESCE\(o\."discountTotal", 0\)/);
});

test('rate-limit counting and audit writes use bound parameters', async () => {
  stubRaw(() => [{ recent: 3, misses: 1 }]);
  stub('hermesAuditLog', 'create', () => ({ id: 'a' }));
  const usage = await store.countUsage('cred1', new Date(0), new Date(1), ['orders.get']);
  assert.deepEqual(usage, { recent: 3, misses: 1 });
  assert.ok(rawQueries[0].values.includes('cred1'));
  await store.writeAudit({
    requestId: 'r', credentialId: 'cred1', merchantId: 'M1', action: 'orders.get', scopeUsed: 's', targetType: null, targetId: null,
    outcome: 'success', httpStatus: 200, classification: 'pii:masked', resultCount: 1, durationMs: 5, ipHash: null, actorId: null, actorChannel: null, actorVerified: false,
  });
  assert.equal(calls[0].model, 'hermesAuditLog');
});

test('credential listings never select the secret hash', async () => {
  stub('hermesApiCredential', 'findMany', () => []);
  await listCredentials('M1');
  assert.ok(!selectedKeys(calls[0].args.select).includes('secretHash'));
});

test('SMSA events never include the recipient name', async () => {
  stub('smsaWebhookShipment', 'findMany', () => [{ awb: 'S1', scans: [{ scanType: 'DL', scanDescription: 'Delivered', city: 'RUH', scanDateTime: null, scanTimeZone: null }] }]);
  const events = await store.loadCarrierEvents(['S1']);
  assert.equal(events.length, 1);
  assert.ok(!selectedKeys(calls[0].args.select).some((key) => key.endsWith('receivedBy')));
});
