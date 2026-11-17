import assert from 'node:assert/strict';
import test from 'node:test';
import { SallaCallError } from '@/app/lib/salla-transactions';
import { cancelOrderForCustomer } from '@/app/lib/order-manage/cancel';
import { processCancelRefund } from '@/app/lib/order-manage/refund';
import { bucketOf, markRefundDone, markRefundNotSent, resolveUnknownCancel, retryRefundViaSalla } from '@/app/lib/order-manage/staff';
import { KEY, SESSION, createDeps, createWorld, isShielded, liveCancelled, liveInProgress, liveNew, paidTx, type World } from './fake-deps';

async function unknownCancel() {
  const world = createWorld({
    live: [liveNew()],
    cancel: async () => {
      throw new SallaCallError('timeout', undefined, true);
    },
  });
  const deps = createDeps(world);
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  assert.equal(world.changes[0].state, 'needs_staff');
  return { world, deps, change: world.changes[0] };
}

async function cancelledWith(overrides: Partial<World>) {
  const world = createWorld(overrides);
  const deps = createDeps(world);
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  return { world, deps, change: world.changes[0] };
}

test('unknown cancel, Salla shows cancelled: finished without sending the cancel again', async () => {
  const { world, deps, change } = await unknownCancel();
  world.live = [liveCancelled()];
  const result = await resolveUnknownCancel(deps, change.id, 'مشرف');
  assert.equal(result.ok, true);
  assert.equal(change.state, 'completed');
  assert.equal(change.writeStatus, 'done');
  assert.equal(change.holdActive, false);
  assert.equal(world.mirrorStatus, '1183362113');
  assert.equal(world.calls.cancel, 1);
});

test('unknown cancel, Salla shows the order still new: released back to the queue', async () => {
  const { world, deps, change } = await unknownCancel();
  const result = await resolveUnknownCancel(deps, change.id, 'مشرف');
  assert.equal(result.ok, true);
  assert.equal(change.state, 'failed');
  assert.equal(change.holdActive, false);
  assert.equal(isShielded(world), false);
  assert.equal(world.calls.cancel, 1);
  // No refund is ever considered for a cancel that did not happen.
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'skipped');
});

test('unknown cancel, order moved to another status: mirror fixed and hold released', async () => {
  const { world, deps, change } = await unknownCancel();
  world.live = [liveInProgress()];
  assert.equal((await resolveUnknownCancel(deps, change.id, 'مشرف')).ok, true);
  assert.equal(change.holdActive, false);
  assert.equal(world.mirrorStatus, '1956875584');
});

test('unknown cancel while Salla cannot be read: nothing changes', async () => {
  const { world, deps, change } = await unknownCancel();
  world.live = [{ kind: 'error', message: 'timeout' }];
  assert.equal((await resolveUnknownCancel(deps, change.id, 'مشرف')).ok, false);
  assert.equal(change.state, 'needs_staff');
  assert.equal(change.holdActive, true);
});

test('resolving twice, or resolving a change that is not waiting, is refused', async () => {
  const { deps, change } = await unknownCancel();
  assert.equal((await resolveUnknownCancel(deps, change.id, 'a')).ok, true);
  assert.equal((await resolveUnknownCancel(deps, change.id, 'b')).ok, false);
  assert.equal((await resolveUnknownCancel(deps, 'missing', 'b')).ok, false);
});

test('a manual refund is marked done once and sends nothing', async () => {
  const { world, deps, change } = await cancelledWith({
    transactions: [paidTx({ payment_method: { slug: 'tabby_installment', is_refundable: false } })],
  });
  await processCancelRefund(deps, change.id, world.settings);
  assert.equal(change.refundStatus, 'manual');
  assert.equal((await markRefundDone(deps, change.id, 'مشرف')).ok, true);
  assert.equal(change.refundStatus, 'refunded');
  assert.equal((await markRefundDone(deps, change.id, 'مشرف')).ok, false);
  assert.equal(world.calls.refund.length, 0);
});

test('a staff retry refunds through Salla even with auto refund off and the cap reached', async () => {
  const { world, deps, change } = await cancelledWith({ autoRefundedToday: 999_999 });
  world.settings.autoRefundEnabled = false;
  await processCancelRefund(deps, change.id, world.settings);
  assert.equal(change.refundStatus, 'manual');
  const result = await retryRefundViaSalla(deps, change.id);
  assert.equal(result.ok, true);
  assert.equal(change.refundStatus, 'refunded');
  assert.deepEqual(world.calls.refund, [{ transactionId: 'tx1', amount: 300, currency: 'SAR' }]);
  // A second click sends nothing.
  assert.equal((await retryRefundViaSalla(deps, change.id)).ok, false);
  assert.equal(world.calls.refund.length, 1);
});

test('a staff retry still refuses what Salla cannot refund', async () => {
  const { world, deps, change } = await cancelledWith({
    transactions: [paidTx({ payment_method: { slug: 'tabby_installment', is_refundable: false } })],
  });
  await processCancelRefund(deps, change.id, world.settings);
  assert.equal((await retryRefundViaSalla(deps, change.id)).ok, false);
  assert.equal(change.refundStatus, 'manual');
  assert.equal(world.calls.refund.length, 0);
});

test('an unknown refund cannot be retried until staff confirm it was not sent', async () => {
  const { world, deps, change } = await cancelledWith({
    refund: async () => {
      throw new SallaCallError('timeout', undefined, true);
    },
  });
  await processCancelRefund(deps, change.id, world.settings);
  assert.equal(change.refundStatus, 'unknown');
  assert.equal((await retryRefundViaSalla(deps, change.id)).ok, false);
  assert.equal(world.calls.refund.length, 1);

  assert.equal((await markRefundNotSent(deps, change.id, 'مشرف')).ok, true);
  assert.equal(change.refundStatus, 'failed');
  world.refund = async () => ({ success: true });
  assert.equal((await retryRefundViaSalla(deps, change.id)).ok, true);
  assert.equal(world.calls.refund.length, 2);
  assert.equal((await markRefundNotSent(deps, change.id, 'مشرف')).ok, false);
});

test('board buckets: what needs a person, what is a manual refund, what is just history', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const base = { state: 'completed' as const, refundStatus: 'refunded' as const, holdActive: false, updatedAt: now };
  assert.equal(bucketOf(base, now), 'other');
  assert.equal(bucketOf({ ...base, refundStatus: 'manual' }, now), 'manual_refund');
  assert.equal(bucketOf({ ...base, refundStatus: 'unknown' }, now), 'attention');
  assert.equal(bucketOf({ ...base, refundStatus: 'failed' }, now), 'attention');
  assert.equal(bucketOf({ ...base, state: 'needs_staff', holdActive: true }, now), 'attention');
  // A hold that has just been taken is normal; one stuck for minutes is not.
  assert.equal(bucketOf({ ...base, state: 'applying', holdActive: true }, now), 'other');
  assert.equal(bucketOf({ ...base, state: 'applying', holdActive: true, updatedAt: new Date(now.getTime() - 6 * 60_000) }, now), 'attention');
});
