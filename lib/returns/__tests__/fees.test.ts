import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateReturnFee, getEffectiveReturnFee, splitReturnFee } from '../fees';

test('uses the full configured return fee', () => {
  assert.deepEqual(calculateReturnFee(34.567), {
    baseAmount: 34.57,
    effectiveFee: 34.57,
  });
  assert.equal(getEffectiveReturnFee(34.567), 34.57);
});

test('normalizes invalid or negative configured fees to zero', () => {
  assert.equal(getEffectiveReturnFee(Number.NaN), 0);
  assert.equal(getEffectiveReturnFee(-10), 0);
});

test('splits the configured fee into base and return shipment fees', () => {
  assert.deepEqual(splitReturnFee(60), {
    baseShipmentFee: 30,
    returnShipmentFee: 30,
  });
  assert.deepEqual(splitReturnFee(40), {
    baseShipmentFee: 20,
    returnShipmentFee: 20,
  });
});

test('preserves the exact total when the fee has an odd number of halalas', () => {
  assert.deepEqual(splitReturnFee(10.01), {
    baseShipmentFee: 5,
    returnShipmentFee: 5.01,
  });
});
