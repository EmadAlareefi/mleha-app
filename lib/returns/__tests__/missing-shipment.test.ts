import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { prisma } from '../../prisma';
import { GET } from '../../../app/api/returns/list/route';
import { needsManualReturnShipment, RETURN_LABEL_GRACE_MS } from '../missing-shipment';

const now = new Date('2026-09-11T10:00:00Z');
const missing = {
  id: 'test-return',
  status: 'pending_review',
  createdAt: new Date(now.getTime() - RETURN_LABEL_GRACE_MS - 1),
  smsaTrackingNumber: null,
  smsaAwbNumber: null,
  returnLabelUrl: null,
};

test('active returns are flagged only after the asynchronous creation grace period', () => {
  assert.equal(needsManualReturnShipment(missing, now), true);
  for (const age of [-1, 0, RETURN_LABEL_GRACE_MS]) {
    assert.equal(needsManualReturnShipment({ ...missing, createdAt: new Date(now.getTime() - age) }, now), false);
  }
});

test('tracking, legacy AWB or a label independently prevent a manual creation warning', () => {
  for (const field of ['smsaTrackingNumber', 'smsaAwbNumber', 'returnLabelUrl']) {
    assert.equal(needsManualReturnShipment({ ...missing, [field]: 'existing-shipment' }, now), false);
  }
  assert.equal(needsManualReturnShipment({ ...missing, smsaTrackingNumber: '' }, now), true);
});

test('finished, rejected and cancelled returns do not prompt a new shipment', () => {
  for (const status of ['completed', 'delivered', 'rejected', 'cancelled']) {
    assert.equal(needsManualReturnShipment({ ...missing, status }, now), false);
  }
});

test('attention count is independent of default inspection filters and pagination', async (t) => {
  const counts: unknown[] = [];
  const original = { count: prisma.returnRequest.count, findMany: prisma.returnRequest.findMany };
  t.after(() => Object.assign(prisma.returnRequest, original));
  Object.assign(prisma.returnRequest, { count: async ({ where }: { where: unknown }) => {
    counts.push(where);
    return counts.length === 1 ? 120 : 7;
  }});
  Object.assign(prisma.returnRequest, { findMany: async ({ skip, take }: { skip: number; take: number }) => {
    assert.equal(skip, 100);
    assert.equal(take, 100);
    return [];
  }});
  const response = await GET(new NextRequest('http://localhost/api/returns/list?inspection=inspected&status=pending_review&page=2&limit=100'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.missingShipmentCount, 7);
  assert.equal(body.pagination.total, 120);
  assert.match(JSON.stringify(counts[0]), /conditionStatus/);
  assert.doesNotMatch(JSON.stringify(counts[1]), /conditionStatus/);
  assert.match(JSON.stringify(counts[1]), /smsaAwbNumber/);
});

test('missing-shipment view overrides inspection and status filters before pagination and keeps search', async (t) => {
  const counts: unknown[] = [];
  const original = { count: prisma.returnRequest.count, findMany: prisma.returnRequest.findMany };
  t.after(() => Object.assign(prisma.returnRequest, original));
  Object.assign(prisma.returnRequest, { count: async ({ where }: { where: unknown }) => {
    counts.push(where);
    return 1;
  }});
  Object.assign(prisma.returnRequest, { findMany: async ({ where, skip }: { where: unknown; skip: number }) => {
    assert.deepEqual(where, counts[0]);
    assert.equal(skip, 0);
    const serialized = JSON.stringify(where);
    assert.doesNotMatch(serialized, /conditionStatus/);
    assert.match(serialized, /smsaTrackingNumber/);
    assert.match(serialized, /smsaAwbNumber/);
    assert.match(serialized, /returnLabelUrl/);
    assert.match(serialized, /test-order/);
    return [{ ...missing, createdAt: new Date(Date.now() - RETURN_LABEL_GRACE_MS - 1000) }];
  }});
  const response = await GET(new NextRequest('http://localhost/api/returns/list?shipment=missing&inspection=inspected&status=completed&search=test-order'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data[0].needsManualShipment, true);
  assert.equal(body.missingShipmentCount, 1);
  assert.doesNotMatch(JSON.stringify(counts[1]), /test-order/);
});
