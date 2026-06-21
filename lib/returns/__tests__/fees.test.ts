import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateReturnFee,
  getEffectiveReturnFee,
  getProcessingFee,
  getShipmentLegFee,
  getOriginalShippingFee,
  splitReturnFee,
  RETURN_SHIPMENT_LEG_FEE,
  EXCHANGE_SHIPMENT_LEG_FEE,
} from '../fees';

test('charges two flat shipment legs per request type', () => {
  assert.equal(RETURN_SHIPMENT_LEG_FEE, 30);
  assert.equal(EXCHANGE_SHIPMENT_LEG_FEE, 20);
  assert.equal(getShipmentLegFee('return'), 30);
  assert.equal(getShipmentLegFee('exchange'), 20);
  assert.equal(getProcessingFee('return'), 60);
  assert.equal(getProcessingFee('exchange'), 40);
});

test('grosses up the original shipping by VAT when tax is not itemized', () => {
  // 26.09 net → 30.00 incl. 15% VAT
  assert.equal(getOriginalShippingFee({ shipping_cost: { amount: 26.09 } }), 30);
});

test('uses the itemized shipping tax when present', () => {
  const amounts = { shipping_cost: { amount: 30 }, shipping_tax: { amount: 4.5 } };
  assert.equal(getOriginalShippingFee(amounts), 34.5);
});

test('returns zero original shipping for free-shipping orders', () => {
  assert.equal(getOriginalShippingFee({ shipping_cost: { amount: 0 } }), 0);
  assert.equal(getOriginalShippingFee(undefined), 0);
});

test('full refund example: items 410 + shipping 30 - fee', () => {
  const amounts = { shipping_cost: { amount: 26.09 } };
  const orderTotal = 410 + getOriginalShippingFee(amounts); // 440
  assert.equal(orderTotal, 440);
  assert.equal(orderTotal - getProcessingFee('return'), 380);
  assert.equal(orderTotal - getProcessingFee('exchange'), 400);
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
