import assert from 'node:assert/strict';
import test from 'node:test';
import { isOrderPaid, toOrderState } from '../salla-exchange-order';

const order = (remainingAction: Record<string, unknown> | undefined, slug = 'under_review') => ({
  id: 1,
  reference_id: 2,
  status: { slug },
  amounts: { total: { amount: 75, currency: 'SAR' } },
  payment_actions: remainingAction ? { remaining_action: remainingAction } : undefined,
});

test('a missing remaining amount is treated as unpaid, not paid', () => {
  const state = toOrderState(order(undefined));
  assert.equal(state.remainingAmount, 75);
  assert.equal(isOrderPaid(state), false);
});

test('an explicit zero remaining amount on a paid status is paid', () => {
  const state = toOrderState(order({ remaining_amount: { amount: 0 }, paid_amount: { amount: 75 } }));
  assert.equal(state.remainingAmount, 0);
  assert.equal(state.paidAmount, 75);
  assert.equal(isOrderPaid(state), true);
});

test('payment_pending is never paid', () => {
  assert.equal(isOrderPaid(toOrderState(order({ remaining_amount: { amount: 0 } }, 'payment_pending'))), false);
});

test('the custom status id tells the hold apart from "طلب جديد" (same base id and slug)', () => {
  const held = toOrderState({
    id: 1,
    status: { id: 566146469, slug: 'under_review', name: 'تحت المراجعة حجز قطع', customized: { id: 1576217163 } },
    amounts: { total: { amount: 75 } },
  });
  assert.equal(held.customStatusId, '1576217163');
  assert.equal(held.statusName, 'تحت المراجعة حجز قطع');
  const plain = toOrderState({ id: 1, status: { id: 449146439, slug: 'under_review' }, amounts: { total: { amount: 75 } } });
  assert.equal(plain.customStatusId, '449146439');
  assert.equal(toOrderState({ id: 1 }).customStatusId, null);
});
