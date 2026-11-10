import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideCreate,
  decidePrint,
  extractLabelUrl,
  initialState,
  nextBackoffMs,
  normalizeCode,
  routeMethod,
} from '@/app/lib/shipping/rules';
import { parseShippingSettings, sanitizeShippingSettingsPatch } from '@/app/lib/shipping/settings';

test('routeMethod: international, local agent, courier', () => {
  assert.equal(routeMethod({ isInternational: true, shippingCompany: 'DHL Express' }), 'international');
  assert.equal(routeMethod({ isInternational: false, shippingCompany: 'مندوب توصيل - جدة' }), 'local');
  assert.equal(routeMethod({ isInternational: false, shippingCompany: 'إيجكس' }), 'salla');
  assert.equal(routeMethod({ isInternational: false, shippingCompany: 'سمسا' }), 'salla');
  assert.equal(routeMethod({ isInternational: false, shippingCompany: null }), 'salla');
  // International wins even if the company text mentions an agent.
  assert.equal(routeMethod({ isInternational: true, shippingCompany: 'مندوب' }), 'international');
});

test('initialState per method', () => {
  assert.equal(initialState('salla'), 'queued');
  assert.equal(initialState('local'), 'needs_agent');
  assert.equal(initialState('international'), 'manual_international');
});

test('decideCreate: compare-and-set before asking Salla', () => {
  // Packed (جاري التجهيز / الدولي) → create.
  assert.deepEqual(decideCreate({ liveStatusId: '1956875584', hasLabel: false, manual: false }), { action: 'create' });
  assert.deepEqual(decideCreate({ liveStatusId: '523521855', hasLabel: false, manual: false }), { action: 'create' });
  // A label already on the order is adopted, whatever the status.
  assert.deepEqual(decideCreate({ liveStatusId: '1956875584', hasLabel: true, manual: false }), { action: 'adopt' });
  assert.deepEqual(decideCreate({ liveStatusId: '758513988', hasLabel: true, manual: false }), { action: 'adopt' });
  // Already completed/shipped without a label yet: wait for it, don't create another.
  assert.deepEqual(decideCreate({ liveStatusId: '758513988', hasLabel: false, manual: false }), { action: 'wait_label' });
  assert.deepEqual(decideCreate({ liveStatusId: '165947469', hasLabel: false, manual: false }), { action: 'wait_label' });
  // New order: only when a shipper asked for it at the station.
  assert.equal(decideCreate({ liveStatusId: '449146439', hasLabel: false, manual: false }).action, 'block');
  assert.deepEqual(decideCreate({ liveStatusId: '449146439', hasLabel: false, manual: true }), { action: 'create' });
  // Cancelled / review / unknown → a person decides.
  const cancelled = decideCreate({ liveStatusId: '1183362113', liveStatusName: 'ملغي', hasLabel: false, manual: true });
  assert.equal(cancelled.action, 'block');
  assert.match((cancelled as { reason: string }).reason, /ملغي/);
  assert.equal(decideCreate({ liveStatusId: '2046404155', hasLabel: false, manual: false }).action, 'block');
  assert.equal(decideCreate({ liveStatusId: null, hasLabel: false, manual: false }).action, 'block');
});

test('extractLabelUrl: shipping.shipment and shipments[]', () => {
  assert.equal(extractLabelUrl({ shipping: { shipment: { label: { url: 'https://x/a.pdf' } } } }), 'https://x/a.pdf');
  assert.equal(extractLabelUrl({ shipping: { shipment: { label_url: ' https://x/b.pdf ' } } }), 'https://x/b.pdf');
  assert.equal(extractLabelUrl({ shipping: { shipment: { id: null, label: null } }, shipments: [{ label: { url: 'https://x/c.pdf' } }] }), 'https://x/c.pdf');
  assert.equal(extractLabelUrl({ shipping: { shipment: { id: null } } }), null);
  assert.equal(extractLabelUrl(null), null);
  assert.equal(extractLabelUrl({ shipments: [{ label: '' }] }), null);
});

test('normalizeCode: Arabic digits, #, spaces', () => {
  assert.equal(normalizeCode('٢٩٨٠٩٤٢١٣'), '298094213');
  assert.equal(normalizeCode(' #298094213 '), '298094213');
  assert.equal(normalizeCode('298 094 213'), '298094213');
  assert.equal(normalizeCode('۲۹۸'), '298');
  assert.equal(normalizeCode('12'), null);
  assert.equal(normalizeCode(''), null);
});

test('decidePrint: do-not-ship, missing label, reprint rule', () => {
  const base = { state: 'label_ready' as const, hasLabel: true, printCount: 0, doNotShip: false, isSupervisor: false };
  assert.deepEqual(decidePrint(base), { ok: true, reprint: false });
  assert.equal((decidePrint({ ...base, doNotShip: true }) as { code: string }).code, 'do_not_ship');
  assert.equal((decidePrint({ ...base, doNotShip: true, isSupervisor: true }) as { code: string }).code, 'do_not_ship');
  assert.equal((decidePrint({ ...base, hasLabel: false }) as { code: string }).code, 'no_label');
  assert.equal((decidePrint({ ...base, state: 'blocked' }) as { code: string }).code, 'blocked');
  assert.equal((decidePrint({ ...base, state: 'printed', printCount: 1 }) as { code: string }).code, 'reprint_needs_supervisor');
  assert.deepEqual(decidePrint({ ...base, state: 'printed', printCount: 1, isSupervisor: true }), { ok: true, reprint: true });
  // International orders print once their DHL label exists.
  assert.deepEqual(decidePrint({ ...base, state: 'manual_international' }), { ok: true, reprint: false });
});

test('backoff grows and honours Retry-After', () => {
  assert.equal(nextBackoffMs(1), 30_000);
  assert.equal(nextBackoffMs(2), 120_000);
  assert.equal(nextBackoffMs(9), 3_600_000);
  assert.equal(nextBackoffMs(1, 90_000), 90_000);
});

test('settings parse and sanitize', () => {
  assert.deepEqual(parseShippingSettings({}), { v2Enabled: false, precreateEnabled: false });
  assert.deepEqual(parseShippingSettings({ 'shipping.v2_enabled': 'true', 'shipping.precreate_enabled': '1' }), {
    v2Enabled: true,
    precreateEnabled: true,
  });
  assert.deepEqual(sanitizeShippingSettingsPatch({ v2Enabled: true, precreateEnabled: 'yes', other: 1 }), { v2Enabled: true });
});

test('pickOutgoingShipment: skips returns, cancelled and label-less entries', async () => {
  const { pickOutgoingShipment } = await import('@/app/lib/shipping/rules');
  const outgoing = {
    id: 1,
    type: 'shipment',
    status: 'created',
    label: { format: 'pdf', url: 'https://cdn.salla.sa/shipping-policy/1.pdf' },
    tracking_number: '291743260130',
    courier_name: 'سمسا',
  };
  assert.equal(pickOutgoingShipment([outgoing])?.labelUrl, 'https://cdn.salla.sa/shipping-policy/1.pdf');
  assert.equal(pickOutgoingShipment([outgoing])?.trackingNumber, '291743260130');
  assert.equal(pickOutgoingShipment([{ ...outgoing, type: 'return' }]), null);
  assert.equal(pickOutgoingShipment([{ ...outgoing, status: 'cancelled' }]), null);
  assert.equal(pickOutgoingShipment([{ ...outgoing, label: null }]), null);
  assert.equal(pickOutgoingShipment([{ ...outgoing, type: 'return' }, { ...outgoing, id: 2 }])?.id, '2');
  assert.equal(pickOutgoingShipment(null), null);
});

test('canRetryAtStation: failed, or a label late by 3+ minutes', async () => {
  const { canRetryAtStation } = await import('@/app/lib/shipping/rules');
  const now = Date.UTC(2026, 10, 10, 18, 0);
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  assert.equal(canRetryAtStation({ state: 'failed', creatingAt: null, nowMs: now }), true);
  assert.equal(canRetryAtStation({ state: 'awaiting_label', creatingAt: ago(1), nowMs: now }), false);
  assert.equal(canRetryAtStation({ state: 'awaiting_label', creatingAt: ago(3), nowMs: now }), true);
  assert.equal(canRetryAtStation({ state: 'awaiting_label', creatingAt: null, nowMs: now }), false);
  assert.equal(canRetryAtStation({ state: 'creating', creatingAt: ago(20), nowMs: now }), false);
  assert.equal(canRetryAtStation({ state: 'label_ready', creatingAt: ago(20), nowMs: now }), false);
});
