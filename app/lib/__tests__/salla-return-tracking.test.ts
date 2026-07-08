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

test('skips the original outbound tracking echoed in the action response', () => {
  // The create_return_policy response echoes the order, which still carries the
  // original outbound shipment tracking. When it is excluded and no return waybill
  // has been issued yet, no tracking number should be linked to the return request.
  assert.equal(
    extractGeneratedReturnTrackingNumber(
      {
        data: [
          {
            operation_id: 'op-123',
            action_name: 'create_return_policy',
            status: 'success',
            order: {
              shipments: [
                {
                  type: 'shipment',
                  tracking_number: 'OUTBOUND999',
                },
              ],
            },
          },
        ],
      },
      ['op-123', 'OUTBOUND999']
    ),
    null
  );
});

test('prefers the new return tracking over the excluded outbound tracking', () => {
  assert.equal(
    extractGeneratedReturnTrackingNumber(
      {
        data: [
          {
            operation_id: 'op-123',
            action_name: 'create_return_policy',
            status: 'success',
            order: {
              shipments: [{ type: 'shipment', tracking_number: 'OUTBOUND999' }],
            },
            result: {
              return_shipment: { awb_number: 'RETURN12345' },
            },
          },
        ],
      },
      ['op-123', 'OUTBOUND999']
    ),
    'RETURN12345'
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
