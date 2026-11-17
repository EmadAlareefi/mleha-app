import assert from 'node:assert/strict';
import test from 'node:test';
import { SallaCallError } from '@/app/lib/salla-transactions';
import { cancelOrderForCustomer } from '@/app/lib/order-manage/cancel';
import { MAX_HOLDS_PER_MINUTE, scopedKey } from '@/app/lib/order-manage/engine';
import { KEY, SESSION, createDeps, createWorld, isShielded, liveCancelled, liveInProgress, liveNew } from './fake-deps';

const run = (world: ReturnType<typeof createWorld>, key: unknown = KEY) =>
  cancelOrderForCustomer(createDeps(world), { session: SESSION, idempotencyKey: key, ipHash: 'ip' });

test('cancels a new order: Salla cancelled, mirror updated, hold released', async () => {
  const world = createWorld();
  const outcome = await run(world);
  assert.equal(outcome.status, 'completed');
  assert.equal(world.calls.cancel, 1);
  const [change] = world.changes;
  assert.equal(change.state, 'completed');
  assert.equal(change.writeStatus, 'done');
  assert.equal(change.holdActive, false);
  assert.equal(change.refundStatus, 'none'); // decided by the refund step
  assert.equal(world.mirrorStatus, '1183362113');
  assert.equal(world.calls.notes.length, 1);
  assert.deepEqual(
    world.steps.map((entry) => `${entry.step}:${entry.result}`),
    ['cancel:requested', 'cancel:ok', 'release:ok'],
  );
});

test('the same key again returns the first result and cancels nothing twice', async () => {
  const world = createWorld();
  const first = await run(world);
  const second = await run(world);
  assert.deepEqual(second, first);
  assert.equal(world.calls.cancel, 1);
  assert.equal(world.changes.length, 1);
});

test('a malformed idempotency key is refused before anything happens', async () => {
  const world = createWorld();
  for (const key of [null, '', 'short', 'has spaces in it......', 42, { key: KEY }]) {
    assert.equal((await run(world, key)).status, 'denied');
  }
  assert.equal(world.changes.length, 0);
  assert.equal(scopedKey('o1', 'cancel', KEY), `o1:cancel:${KEY}`);
});

test('refused when a packer already holds the order: no hold, no Salla call', async () => {
  const world = createWorld({ claimedByPacker: true });
  const outcome = await run(world);
  assert.deepEqual([outcome.status, outcome.status === 'denied' && outcome.code], ['denied', 'in_progress']);
  assert.equal(world.changes.length, 0);
  assert.equal(world.calls.cancel, 0);
  assert.equal(world.calls.live, 0);
});

test('refused by eligibility before a hold is taken', async () => {
  const world = createWorld();
  world.facts.hasPrepClaim = true;
  const outcome = await run(world);
  assert.equal(outcome.status === 'denied' && outcome.code, 'in_progress');
  assert.equal(world.changes.length, 0);

  const off = createWorld();
  off.settings.cancelEnabled = false;
  assert.equal(((await run(off)) as { code: string }).code, 'unavailable');
});

test('outside production an order that is not allowlisted is never written to', async () => {
  const world = createWorld({ writeAllowed: false });
  const outcome = await run(world);
  assert.equal(outcome.status === 'denied' && outcome.code, 'unavailable');
  assert.equal(world.changes.length, 0);
  assert.equal(world.calls.cancel, 0);
});

test('too many holds in the last minute asks the customer to retry', async () => {
  const world = createWorld({ recentHolds: MAX_HOLDS_PER_MINUTE });
  const outcome = await run(world);
  assert.equal(outcome.status === 'denied' && outcome.code, 'try_later');
  assert.equal(world.changes.length, 0);
});

test('order moved on in Salla since the mirror was written: nothing cancelled, hold released, mirror fixed', async () => {
  const world = createWorld({ live: [liveInProgress()] });
  const outcome = await run(world);
  assert.equal(outcome.status === 'denied' && outcome.code, 'in_progress');
  assert.equal(world.calls.cancel, 0);
  assert.equal(world.changes[0].state, 'failed');
  assert.equal(world.changes[0].holdActive, false);
  assert.equal(world.changes[0].writeStatus, 'none');
  assert.equal(world.mirrorStatus, '1956875584');
});

test('Salla unreadable before the write: nothing cancelled, hold released, customer retries', async () => {
  for (const live of [{ kind: 'error' as const, message: 'timeout' }, { kind: 'rate_limited' as const, retryAfterMs: 1000 }]) {
    const world = createWorld({ live: [live] });
    const outcome = await run(world);
    assert.equal(outcome.status === 'denied' && outcome.code, 'try_later');
    assert.equal(world.calls.cancel, 0);
    assert.equal(world.changes[0].holdActive, false);
  }
});

test('Salla refuses the cancel: nothing changed, order goes back to the queue', async () => {
  const world = createWorld({
    cancel: async () => {
      throw new SallaCallError('سلة (422): لا يمكن', 422, false);
    },
  });
  const outcome = await run(world);
  assert.equal(outcome.status, 'failed');
  assert.equal(world.changes[0].state, 'failed');
  assert.equal(world.changes[0].writeStatus, 'failed');
  assert.equal(world.changes[0].holdActive, false);
  assert.equal(world.mirrorStatus, '449146439');
});

test('unknown outcome and Salla still shows the order as new: kept on hold for staff, never re-sent', async () => {
  const world = createWorld({
    live: [liveNew()],
    cancel: async () => {
      throw new SallaCallError('timeout', undefined, true);
    },
  });
  const outcome = await run(world);
  assert.equal(outcome.status, 'pending_review');
  const [change] = world.changes;
  assert.equal(change.state, 'needs_staff');
  assert.equal(change.writeStatus, 'unknown');
  assert.equal(change.holdActive, true);
  assert.equal(isShielded(world), true);

  // The customer taps again with the same key: still one call to Salla.
  assert.equal((await run(world)).status, 'pending_review');
  assert.equal(world.calls.cancel, 1);
  // A different key cannot start a second change while the hold is on.
  const other = await run(world, 'another-key-0123456789');
  assert.equal(other.status, 'denied');
  assert.equal(world.calls.cancel, 1);
});

test('unknown outcome but Salla already shows cancelled: treated as done', async () => {
  const world = createWorld({
    live: [liveNew(), liveCancelled()],
    cancel: async () => {
      throw new SallaCallError('502', 502, true);
    },
  });
  const outcome = await run(world);
  assert.equal(outcome.status, 'completed');
  assert.equal(world.changes[0].state, 'completed');
  assert.equal(world.changes[0].holdActive, false);
});

test('an unexpected error during the cancel call is treated as unknown, not as failed', async () => {
  const world = createWorld({
    live: [liveNew()],
    cancel: async () => {
      throw new TypeError('socket hang up');
    },
  });
  assert.equal((await run(world)).status, 'pending_review');
  assert.equal(world.changes[0].holdActive, true);
});

test('mirror cannot be synced after the cancel: the order is taken out of the queue directly', async () => {
  const world = createWorld({ syncMirrorOk: false });
  const outcome = await run(world);
  assert.equal(outcome.status, 'completed');
  assert.equal(world.mirrorStatus, '1183362113');
  assert.equal(world.changes[0].holdActive, false);
});

test('mirror cannot be updated at all: the hold stays so no packer gets a cancelled order', async () => {
  const world = createWorld({ syncMirrorOk: false, markMirrorFails: true });
  const outcome = await run(world);
  assert.equal(outcome.status, 'completed');
  const [change] = world.changes;
  assert.equal(change.writeStatus, 'done');
  assert.equal(change.holdActive, true);
  assert.equal(isShielded(world), true);
});

test('at every point after the hold, the queue cannot hand the order out', async () => {
  // Shielded = an active hold, or a mirror that no longer says "new".
  const world = createWorld();
  const deps = createDeps(world);
  const observed: boolean[] = [];
  const cancel = deps.cancelOrder;
  deps.cancelOrder = async (...args) => {
    observed.push(isShielded(world));
    return cancel(...args);
  };
  const note = deps.addHistoryNote;
  deps.addHistoryNote = async (...args) => {
    observed.push(isShielded(world));
    return note(...args);
  };
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  observed.push(isShielded(world));
  assert.deepEqual(observed, [true, true, true]);
});
