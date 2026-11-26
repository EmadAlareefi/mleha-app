import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smsaScanTime } from '../carrier-movements';
import { normalizeShipments, smsaScanKey } from '../smsa-webhook-payload';

test('smsaScanTime joins SMSA local time with its offset', () => {
  assert.equal(smsaScanTime('2026-11-26T15:40:00', '+03:00')?.toISOString(), '2026-11-26T12:40:00.000Z');
  assert.equal(smsaScanTime('2026-11-26 15:40:00', '+03:00')?.toISOString(), '2026-11-26T12:40:00.000Z');
});

test('smsaScanTime keeps an explicit offset and rejects junk', () => {
  assert.equal(smsaScanTime('2026-11-26T15:40:00Z', '+03:00')?.toISOString(), '2026-11-26T15:40:00.000Z');
  assert.equal(smsaScanTime('not a date', '+03:00'), null);
  assert.equal(smsaScanTime(null, null), null);
});

test('smsaScanKey treats a resent scan as the same scan', () => {
  const a = { scanType: 'PU', scanDateTime: '2026-11-26T15:40:00', scanDescription: 'Shipment Picked up' };
  assert.equal(smsaScanKey(a), smsaScanKey({ ...a, scanDescription: 'shipment picked up' }));
  assert.notEqual(smsaScanKey(a), smsaScanKey({ ...a, scanType: 'DL' }));
});

test('normalizeShipments reads AWB and scans from an SMSA post', () => {
  const [shipment] = normalizeShipments([{ AWB: '2917', Scans: [{ ScanType: 'PU', ScanDescription: 'Picked up', ScanDateTime: '2026-11-26T15:40:00', ScanTimeZone: '+03:00', City: 'Jeddah' }] }]);
  assert.equal(shipment.awb, '2917');
  assert.equal(shipment.scans[0].scanType, 'PU');
  assert.equal(shipment.scans[0].city, 'Jeddah');
});
