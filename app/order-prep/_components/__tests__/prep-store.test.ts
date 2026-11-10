import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrepAssignmentView, PrepState, QueueStats } from '@/app/lib/order-prep/types';
import {
  UNDO_MS,
  allUnitsChecked,
  initialPrepState,
  needsItemChecks,
  prepReducer,
  summarizeChecks,
  type PendingAction,
  type PrepUiState,
} from '../prep-store';

const stats: QueueStats = {
  waiting: 10,
  oldestPlacedAt: null,
  buckets: { lt24h: 10, d1to2: 0, d2to4: 0, gt4d: 0 },
  generatedAt: '2026-11-09T00:00:00Z',
};

function view(id: string, items: Array<{ quantity: number; sku?: string }> = [{ quantity: 1 }]): PrepAssignmentView {
  return {
    assignmentId: `a-${id}`,
    status: 'preparing',
    assignedAt: '2026-11-09T00:00:00Z',
    startedAt: null,
    leaseExpiresAt: null,
    verifyIssue: null,
    order: {
      orderId: id,
      orderNumber: `#${id}`,
      placedAt: null,
      isInternational: false,
      country: null,
      city: null,
      shippingCompany: null,
      tags: [],
      gift: null,
      highPriority: false,
      isPromo: false,
      totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
      items: items.map((item, index) => ({
        index,
        key: `${id}-${index}`,
        name: `item ${index}`,
        sku: item.sku ?? `SKU${index}`,
        quantity: item.quantity,
        imageUrl: null,
        size: 'M',
        color: null,
        options: [],
        location: null,
        locationNote: null,
        productId: null,
      })),
    },
  };
}

const server = (current: PrepAssignmentView | null, next: PrepAssignmentView | null, done = 0): PrepState => ({
  current,
  next: next ? { ...next, status: 'assigned' } : null,
  stats,
  myCompletedToday: done,
});

function completeAction(v: PrepAssignmentView, now: number, id = 'act-1'): Extract<PendingAction, { kind: 'complete' }> {
  return {
    id,
    kind: 'complete',
    assignmentId: v.assignmentId,
    orderId: v.order.orderId,
    orderNumber: v.order.orderNumber,
    itemChecks: [],
    scanMethod: 'manual',
    notBefore: now + UNDO_MS,
    attempts: 0,
    nextTryAt: 0,
  };
}

const A = view('A');
const B = view('B');
const C = view('C');

test('starts on the packing screen when the server says the packer holds an order', () => {
  assert.equal(initialPrepState(server(A, B)).phase, 'packing');
  assert.equal(initialPrepState(server(null, null)).phase, 'idle');
  assert.equal(initialPrepState(null).phase, 'idle');
});

test('Done shows the next order at once and can be undone within the window', () => {
  const now = 1_000;
  let state: PrepUiState = initialPrepState(server(A, B, 3));
  state = prepReducer(state, { type: 'DONE', action: completeAction(A, now), now });
  assert.equal(state.current?.order.orderId, 'B');
  assert.equal(state.next, null);
  assert.equal(state.queue.length, 1);
  assert.equal(state.myCompletedToday, 4);
  assert.equal(state.lastDone?.orderNumber, '#A');

  const undone = prepReducer(state, { type: 'UNDO', now: now + 1_000 });
  assert.equal(undone.current?.order.orderId, 'A');
  assert.equal(undone.next?.order.orderId, 'B');
  assert.equal(undone.queue.length, 0);
  assert.equal(undone.myCompletedToday, 3);

  // Too late: nothing changes.
  const late = prepReducer(state, { type: 'UNDO', now: now + UNDO_MS + 1 });
  assert.equal(late.current?.order.orderId, 'B');
  assert.equal(late.queue.length, 1);
});

test('undo is impossible once the action is being sent', () => {
  const now = 1_000;
  let state = prepReducer(initialPrepState(server(A, B)), { type: 'DONE', action: completeAction(A, now), now });
  state = prepReducer(state, { type: 'ACTION_STARTED', id: 'act-1' });
  assert.equal(state.undo, null);
  const after = prepReducer(state, { type: 'UNDO', now: now + 100 });
  assert.equal(after.current?.order.orderId, 'B');
});

test('server state is ignored while actions are pending, then adopted', () => {
  const now = 1_000;
  let state = prepReducer(initialPrepState(server(A, B)), { type: 'DONE', action: completeAction(A, now), now });
  // A heartbeat still reflecting the old state must not bring A back.
  state = prepReducer(state, { type: 'SERVER_STATE', state: server(A, B, 0), source: 'heartbeat' });
  assert.equal(state.current?.order.orderId, 'B');
  state = prepReducer(state, { type: 'ACTION_STARTED', id: 'act-1' });
  state = prepReducer(state, { type: 'ACTION_SUCCEEDED', id: 'act-1', state: server(B, C, 4) });
  assert.equal(state.queue.length, 0);
  assert.equal(state.current?.order.orderId, 'B');
  assert.equal(state.next?.order.orderId, 'C');
  assert.equal(state.myCompletedToday, 4);
});

test('a rejected action leaves a sticky banner naming the order', () => {
  const now = 1_000;
  let state = prepReducer(initialPrepState(server(A, B)), { type: 'DONE', action: completeAction(A, now), now });
  state = prepReducer(state, { type: 'ACTION_STARTED', id: 'act-1' });
  state = prepReducer(state, {
    type: 'ACTION_REJECTED',
    id: 'act-1',
    error: { code: 'conflict', message: 'الطلب انتقل لزميل' },
    state: server(B, C),
  });
  assert.equal(state.queue.length, 0);
  assert.equal(state.banners.length, 1);
  assert.equal(state.banners[0].sticky, true);
  assert.match(state.banners[0].text, /#A/);
  assert.equal(state.current?.order.orderId, 'B');
});

test('retries back off; coming back online retries at once', () => {
  const now = 1_000;
  let state = prepReducer(initialPrepState(server(A, B)), { type: 'DONE', action: completeAction(A, now), now });
  state = prepReducer(state, { type: 'ACTION_STARTED', id: 'act-1' });
  state = prepReducer(state, { type: 'ACTION_RETRY', id: 'act-1', nextTryAt: 99_999 });
  assert.equal(state.inFlightId, null);
  assert.equal(state.queue[0].attempts, 1);
  state = prepReducer(state, { type: 'ONLINE', online: false });
  state = prepReducer(state, { type: 'ONLINE', online: true });
  assert.equal(state.queue[0].nextTryAt, 0);
});

test('a heartbeat revealing a lost order warns the packer', () => {
  const state = prepReducer(initialPrepState(server(A, B)), {
    type: 'SERVER_STATE',
    state: server(C, null),
    source: 'heartbeat',
  });
  assert.equal(state.current?.order.orderId, 'C');
  assert.equal(state.banners.length, 1);
  assert.match(state.banners[0].text, /#A/);
});

test('pause hands everything back and returns to the start screen', () => {
  const state = prepReducer(initialPrepState(server(A, B)), {
    type: 'RELEASE',
    action: { id: 'r1', kind: 'release', scope: 'all', reason: 'pause', orderId: 'A', orderNumber: '#A', notBefore: 0, attempts: 0, nextTryAt: 0 },
  });
  assert.equal(state.phase, 'idle');
  assert.equal(state.current, null);
  assert.equal(state.queue.length, 1);
  // The release succeeding keeps the packer on the start screen.
  const done = prepReducer(prepReducer(state, { type: 'ACTION_STARTED', id: 'r1' }), {
    type: 'ACTION_SUCCEEDED',
    id: 'r1',
    state: server(null, null),
  });
  assert.equal(done.phase, 'idle');
});

test('restored actions from a reload are sent immediately, without duplicates', () => {
  const action = completeAction(A, 1_000);
  let state = initialPrepState(server(B, C));
  state = prepReducer(state, { type: 'RESTORE_QUEUE', queue: [action] });
  state = prepReducer(state, { type: 'RESTORE_QUEUE', queue: [action] });
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].notBefore, 0);
});

test('unit checks: tapping counts up to the quantity; scans stay scans only if every unit was scanned', () => {
  const multi = view('M', [{ quantity: 2 }, { quantity: 1 }]);
  assert.equal(needsItemChecks(multi), true);
  assert.equal(needsItemChecks(A), false);
  let state = initialPrepState(server(multi, null));
  const mark = (index: number, method: 'scan' | 'manual', mode: 'add' | 'fill' | 'clear' = 'add') =>
    (state = prepReducer(state, {
      type: 'MARK_ITEM',
      assignmentId: multi.assignmentId,
      index,
      method,
      quantity: multi.order.items[index].quantity,
      mode,
    }));
  mark(0, 'scan');
  mark(0, 'scan');
  mark(0, 'scan'); // capped at 2
  mark(1, 'manual');
  const progress = state.progress[multi.assignmentId];
  assert.equal(progress[0].checked, 2);
  assert.equal(allUnitsChecked(multi, progress), true);
  const summary = summarizeChecks(multi, progress, false);
  assert.deepEqual(summary.itemChecks.map((check) => [check.checked, check.method]), [
    [2, 'scan'],
    [1, 'manual'],
  ]);
  assert.equal(summary.scanMethod, 'manual');
  mark(1, 'manual', 'clear');
  assert.equal(allUnitsChecked(multi, state.progress[multi.assignmentId]), false);
});

test('a single-unit order is confirmed by Done itself', () => {
  const summary = summarizeChecks(A, undefined, true);
  assert.deepEqual(summary.itemChecks.map((check) => check.checked), [1]);
  assert.equal(summary.scanMethod, 'manual');
});
