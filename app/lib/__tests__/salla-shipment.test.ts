import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSallaTrackingNumber } from '../salla-shipment';

test('extracts AJ-EX tracking numbers from the nested Salla shipping shipment', () => {
  assert.equal(
    extractSallaTrackingNumber({
      shipping: {
        shipment: {
          id: 'AJA100014616194',
          tracking_link: 'https://aj-ex.com/tracking?tracking_number=AJA100014616194',
        },
      },
    }),
    'AJA100014616194'
  );
});

test('prefers explicit shipment tracking numbers over nested shipment IDs', () => {
  assert.equal(
    extractSallaTrackingNumber({
      shipping: {
        shipment: {
          id: '1428063708',
        },
      },
      shipments: [
        {
          tracking_number: 'AJA100014616194',
        },
      ],
    }),
    'AJA100014616194'
  );
});

test('extracts tracking numbers from courier tracking links as a fallback', () => {
  assert.equal(
    extractSallaTrackingNumber({
      shipping: {
        shipment: {
          tracking_link: 'https://aj-ex.com/tracking?tracking_number=AJA100014616194',
        },
      },
    }),
    'AJA100014616194'
  );
});

test('prefers courier tracking links over numeric Salla shipment IDs', () => {
  assert.equal(
    extractSallaTrackingNumber({
      shipping: {
        shipment: {
          id: '1428063708',
          tracking_link: 'https://aj-ex.com/ar/shipment-status/AJA100014616194',
        },
      },
    }),
    'AJA100014616194'
  );
});
