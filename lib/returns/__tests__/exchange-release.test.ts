import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideExchangeRelease,
  exchangePieceFailed,
  exchangeReturnArrived,
  exchangeStatusMove,
  type ExchangeStatusIds,
  type ReleaseCandidate,
} from '../exchange-release';

const ids: ExchangeStatusIds = {
  hold: '1576217163',
  release: '449146439',
  holdFrom: ['449146439', '566146469', '1224232774', '1473353380'],
  releaseFrom: ['1576217163', '1065456688', '566146469'],
  paymentPending: ['1224232774', '1473353380'],
};

const held = (overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate => ({
  status: 'shipped',
  receivedAt: null,
  exchangeMode: 'order',
  exchangePaymentStatus: 'paid',
  exchangeOrderId: '777',
  exchangeOrderHoldActive: true,
  items: [{ type: 'exchange', conditionStatus: 'good' }],
  ...overrides,
});

test('arrival: carrier status, receivedAt, or any inspection', () => {
  assert.equal(exchangeReturnArrived(held({ items: [{ type: 'exchange' }] })), false);
  assert.equal(exchangeReturnArrived(held({ status: 'delivered', items: [] })), true);
  assert.equal(exchangeReturnArrived(held({ receivedAt: new Date(), items: [] })), true);
  assert.equal(exchangeReturnArrived(held()), true);
});

test('release needs an active hold, payment, and good exchanged pieces', () => {
  assert.deepEqual(decideExchangeRelease(held()), { release: true });
  assert.deepEqual(decideExchangeRelease(held({ exchangeOrderHoldActive: false })), { release: false, reason: 'no_active_hold' });
  assert.deepEqual(decideExchangeRelease(held({ exchangePaymentStatus: 'pending' })), { release: false, reason: 'payment_pending' });
  assert.deepEqual(decideExchangeRelease(held({ exchangePaymentStatus: 'not_required' })), { release: true });
  assert.deepEqual(decideExchangeRelease(held({ items: [{ type: 'exchange' }] })), { release: false, reason: 'shipment_not_received' });
  assert.deepEqual(
    decideExchangeRelease(held({ status: 'delivered', items: [{ type: 'exchange' }] })),
    { release: false, reason: 'items_not_inspected' },
  );
  assert.deepEqual(
    decideExchangeRelease(held({ items: [{ type: 'exchange', conditionStatus: 'worn' }] })),
    { release: false, reason: 'items_failed' },
  );
  // Returned pieces never gate an app-created replacement; for legacy coupon holds every piece does.
  const mixed = [{ type: 'exchange', conditionStatus: 'good' }, { type: 'return', conditionStatus: 'damaged' }];
  assert.deepEqual(decideExchangeRelease(held({ items: mixed })), { release: true });
  assert.deepEqual(decideExchangeRelease(held({ exchangeMode: 'coupon', items: mixed })), { release: false, reason: 'items_failed' });
});

test('force skips inspection but never payment', () => {
  assert.deepEqual(decideExchangeRelease(held({ items: [{ type: 'exchange', conditionStatus: 'damaged' }] }), { force: true }), { release: true });
  assert.deepEqual(decideExchangeRelease(held({ exchangePaymentStatus: 'pending' }), { force: true }), { release: false, reason: 'payment_pending' });
});

test('a failed exchanged piece is detected; uninspected is not a failure', () => {
  assert.equal(exchangePieceFailed(held({ items: [{ type: 'exchange', conditionStatus: 'policy_violation' }] })), true);
  assert.equal(exchangePieceFailed(held({ items: [{ type: 'exchange', conditionStatus: null }] })), false);
});

test('status moves are compare-and-set against the live Salla status', () => {
  const live = (customStatusId: string | null, statusSlug = 'under_review') => ({ customStatusId, statusSlug });
  // Hold
  assert.equal(exchangeStatusMove('hold', live('449146439'), ids), 'write');
  assert.equal(exchangeStatusMove('hold', live('1224232774', 'payment_pending'), ids), 'write');
  assert.equal(exchangeStatusMove('hold', live('1576217163'), ids), 'already');
  assert.equal(exchangeStatusMove('hold', live('2046404155'), ids), 'conflict'); // X4, moved by hand
  assert.equal(exchangeStatusMove('hold', live('1956875584', 'in_progress'), ids), 'progressed');
  assert.equal(exchangeStatusMove('hold', live(null, 'payment_pending'), ids), 'write');
  // Release
  assert.equal(exchangeStatusMove('release', live('1576217163'), ids), 'write');
  assert.equal(exchangeStatusMove('release', live('1065456688'), ids), 'write');
  assert.equal(exchangeStatusMove('release', live('449146439'), ids), 'already');
  assert.equal(exchangeStatusMove('release', live('1224232774', 'payment_pending'), ids), 'conflict');
  assert.equal(
    exchangeStatusMove('release', live('1224232774', 'payment_pending'), ids, { allowReleaseFromPaymentPending: true }),
    'write',
  );
  assert.equal(exchangeStatusMove('release', live('1183362113', 'canceled'), ids), 'cancelled');
  assert.equal(exchangeStatusMove('release', live('165947469', 'shipped'), ids), 'progressed');
});
