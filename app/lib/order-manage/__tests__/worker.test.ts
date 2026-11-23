import assert from 'node:assert/strict';
import test from 'node:test';
import { SallaCallError } from '@/app/lib/salla-transactions';
import { cancelOrderForCustomer } from '@/app/lib/order-manage/cancel';
import { runOrderManageWorker } from '@/app/lib/order-manage/worker';
import { KEY, SESSION, createDeps, createStore, createWorld, isShielded, liveCancelled, liveNew, type World } from './fake-deps';

const later = (world: World, minutes: number) => {
  world.now = new Date(world.now.getTime() + minutes * 60_000);
};

const work = (world: World, deps = createDeps(world)) => runOrderManageWorker(deps, createStore(world), world.settings);

test('a hold that never wrote anything is released after two minutes, not before', async () => {
  const world = createWorld();
  const deps = createDeps(world);
  await deps.createHold({
    merchantId: 'm1', orderId: 'o1', orderNumber: '1001', kind: 'cancel', idempotencyKey: 'k', accessId: null, ipHash: null,
    request: {}, before: {}, paymentMethod: 'mada', currency: 'SAR', orderTotal: 300,
  });
  assert.equal((await work(world, deps)).released, 0);
  later(world, 3);
  assert.equal((await work(world, deps)).released, 1);
  assert.equal(world.changes[0].state, 'failed');
  assert.equal(world.changes[0].holdActive, false);
  assert.equal(world.calls.cancel, 0);
});

test('a request that died mid-cancel is never re-sent: parked, then settled from what Salla shows', async () => {
  const world = createWorld({ live: [liveNew()] });
  const deps = createDeps(world);
  // The request marked the write as sent and then died.
  const change = await deps.createHold({
    merchantId: 'm1', orderId: 'o1', orderNumber: '1001', kind: 'cancel', idempotencyKey: 'k', accessId: null, ipHash: null,
    request: {}, before: {}, paymentMethod: 'mada', currency: 'SAR', orderTotal: 300,
  });
  await deps.updateChange(change!.id, {}, { state: 'applying', writeStatus: 'requested' });
  later(world, 3);

  const first = await work(world, deps);
  assert.equal(first.parked, 1);
  assert.equal(world.changes[0].state, 'needs_staff');
  assert.equal(world.changes[0].holdActive, true);
  assert.equal(world.calls.cancel, 0);

  // Salla turns out to have cancelled it.
  world.live = [liveCancelled()];
  const second = await work(world, deps);
  assert.equal(second.confirmed, 1);
  assert.equal(second.finished, 1);
  assert.equal(world.changes[0].state, 'completed');
  assert.equal(world.changes[0].holdActive, false);
  assert.equal(world.mirrorStatus, '1183362113');
  assert.equal(world.calls.cancel, 0);
});

test('an unknown cancel that Salla still shows as new stays held for staff', async () => {
  const world = createWorld({
    live: [liveNew()],
    cancel: async () => {
      throw new SallaCallError('timeout', undefined, true);
    },
  });
  const deps = createDeps(world);
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  later(world, 30);
  const summary = await work(world, deps);
  assert.equal(summary.confirmed, 0);
  assert.equal(world.changes[0].state, 'needs_staff');
  assert.equal(isShielded(world), true);
  assert.equal(world.calls.cancel, 1);
  assert.deepEqual(summary.refunds, {});
});

test('a cancel whose release failed is finished by the worker, then refunded', async () => {
  const world = createWorld({ syncMirrorOk: false, markMirrorFails: true });
  const deps = createDeps(world);
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  assert.equal(world.changes[0].holdActive, true);

  world.markMirrorFails = false;
  later(world, 3);
  const summary = await work(world, deps);
  assert.equal(summary.finished, 1);
  assert.equal(world.changes[0].state, 'completed');
  assert.equal(world.changes[0].holdActive, false);
  assert.deepEqual(summary.refunds, { refunded: 1 });
  assert.equal(world.calls.refund.length, 1);
  assert.equal(world.calls.cancel, 1);
});

test('refunds the request did not get to are decided by the worker, once', async () => {
  const world = createWorld();
  const deps = createDeps(world);
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  assert.deepEqual((await work(world, deps)).refunds, { refunded: 1 });
  assert.deepEqual((await work(world, deps)).refunds, {});
  assert.equal(world.calls.refund.length, 1);
});

test('with auto refund off the worker parks the refund for staff', async () => {
  const world = createWorld();
  world.settings.autoRefundEnabled = false;
  const deps = createDeps(world);
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  assert.deepEqual((await work(world, deps)).refunds, { manual: 1 });
  assert.equal(world.changes[0].refundStatus, 'manual');
  assert.equal(world.calls.refund.length, 0);
});
