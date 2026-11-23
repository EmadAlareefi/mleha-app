import assert from 'node:assert/strict';
import test from 'node:test';
import { STATUS_IDS } from '@/SALLA_ORDER_STATUSES';
import { buildJourney, classifyOrder, classifyReturn, reachedStages } from '@/app/lib/stuck-orders/classify';
import type { OrderSnapshot, ReturnSnapshot } from '@/app/lib/stuck-orders/types';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const H = 3_600_000;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();
const opts = { nowMs: NOW, thresholdMs: 24 * H };

const order = (patch: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  orderId: '1',
  orderNumber: '300000001',
  referenceId: null,
  customerName: 'عميلة',
  customerMobile: null,
  customerCity: 'الرياض',
  statusSlug: 'in_progress',
  statusCustomId: String(STATUS_IDS.IN_PROGRESS),
  statusName: 'جاري التجهيز',
  placedAt: ago(200),
  updatedAtRemote: ago(100),
  trackingNumber: null,
  prep: null,
  escalations: [],
  syncJobs: [],
  task: null,
  sallaShipment: null,
  localShipment: null,
  scan: null,
  statusEvents: [],
  doNotShip: null,
  customerHold: null,
  ...patch,
});

const prepDone = (hours: number) => ({
  status: 'completed',
  userName: 'مجهز',
  assignedAt: ago(hours + 1),
  startedAt: ago(hours + 1),
  completedAt: ago(hours),
  verifyIssue: null,
});

const task = (state: string, patch: Partial<NonNullable<OrderSnapshot['task']>> = {}) => ({
  id: 't1',
  method: 'salla',
  state,
  lastError: null,
  blockReason: null,
  attempts: 0,
  createdAt: ago(60),
  creatingAt: null,
  labelReadyAt: null,
  printedAt: null,
  printedByName: null,
  updatedAt: ago(1),
  ...patch,
});

test('shipped / delivered orders are never stuck', () => {
  for (const slug of ['shipped', 'delivering', 'delivered', 'restored']) {
    const d = classifyOrder(order({ statusSlug: slug, statusCustomId: null, prep: prepDone(500) }), opts);
    assert.equal(d.stuck, false, slug);
    assert.equal(d.category, null);
  }
});

test('open escalation on a review status → prep_stopped with requeue actions', () => {
  const d = classifyOrder(
    order({
      statusSlug: 'under_review',
      statusCustomId: String(STATUS_IDS.UNDER_REVIEW_X4),
      escalations: [
        { id: 'e1', reason: 'missing_items', statusTarget: 'under_review_x4', notes: null, createdAt: ago(80), createdByName: ' أنيس ', resolvedAt: null, resolvedByName: null },
      ],
    }),
    opts,
  );
  assert.equal(d.category, 'prep_stopped');
  assert.equal(d.severity, 'critical');
  assert.equal(d.stage, 'prep');
  assert.deepEqual(d.actions.map((a) => a.action), ['requeue_escalation', 'resolve_escalation']);
  assert.match(d.reason, /أنيس أثناء/);
});

test('a failed Salla sync wins over later stages', () => {
  const d = classifyOrder(
    order({
      prep: prepDone(40),
      task: task('queued'),
      syncJobs: [
        { id: 's1', kind: 'packed', state: 'conflict', targetStatusId: 1, lastError: null, liveStatus: 'ملغي', note: null, createdAt: ago(40), syncedAt: null, createdByName: null },
      ],
    }),
    opts,
  );
  assert.equal(d.category, 'sync_failed');
  assert.deepEqual(d.actions.map((a) => a.action), ['retry_sync', 'dismiss_sync']);
});

test('new order waiting in the queue past the threshold → waiting_queue', () => {
  const d = classifyOrder(order({ statusSlug: 'under_review', statusCustomId: String(STATUS_IDS.NEW_ORDER), placedAt: ago(30) }), opts);
  assert.equal(d.category, 'waiting_queue');
  assert.equal(d.severity, 'warn');
});

test('a claim held too long → prep_abandoned', () => {
  const d = classifyOrder(
    order({
      statusSlug: 'under_review',
      statusCustomId: String(STATUS_IDS.NEW_ORDER),
      prep: { status: 'preparing', userName: 'سارة', assignedAt: ago(30), startedAt: ago(30), completedAt: null, verifyIssue: null },
    }),
    opts,
  );
  assert.equal(d.category, 'prep_abandoned');
});

test('in_progress with no prep record and no shipment → prep_abandoned', () => {
  const d = classifyOrder(order({ statusEvents: [{ status: 'in_progress', receivedAt: ago(50) }] }), opts);
  assert.equal(d.category, 'prep_abandoned');
  assert.equal(d.sinceAt, ago(50));
});

test('packed but no shipping task → packed_no_shipping', () => {
  const d = classifyOrder(order({ prep: prepDone(30) }), opts);
  assert.equal(d.category, 'packed_no_shipping');
  assert.equal(d.stage, 'label');
});

test('open shipping task → shipping_stuck with retry/close', () => {
  const d = classifyOrder(order({ prep: prepDone(70), task: task('label_ready', { labelReadyAt: ago(50) }) }), opts);
  assert.equal(d.category, 'shipping_stuck');
  assert.equal(d.sinceAt, ago(50));
  assert.equal(d.stage, 'printed');
  assert.deepEqual(d.actions.map((a) => a.action), ['retry_task', 'close_task']);
});

test('printed label with no exit scan → label_not_shipped', () => {
  const d = classifyOrder(
    order({ statusSlug: 'completed', statusCustomId: String(STATUS_IDS.COMPLETED), prep: prepDone(70), task: task('printed', { printedAt: ago(48) }) }),
    opts,
  );
  assert.equal(d.category, 'label_not_shipped');
  assert.equal(d.stage, 'scanned');
});

test('scanned out but Salla never moved to shipped → label_not_shipped at the shipped step', () => {
  const d = classifyOrder(
    order({
      statusSlug: 'completed',
      statusCustomId: String(STATUS_IDS.COMPLETED),
      task: task('printed', { printedAt: ago(80) }),
      scan: { scannedAt: ago(75), scannedBy: 'x', handoverScannedAt: null, handoverScannedBy: null },
    }),
    opts,
  );
  assert.equal(d.category, 'label_not_shipped');
  assert.equal(d.stage, 'shipped');
});

test('cancelled in Salla with an open task → cancelled_in_warehouse; closed task → fine', () => {
  const open = classifyOrder(
    order({ statusSlug: 'canceled', statusCustomId: null, task: task('label_ready'), statusEvents: [{ status: 'canceled', receivedAt: ago(30) }] }),
    opts,
  );
  assert.equal(open.category, 'cancelled_in_warehouse');
  assert.deepEqual(open.actions.map((a) => a.action), ['close_task']);
  const closed = classifyOrder(order({ statusSlug: 'canceled', statusCustomId: null, task: task('cancelled') }), opts);
  assert.equal(closed.stuck, false);
});

test('threshold boundary: just under is in progress, at threshold is stuck, 3x is critical', () => {
  assert.equal(classifyOrder(order({ prep: prepDone(23.9) }), opts).stuck, false);
  assert.equal(classifyOrder(order({ prep: prepDone(24) }), opts).severity, 'warn');
  assert.equal(classifyOrder(order({ prep: prepDone(72) }), opts).severity, 'critical');
});

test('held orders keep their diagnosis but say why they are held', () => {
  const d = classifyOrder(order({ prep: prepDone(30), doNotShip: { notes: 'انتظار العميل', createdAt: ago(29), createdByName: null } }), opts);
  assert.equal(d.stuck, true);
  assert.match(d.held ?? '', /لا تشحن/);
});

test('returns: received and unprocessed is stuck; completed is not', () => {
  const base: ReturnSnapshot = {
    id: 'r1',
    orderId: '1',
    orderNumber: '1',
    customerName: null,
    customerPhone: null,
    status: 'delivered',
    processingStatus: 'idle',
    refundStatus: 'none',
    smsaTrackingNumber: null,
    createdAt: ago(200),
    receivedAt: ago(48),
    processedAt: null,
    updatedAt: ago(48),
  };
  const stuck = classifyReturn(base, opts);
  assert.equal(stuck.category, 'return_unprocessed');
  assert.equal(stuck.stuck, true);
  assert.equal(classifyReturn({ ...base, status: 'completed', processingStatus: 'done' }, opts).stuck, false);
  assert.equal(classifyReturn({ ...base, status: 'completed', processingStatus: 'needs_attention', processedAt: ago(30) }, opts).stuck, true);
});

test('reachedStages and journey ordering', () => {
  const s = order({ prep: prepDone(70), task: task('printed', { printedAt: ago(48) }) });
  assert.deepEqual(reachedStages(s), ['placed', 'prep', 'packed', 'label', 'printed']);
  const events = buildJourney(s);
  const times = events.map((e) => Date.parse(e.at));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(events[0].title, 'تم الطلب');
});
