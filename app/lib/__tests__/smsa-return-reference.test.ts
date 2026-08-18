import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractSmsaReturnOrderReference,
  hasSallaReturnShipmentMarker,
} from '../returns/smsa-return-reference';

test('extracts the order number from an SMSA reverse-shipment reference', () => {
  assert.equal(extractSmsaReturnOrderReference('R-277740122'), '277740122');
  assert.equal(extractSmsaReturnOrderReference('r_#277740122'), '277740122');
});

test('does not treat an outbound SMSA reference as a return', () => {
  assert.equal(extractSmsaReturnOrderReference('277740122'), null);
  assert.equal(extractSmsaReturnOrderReference('ORDER-277740122'), null);
});

test('recognizes nested Salla return-shipment payloads', () => {
  assert.equal(
    hasSallaReturnShipmentMarker({
      raw_payload: {
        type: 'return',
        tracking_number: '233014492438',
      },
    }),
    true
  );

  assert.equal(
    hasSallaReturnShipmentMarker({
      raw_payload: {
        type: 'normal',
        tracking_number: '291687065807',
      },
    }),
    false
  );
});
