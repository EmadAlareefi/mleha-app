import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateReturnFee,
  getEffectiveReturnFee,
  getProcessingFee,
  splitReturnFee,
  RETURN_FEE,
  EXCHANGE_FEE,
} from '../fees';

test('applies the flat processing fee per request type', () => {
  assert.equal(RETURN_FEE, 60);
  assert.equal(EXCHANGE_FEE, 40);
  assert.equal(getProcessingFee('return'), 60);
  assert.equal(getProcessingFee('exchange'), 40);
});

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
