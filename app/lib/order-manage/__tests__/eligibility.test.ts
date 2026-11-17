import assert from 'node:assert/strict';
import test from 'node:test';
import { NEW_ORDER_STATUS_ID, commonBlocker, decideVerdicts, type OrderFacts } from '@/app/lib/order-manage/eligibility';
import { DEFAULT_ORDER_MANAGE_SETTINGS, type OrderManageSettings } from '@/app/lib/order-manage/settings';

const ALL_ON: OrderManageSettings = {
  ...DEFAULT_ORDER_MANAGE_SETTINGS,
  enabled: true,
  cancelEnabled: true,
  addressEnabled: true,
  swapEnabled: true,
  itemsEnabled: true,
};

/** A plain new, paid, untouched Saudi order. */
const facts = (overrides: Partial<OrderFacts> = {}): OrderFacts => ({
  statusCustomId: NEW_ORDER_STATUS_ID,
  statusSlug: 'under_review',
  isPendingPayment: false,
  hasPrepClaim: false,
  hasShipment: false,
  hasShippingTask: false,
  hasOpenEscalation: false,
  doNotShip: false,
  promoViolator: false,
  isExchangeOrder: false,
  hasReturnRequest: false,
  changeInFlight: false,
  needsStaff: false,
  completedChanges: 0,
  isInternational: false,
  currency: 'SAR',
  erpSynced: false,
  hasCoupon: false,
  pilotAllowed: true,
  ...overrides,
});

const codes = (overrides: Partial<OrderFacts> = {}, settings = ALL_ON) => {
  const verdicts = decideVerdicts(facts(overrides), settings);
  return Object.fromEntries(
    Object.entries(verdicts).map(([action, verdict]) => [action, verdict.allowed ? 'ok' : verdict.code]),
  );
};

test('a new, paid, untouched order allows everything', () => {
  assert.deepEqual(codes(), { cancel: 'ok', address: 'ok', swap: 'ok', items: 'ok' });
});

test('everything is off by default', () => {
  assert.deepEqual(codes({}, DEFAULT_ORDER_MANAGE_SETTINGS), {
    cancel: 'unavailable',
    address: 'unavailable',
    swap: 'unavailable',
    items: 'unavailable',
  });
});

test('an action switch only affects its own action', () => {
  assert.deepEqual(codes({}, { ...ALL_ON, itemsEnabled: false, addressEnabled: false }), {
    cancel: 'ok',
    address: 'unavailable',
    swap: 'ok',
    items: 'unavailable',
  });
});

test('the master switch wins over the action switches', () => {
  assert.equal(codes({}, { ...ALL_ON, enabled: false }).cancel, 'unavailable');
});

test('orders outside the pilot list are told the service is unavailable', () => {
  assert.equal(codes({ pilotAllowed: false }).cancel, 'unavailable');
});

// Every condition that keeps an order away from a packer, or shows a packer or
// shipper already has it, must also stop the customer.
const BLOCKERS: Array<[string, Partial<OrderFacts>, string]> = [
  ['claimed by a packer', { hasPrepClaim: true }, 'in_progress'],
  ['has a shipment', { hasShipment: true }, 'in_progress'],
  ['has a shipping task', { hasShippingTask: true }, 'in_progress'],
  ['already in progress in Salla', { statusCustomId: '1956875584', statusSlug: 'in_progress' }, 'not_editable'],
  ['under review sub-status', { statusCustomId: '1065456688' }, 'not_editable'],
  ['status unknown', { statusCustomId: null }, 'not_editable'],
  ['pending payment', { isPendingPayment: true }, 'not_editable'],
  ['cancelled', { statusCustomId: '1183362113', statusSlug: 'canceled' }, 'cancelled'],
  ['a change is in flight', { changeInFlight: true }, 'busy'],
  ['a change waits for staff', { needsStaff: true }, 'needs_support'],
  ['open escalation', { hasOpenEscalation: true }, 'needs_support'],
  ['do-not-ship flag', { doNotShip: true }, 'needs_support'],
  ['promo violator', { promoViolator: true }, 'needs_support'],
  ['replacement order from a return', { isExchangeOrder: true }, 'needs_support'],
  ['has a return request', { hasReturnRequest: true }, 'needs_support'],
  ['change limit reached', { completedChanges: 3 }, 'limit'],
];

for (const [name, overrides, code] of BLOCKERS) {
  test(`blocked for every action: ${name}`, () => {
    assert.equal(commonBlocker(facts(overrides), ALL_ON), code);
    assert.deepEqual(codes(overrides), { cancel: code, address: code, swap: code, items: code });
  });
}

test('a packer claim outranks a change waiting for staff', () => {
  assert.equal(commonBlocker(facts({ hasPrepClaim: true, needsStaff: true }), ALL_ON), 'in_progress');
});

test('the change limit follows the setting', () => {
  assert.equal(codes({ completedChanges: 1 }, { ...ALL_ON, maxChangesPerOrder: 1 }).cancel, 'limit');
  assert.equal(codes({ completedChanges: 1 }, { ...ALL_ON, maxChangesPerOrder: 2 }).cancel, 'ok');
});

test('international orders can only be cancelled', () => {
  assert.deepEqual(codes({ isInternational: true, currency: 'AED' }), {
    cancel: 'ok',
    address: 'not_supported',
    swap: 'not_supported',
    items: 'not_supported',
  });
});

test('a non-SAR or ERP-synced order keeps cancel and address but not line edits', () => {
  for (const overrides of [{ currency: 'USD' }, { erpSynced: true }]) {
    assert.deepEqual(codes(overrides), { cancel: 'ok', address: 'ok', swap: 'not_supported', items: 'not_supported' });
  }
});

test('a coupon blocks adding and removing lines, not a same-price swap', () => {
  assert.deepEqual(codes({ hasCoupon: true }), { cancel: 'ok', address: 'ok', swap: 'ok', items: 'not_supported' });
});

test('every refusal carries a customer-facing reason', () => {
  const verdict = decideVerdicts(facts({ hasPrepClaim: true }), ALL_ON).cancel;
  assert.equal(verdict.allowed, false);
  if (!verdict.allowed) assert.match(verdict.reason, /تجهيز/);
});
