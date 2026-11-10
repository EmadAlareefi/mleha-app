import assert from 'node:assert/strict';
import test from 'node:test';
import { planReopen, type ReopenRequest } from '../reopen';

const now = new Date('2026-11-10T10:00:00Z');
const req = (overrides: Partial<ReopenRequest> = {}): ReopenRequest => ({
  status: 'completed',
  processingStatus: 'done',
  receivedAt: new Date('2026-11-05T10:00:00Z'),
  items: [
    { id: 'a', productName: 'فستان', conditionStatus: 'good', restockStatus: 'done', inspectedAt: '2026-11-05T11:00:00Z' },
    { id: 'b', productName: 'عباية', conditionStatus: 'worn', restockStatus: 'skipped', inspectedAt: '2026-11-05T11:00:00Z' },
  ],
  ...overrides,
});

test('a completed, received request goes back as delivered (never pending_review) and keeps restocked pieces', () => {
  const plan = planReopen(req(), { clearInspection: true, now });
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.fromStage, 'completed');
  assert.equal(plan.toStatus, 'delivered');
  assert.deepEqual(plan.clearItemIds, ['b']);
  assert.deepEqual(plan.keptItems.map((item) => item.id), ['a']);
  assert.equal(plan.toStage, 'received'); // one piece awaits re-inspection
});

test('without re-inspection a fully inspected request lands in "ready"', () => {
  const plan = planReopen(req(), { now });
  assert.ok(plan.ok && plan.toStage === 'ready' && plan.clearItemIds.length === 0);
});

test('a request closed before it was ever received goes back to awaiting pickup', () => {
  const plan = planReopen(req({ status: 'rejected', receivedAt: null, items: [{ id: 'a', productName: 'فستان' }] }), { now });
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.equal(plan.toStatus, 'pending_review');
    assert.equal(plan.toStage, 'awaiting_pickup');
  }
});

test('received evidence without receivedAt sets it from the first inspection', () => {
  const plan = planReopen(req({ receivedAt: null }), { now });
  assert.ok(plan.ok && plan.receivedAt?.toISOString() === '2026-11-05T11:00:00.000Z');
});

test('ready requests must be re-inspected; needs-attention ones keep their status and drop the error', () => {
  const ready = planReopen(req({ status: 'delivered', processingStatus: 'idle' }), { now });
  assert.ok(ready.ok && ready.inspectionRequired && ready.clearItemIds.length === 1);

  const allRestocked = planReopen(
    req({ status: 'delivered', processingStatus: 'idle', items: [{ id: 'a', productName: 'فستان', conditionStatus: 'good', restockStatus: 'done' }] }),
    { now },
  );
  assert.equal(!allRestocked.ok && allRestocked.code, 'NOTHING_TO_CLEAR');

  const attention = planReopen(req({ status: 'delivered', processingStatus: 'needs_attention', processingError: 'فشل الاسترجاع' }), { now });
  assert.ok(attention.ok);
  if (attention.ok) {
    assert.equal(attention.toStatus, 'delivered');
    assert.equal(attention.previousError, 'فشل الاسترجاع');
  }
});

test('cancelled, running and in-flight requests are not reopened; an abandoned processing claim is', () => {
  assert.equal((planReopen(req({ status: 'cancelled' }), { now }) as any).code, 'CANCELLED');
  assert.equal((planReopen(req({ status: 'delivered', processingStatus: 'processing', updatedAt: now }), { now }) as any).code, 'PROCESSING');
  const stale = planReopen(
    req({ status: 'delivered', processingStatus: 'processing', updatedAt: new Date(now.getTime() - 10 * 60 * 1000) }),
    { now },
  );
  assert.ok(stale.ok && stale.fromStage === 'needs_attention');
  assert.equal(
    (planReopen(req({ status: 'shipped', processingStatus: 'idle', receivedAt: null, items: [{ id: 'a', productName: 'x' }] }), { now }) as any).code,
    'NOT_REOPENABLE',
  );
});
