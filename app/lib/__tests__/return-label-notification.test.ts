import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReturnLabelTemplateArgs,
  extractReturnLabelPayload,
} from '../returns/return-label-notification';

test('extracts a return label URL and marker from nested Salla shipping shipment', () => {
  const payload = {
    shipping: {
      shipment: {
        status: 'returned',
        tracking_link: 'https://aj-ex.com/tracking?tracking_number=AJA100014616194',
        label: {
          url: 'https://labels.example/return-label.pdf',
        },
      },
    },
  };

  assert.deepEqual(extractReturnLabelPayload(payload), {
    labelUrl: 'https://labels.example/return-label.pdf',
    trackingNumber: 'AJA100014616194',
    courierName: null,
    hasReturnMarker: true,
  });
});

test('prefers a return shipment label from Salla shipments array', () => {
  const payload = {
    shipments: [
      {
        type: 'shipment',
        label_url: 'https://labels.example/outbound.pdf',
        tracking_number: 'OUTBOUND123',
      },
      {
        type: 'return',
        label_url: 'https://labels.example/return.pdf',
        tracking_number: 'RETURN123',
        courier_name: 'سمسا',
      },
    ],
  };

  const result = extractReturnLabelPayload(payload);

  assert.equal(result.labelUrl, 'https://labels.example/return.pdf');
  assert.equal(result.trackingNumber, 'RETURN123');
  assert.equal(result.courierName, 'سمسا');
  assert.equal(result.hasReturnMarker, true);
});

test('does not mark ordinary shipment payloads as return labels', () => {
  const payload = {
    shipments: [
      {
        type: 'shipment',
        status: 'shipped',
        label_url: 'https://labels.example/outbound.pdf',
      },
    ],
  };

  const result = extractReturnLabelPayload(payload);

  assert.equal(result.labelUrl, 'https://labels.example/outbound.pdf');
  assert.equal(result.hasReturnMarker, false);
});

test('builds Zoko template arguments with Arabic customer fallback', () => {
  assert.deepEqual(
    buildReturnLabelTemplateArgs({
      customerName: '',
      orderNumber: null,
      orderId: '123456',
      labelUrl: 'https://labels.example/return.pdf',
    }),
    ['عميلنا العزيز', '123456', 'https://labels.example/return.pdf']
  );
});
