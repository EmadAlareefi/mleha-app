import assert from 'node:assert/strict';
import test from 'node:test';
import { getRibbonEligibility, RIBBON_REMOVED_MESSAGE, validateRibbonItems } from '../protection-ribbon';

const order = { items: [{ id: 11, quantity: 2 }, { id: 12, quantity: 1 }] };

test('requires an explicit boolean declaration for every ordered piece', () => {
  for (const answers of [undefined, null, false, [], [false], [false, undefined], [false, null], [false, 'false'], [false, 0], [false, false, false], new Array(2)]) {
    assert.deepEqual(getRibbonEligibility(answers, 2), { complete: false, intactQuantity: 0 });
    assert.equal(validateRibbonItems(order, [{ orderItemId: 11, quantity: 1, ribbonRemoved: answers }]).ok, false);
  }
});

test('counts intact pieces independently and permits a partial return', () => {
  assert.deepEqual(getRibbonEligibility([true, false], 2), { complete: true, intactQuantity: 1 });
  assert.deepEqual(validateRibbonItems(order, [{ orderItemId: 11, quantity: 1, ribbonRemoved: [true, false] }]), { ok: true });
  assert.deepEqual(validateRibbonItems(order, [{ orderItemId: 11, quantity: 2, ribbonRemoved: [true, false] }]), {
    ok: false, error: RIBBON_REMOVED_MESSAGE,
  });
});

test('removed ribbons cannot be submitted, while intact items in the same order can', () => {
  assert.equal(validateRibbonItems(order, [{ orderItemId: 11, quantity: 1, ribbonRemoved: [true, true] }]).ok, false);
  assert.deepEqual(validateRibbonItems(order, [{ orderItemId: 12, quantity: 1, ribbonRemoved: [false] }]), { ok: true });
  assert.deepEqual(validateRibbonItems(order, [
    { orderItemId: 11, quantity: 1, ribbonRemoved: [true, false] },
    { orderItemId: 12, quantity: 1, ribbonRemoved: [false] },
  ]), { ok: true });
});

test('duplicate lines cannot reuse intact pieces or supply conflicting declarations', () => {
  for (const secondAnswers of [[true, false], [false, false]]) {
    assert.equal(validateRibbonItems(order, [
      { orderItemId: 11, quantity: 1, ribbonRemoved: [true, false] },
      { orderItemId: '11', quantity: 1, ribbonRemoved: secondAnswers },
    ]).ok, false);
  }
});

test('validates the actual order line quantity and identity', () => {
  assert.equal(validateRibbonItems(order, [{ orderItemId: 99, quantity: 1, ribbonRemoved: [false] }]).ok, false);
  for (const quantity of [0, -1, 1.5, 3, NaN, Infinity]) {
    assert.equal(validateRibbonItems(order, [{ orderItemId: 11, quantity, ribbonRemoved: [false, false] }]).ok, false);
  }
  for (const quantity of [0, -1, 1.5, NaN]) {
    assert.equal(getRibbonEligibility([false], quantity).complete, false);
  }
});

test('an answer correction changes eligibility without treating an unanswered piece as intact', () => {
  assert.equal(getRibbonEligibility([false, false], 2).intactQuantity, 2);
  assert.equal(getRibbonEligibility([false, true], 2).intactQuantity, 1);
  assert.equal(getRibbonEligibility([true, true], 2).intactQuantity, 0);
  assert.equal(getRibbonEligibility([false, undefined], 2).intactQuantity, 0);
});
