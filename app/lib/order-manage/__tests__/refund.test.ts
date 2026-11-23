import assert from 'node:assert/strict';
import test from 'node:test';
import { SallaCallError } from '@/app/lib/salla-transactions';
import { cancelOrderForCustomer } from '@/app/lib/order-manage/cancel';
import { decideRefund, processCancelRefund, resolveUnknownRefund } from '@/app/lib/order-manage/refund';
import { KEY, SESSION, SETTINGS, createDeps, createWorld, paidTx, type World } from './fake-deps';

const decide = (overrides: Partial<Parameters<typeof decideRefund>[0]> = {}) =>
  decideRefund({
    orderTotal: 300,
    transactions: [paidTx()],
    historyRefunds: [],
    settings: SETTINGS,
    autoRefundedTodaySar: 0,
    ...overrides,
  });

const manualCode = (plan: ReturnType<typeof decideRefund>) => (plan.action === 'manual' ? plan.code : plan.action);

test('one refundable SAR payment equal to the order total is refunded in full', () => {
  assert.deepEqual(decide(), { action: 'auto', transactionId: 'tx1', amount: 300, currency: 'SAR', transactionTotal: 300 });
});

test('a free order needs no refund; a bank transfer needs a person', () => {
  assert.deepEqual(decide({ transactions: [], orderTotal: 0 }), { action: 'not_needed' });
  assert.equal(manualCode(decide({ transactions: [] })), 'NO_PAYMENT');
  assert.equal(manualCode(decide({ transactions: [], orderTotal: null })), 'NO_PAYMENT');
});

test('Tabby (marked not refundable by Salla) goes to staff', () => {
  const tabby = paidTx({ payment_method: { slug: 'tabby_installment', is_refundable: false, within_refund_period: true } });
  assert.equal(manualCode(decide({ transactions: [tabby] })), 'NOT_REFUNDABLE');
});

test('expired refund window and several payments go to staff', () => {
  const expired = paidTx({ payment_method: { slug: 'mada', is_refundable: true, within_refund_period: false } });
  assert.equal(manualCode(decide({ transactions: [expired] })), 'PERIOD_EXPIRED');
  assert.equal(manualCode(decide({ transactions: [paidTx(), paidTx({ id: 'tx2' })] })), 'MULTIPLE_PAYMENTS');
});

test('any earlier refund on the order goes to staff', () => {
  assert.equal(manualCode(decide({ historyRefunds: [{ amount: 35, note: 'تم إرجاع مبلغ (35 ر.س)' }] })), 'PRIOR_REFUND');
  assert.equal(manualCode(decide({ transactions: [paidTx({ status: { slug: 'partial_refunded' } })] })), 'PRIOR_REFUND');
});

test('a non-SAR payment goes to staff', () => {
  assert.equal(manualCode(decide({ transactions: [paidTx({ total: { amount: 300, currency: 'AED' } })] })), 'CURRENCY');
});

test('a payment that does not equal the order total goes to staff', () => {
  assert.equal(manualCode(decide({ orderTotal: 250 })), 'AMOUNT_MISMATCH');
  assert.equal(manualCode(decide({ orderTotal: null })), 'AMOUNT_MISMATCH');
  assert.equal(decide({ orderTotal: 300.004 }).action, 'auto');
});

test('auto refund off, or past the daily cap, goes to staff', () => {
  assert.equal(manualCode(decide({ settings: { ...SETTINGS, autoRefundEnabled: false } })), 'AUTO_OFF');
  assert.equal(manualCode(decide({ settings: { ...SETTINGS, autoRefundDailyCapSar: 1000 }, autoRefundedTodaySar: 701 })), 'DAILY_CAP');
  assert.equal(decide({ settings: { ...SETTINGS, autoRefundDailyCapSar: 1000 }, autoRefundedTodaySar: 700 }).action, 'auto');
});

test('a payment Salla already refunded on cancel is recorded, not refunded again', () => {
  const refunded = paidTx({ status: { slug: 'refunded' }, available_actions: ['print'] });
  assert.deepEqual(decide({ transactions: [refunded] }), { action: 'already_refunded', transactionId: 'tx1', amount: 300, currency: 'SAR' });
  // Refunded for a different amount: a person looks at it.
  assert.equal(manualCode(decide({ transactions: [refunded], orderTotal: 250 })), 'NO_PAYMENT');
});

async function cancelled(overrides: Partial<World> = {}) {
  const world = createWorld(overrides);
  const deps = createDeps(world);
  const outcome = await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  assert.equal(outcome.status, 'completed');
  return { world, deps, change: world.changes[0] };
}

test('after a cancel the payment is refunded once, in full', async () => {
  const { world, deps, change } = await cancelled();
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'refunded');
  assert.deepEqual(world.calls.refund, [{ transactionId: 'tx1', amount: 300, currency: 'SAR' }]);
  assert.equal(change.refundStatus, 'refunded');
  assert.equal(change.refundAmount, 300);
  assert.equal(change.refundTransactionId, 'tx1');

  // Worker and request both running it: still one refund.
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'skipped');
  assert.equal(world.calls.refund.length, 1);
});

test('two refund runs at the same moment send one refund', async () => {
  const { world, deps, change } = await cancelled();
  const results = await Promise.all([
    processCancelRefund(deps, change.id, world.settings),
    processCancelRefund(deps, change.id, world.settings),
  ]);
  assert.deepEqual(results.sort(), ['refunded', 'skipped']);
  assert.equal(world.calls.refund.length, 1);
});

test('manual cases are parked with the amount staff must refund, and nothing is sent', async () => {
  const { world, deps, change } = await cancelled({
    transactions: [paidTx({ payment_method: { slug: 'tabby_installment', is_refundable: false } })],
  });
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'manual');
  assert.equal(change.refundStatus, 'manual');
  assert.equal(change.refundAmount, 300);
  assert.equal(world.calls.refund.length, 0);
});

test('refund outcome unknown: recorded as unknown and never sent again', async () => {
  const { world, deps, change } = await cancelled({
    refund: async () => {
      throw new SallaCallError('timeout', undefined, true);
    },
  });
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'unknown');
  assert.equal(change.refundStatus, 'unknown');
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'skipped');
  assert.equal(await processCancelRefund(deps, change.id, world.settings, { staffRetry: true }), 'skipped');
  assert.equal(world.calls.refund.length, 1);

  // Settled only by Salla showing the payment as refunded.
  assert.equal(await resolveUnknownRefund(deps, change.id), 'unknown');
  world.transactions = [paidTx({ status: { slug: 'refunded' }, available_actions: ['print'] })];
  assert.equal(await resolveUnknownRefund(deps, change.id), 'refunded');
  assert.equal(change.refundStatus, 'refunded');
  assert.equal(world.calls.refund.length, 1);
});

test('refund definitely refused: failed, and only a staff retry sends it again', async () => {
  let attempts = 0;
  const { world, deps, change } = await cancelled({
    refund: async () => {
      attempts += 1;
      if (attempts === 1) throw new SallaCallError('سلة (422): الرصيد غير كاف', 422, false);
      return { success: true };
    },
  });
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'failed');
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'skipped');
  assert.equal(await processCancelRefund(deps, change.id, world.settings, { staffRetry: true }), 'refunded');
  assert.equal(world.calls.refund.length, 2);
});

test('Salla unreadable: decided later, and handed to staff after an hour', async () => {
  const { world, deps, change } = await cancelled({ transactions: new Error('salla down') });
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'retry_later');
  assert.equal(change.refundStatus, 'none');
  world.now = new Date(world.now.getTime() + 61 * 60_000);
  assert.equal(await processCancelRefund(deps, change.id, world.settings), 'manual');
  assert.equal(change.refundAmount, 300);
  assert.equal(world.calls.refund.length, 0);
});

test('no refund is considered before Salla confirmed the cancel', async () => {
  const world = createWorld({
    live: [world_liveNew()],
    cancel: async () => {
      throw new SallaCallError('timeout', undefined, true);
    },
  });
  const deps = createDeps(world);
  await cancelOrderForCustomer(deps, { session: SESSION, idempotencyKey: KEY, ipHash: null });
  assert.equal(world.changes[0].writeStatus, 'unknown');
  assert.equal(await processCancelRefund(deps, world.changes[0].id, world.settings), 'skipped');
  assert.equal(world.calls.refund.length, 0);
});

function world_liveNew() {
  return {
    kind: 'ok' as const,
    detail: { id: 'o1', status: { slug: 'under_review', customized: { id: 449146439 } } },
    statusCustomId: '449146439',
    statusName: 'طلب جديد',
  };
}
