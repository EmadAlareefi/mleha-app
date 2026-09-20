import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAjexTrackingToShipments } from '../ajex-shipment-tracking';
import { normalizeAjexTrackingEvent } from '../ajex-tracking';
import { resolveShipmentLiveStatus } from '@/lib/shipment-live-status';

const delivered = {
  status: 'Delivered', statusCode: 604, trackingId: 'AJA100018430897',
  referenceId: '285837755', referenceNumber: '285837755', timezone: '+03',
  eventTime: 1789903339370, podUrls: ['https://example.com/pod.jpg'],
  location: null, failureReason: null, failureReasonCode: 0,
};

test('normalizes a delivery callback into a shipment status', () => {
  const event = normalizeAjexTrackingEvent(delivered);
  assert.ok(event);
  assert.equal(event.trackingId, 'AJA100018430897');
  assert.equal(event.referenceId, '285837755');
  assert.equal(event.eventAt.toISOString(), new Date(1789903339370).toISOString());
  assert.equal(event.status.code, '604');
  assert.equal(event.status.delivered, true);
  assert.deepEqual(event.status.podUrls, ['https://example.com/pod.jpg']);
  assert.equal(event.status.source, 'webhook');
});

test('keeps the failure reason of a failed delivery and marks it undelivered', () => {
  const event = normalizeAjexTrackingEvent({
    ...delivered, status: 'Delivery failed', statusCode: 606,
    failureReason: 'ARRIVED AT ADDRESS - NO ANSWER', podUrls: null,
  });
  assert.equal(event?.status.delivered, false);
  assert.equal(event?.status.failureReason, 'ARRIVED AT ADDRESS - NO ANSWER');
  assert.equal(event?.status.podUrls, null);
});

test('rejects callbacks without a usable waybill or event time', () => {
  for (const payload of [{ ...delivered, trackingId: '  ' }, { ...delivered, eventTime: 'x' },
    { ...delivered, eventTime: Number.NaN }]) {
    assert.equal(normalizeAjexTrackingEvent(payload), null);
  }
});

test('matches piece barcodes by prefix and skips stale callbacks', async () => {
  const calls: any[] = [];
  const client = { shipment: { updateMany: async (args: any) => { calls.push(args); return { count: 2 }; } } };
  const event = normalizeAjexTrackingEvent(delivered)!;

  assert.equal(await applyAjexTrackingToShipments(client, event), 2);
  const { where, data } = calls[0];
  assert.deepEqual(where.trackingNumber, { startsWith: 'AJA100018430897', mode: 'insensitive' });
  assert.deepEqual(where.OR, [
    { ajexLiveStatusEventAt: null },
    { ajexLiveStatusEventAt: { lte: event.eventAt } },
  ]);
  assert.equal((data.ajexLiveStatus as any).code, '604');
  assert.deepEqual(data.ajexLiveStatusEventAt, event.eventAt);
});

test('renders AJEX feeds through the same warehouse status view as SMSA', () => {
  const ajex = resolveShipmentLiveStatus({
    company: 'ajex', ajexLiveStatus: normalizeAjexTrackingEvent({
      ...delivered, status: 'Out for delivery', statusCode: 602,
    })!.status,
  });
  assert.equal(ajex?.carrier, 'ajex');
  assert.equal(ajex?.carrierLabel, 'ايجكس');
  assert.equal(ajex?.label, 'خارج للتسليم');

  const smsa = resolveShipmentLiveStatus({
    company: 'smsa', smsaLiveStatus: { code: 'DL', description: 'Delivered', delivered: true },
  });
  assert.equal(smsa?.carrier, 'smsa');
  assert.equal(smsa?.label, 'تم التسليم');

  assert.equal(resolveShipmentLiveStatus({ company: 'ajex' }), null);
});

test('falls back to the raw status text for unknown codes', () => {
  const event = normalizeAjexTrackingEvent({ ...delivered, status: 'Brand new status', statusCode: 9999 });
  assert.equal(resolveShipmentLiveStatus({ company: 'ajex', ajexLiveStatus: event!.status })?.label, 'Brand new status');
});

test('shows the failure reason as detail and never repeats the carrier wording', () => {
  const failed = normalizeAjexTrackingEvent({
    ...delivered, status: 'Delivery failed', statusCode: 606,
    failureReason: 'ARRIVED AT ADDRESS - NO ANSWER',
  })!.status;
  const view = resolveShipmentLiveStatus({ company: 'ajex', ajexLiveStatus: failed });
  assert.equal(view?.label, 'تعذر التسليم');
  assert.equal(view?.detail, 'ARRIVED AT ADDRESS - NO ANSWER');

  const ok = resolveShipmentLiveStatus({
    company: 'ajex', ajexLiveStatus: normalizeAjexTrackingEvent(delivered)!.status,
  });
  assert.equal(ok?.label, 'تم التسليم');
  assert.equal(ok?.detail, null);
});
