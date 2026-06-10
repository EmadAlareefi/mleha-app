import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGeneratedReturnTrackingNumber,
  extractGeneratedReturnTrackingNumbers,
} from '../returns/salla-return-tracking';

test('extracts generated AJ-EX return tracking from Salla action tracking links', () => {
  assert.equal(
    extractGeneratedReturnTrackingNumber(
      {
        data: [
          {
            operation_id: 'op-123',
            action_name: 'create_return_policy',
            status: 'success',
            shipment: {
              id: '1428063708',
              tracking_link: 'https://aj-ex.com/ar/shipment-status/AJA100014616194',
            },
          },
        ],
      },
      ['1428063708', 'op-123']
    ),
    'AJA100014616194'
  );
});

test('extracts generated return awb values without using order identifiers', () => {
  assert.equal(
    extractGeneratedReturnTrackingNumber(
      {
        data: [
          {
            operation_id: 'op-123',
            result: {
              order_id: 251263484,
              return_shipment: {
                awb_number: '607123456789',
              },
            },
          },
        ],
      },
      ['251263484', 'op-123']
    ),
    '607123456789'
  );
});

test('extracts all generated return tracking candidates', () => {
  assert.deepEqual(
    extractGeneratedReturnTrackingNumbers(
      {
        operation_id: 'op-123',
        shipment: {
          tracking_link: 'https://aj-ex.com/ar/shipment-status/AJA100014616194',
        },
        result: {
          return_shipment: {
            awb_number: '607123456789',
          },
        },
      },
      ['op-123']
    ),
    ['AJA100014616194', '607123456789']
  );
});
