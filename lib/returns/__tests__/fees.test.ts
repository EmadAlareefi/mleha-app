import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateReturnFee,
  getEffectiveReturnFee,
  getProcessingFee,
  getOriginalShippingFee,
  splitReturnFee,
  RETURN_SHIPMENT_LEG_FEE,
  EXCHANGE_SHIPMENT_LEG_FEE,
} from '../fees';

test('charges only the flat return-leg fee when shipping is unknown or free', () => {
  assert.equal(RETURN_SHIPMENT_LEG_FEE, 30);
  assert.equal(EXCHANGE_SHIPMENT_LEG_FEE, 10);
  assert.equal(getProcessingFee('return'), 30);
  assert.equal(getProcessingFee('exchange'), 10);
  assert.equal(getProcessingFee('return', { shipping_cost: { amount: 0 } }), 30);
});

test('adds the original outbound shipping the customer paid to the fee', () => {
  const amounts = { shipping_cost: { amount: 30 }, shipping_tax: { amount: 4.5 } };
  assert.equal(getOriginalShippingFee(amounts), 34.5);
  assert.equal(getProcessingFee('return', amounts), 64.5);
  assert.equal(getProcessingFee('exchange', amounts), 44.5);
});

test('parses string shipping amounts', () => {
  const amounts = { shipping_cost: { amount: '25' }, shipping_tax: { amount: '3.75' } };
  assert.equal(getOriginalShippingFee(amounts), 28.75);
  assert.equal(getProcessingFee('return', amounts), 58.75);
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
