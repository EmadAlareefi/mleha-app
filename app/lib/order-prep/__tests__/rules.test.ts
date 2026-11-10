import assert from 'node:assert/strict';
import test from 'node:test';
import { STATUS_IDS, SUB_STATUSES } from '@/SALLA_ORDER_STATUSES';
import { decideProblemOutcome, buildProblemNote, outcomeTargetStatusId } from '@/app/lib/order-prep/problem-rules';
import { hasSharedSku, matchScan } from '@/app/lib/order-prep/scan-match';
import {
  MAX_SYNC_ATTEMPTS,
  decideSyncAction,
  nextBackoffMs,
  parseRetryAfter,
  statusEcho,
} from '@/app/lib/order-prep/sync-rules';
import { parsePrepSettings, sanitizePrepSettingsPatch, DEFAULT_PREP_SETTINGS } from '@/app/lib/order-prep/settings';
import { parseHeldSlots, parseItemChecks, parseProblemItems } from '@/app/lib/order-prep/request-parsing';
import type { ProblemItem } from '@/app/lib/order-prep/types';

const NEW = String(STATUS_IDS.NEW_ORDER);
const IN_PROGRESS = String(STATUS_IDS.IN_PROGRESS);
const INTL = SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id;

test('packed: writes only over "طلب جديد"; an in-progress order is already done', () => {
  assert.equal(decideSyncAction('packed', NEW, STATUS_IDS.IN_PROGRESS), 'write');
  assert.equal(decideSyncAction('packed', IN_PROGRESS, STATUS_IDS.IN_PROGRESS), 'already');
  assert.equal(decideSyncAction('packed', IN_PROGRESS, INTL), 'already');
  assert.equal(decideSyncAction('packed', String(STATUS_IDS.CANCELED), STATUS_IDS.IN_PROGRESS), 'conflict');
  assert.equal(decideSyncAction('packed', String(STATUS_IDS.UNDER_REVIEW_X4), STATUS_IDS.IN_PROGRESS), 'conflict');
  assert.equal(decideSyncAction('packed', null, STATUS_IDS.IN_PROGRESS), 'conflict');
});

test('exception and requeue only move orders from the statuses they expect', () => {
  assert.equal(decideSyncAction('exception', NEW, STATUS_IDS.UNDER_REVIEW_X4), 'write');
  assert.equal(decideSyncAction('exception', String(STATUS_IDS.UNDER_REVIEW_X4), STATUS_IDS.UNDER_REVIEW_X4), 'already');
  assert.equal(decideSyncAction('exception', String(STATUS_IDS.CANCELED), STATUS_IDS.UNDER_REVIEW), 'conflict');
  assert.equal(decideSyncAction('requeue', String(STATUS_IDS.UNDER_REVIEW_X4), STATUS_IDS.NEW_ORDER), 'write');
  assert.equal(decideSyncAction('requeue', String(STATUS_IDS.UNDER_REVIEW), STATUS_IDS.NEW_ORDER), 'write');
  assert.equal(decideSyncAction('requeue', NEW, STATUS_IDS.NEW_ORDER), 'already');
  assert.equal(decideSyncAction('requeue', String(STATUS_IDS.CANCELED), STATUS_IDS.NEW_ORDER), 'conflict');
});

test('backoff grows, honours Retry-After, and the worker gives up after MAX attempts', () => {
  assert.equal(nextBackoffMs(1), 30_000);
  assert.equal(nextBackoffMs(2), 120_000);
  assert.equal(nextBackoffMs(7), 3_600_000);
  assert.equal(nextBackoffMs(1, 90_000), 90_000);
  assert.ok(MAX_SYNC_ATTEMPTS >= 5);
  assert.equal(parseRetryAfter('12'), 12_000);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000);
});

test('status echo keeps the mirror in step after a write', () => {
  assert.deepEqual(statusEcho(STATUS_IDS.IN_PROGRESS), { statusCustomId: IN_PROGRESS, statusSlug: 'in_progress', statusName: 'جاري التجهيز' });
  assert.equal(statusEcho(INTL)?.statusCustomId, String(INTL));
  assert.equal(statusEcho(STATUS_IDS.NEW_ORDER)?.statusName, 'طلب جديد');
  assert.equal(statusEcho(123), null);
});

const problem = (index: number, reason: ProblemItem['reason']): ProblemItem => ({ index, reason, sku: `S${index}`, name: `N${index}` });

test('problem outcome: coming soon/other → review; all missing → refund; some missing → partial', () => {
  assert.equal(decideProblemOutcome(1, []), null);
  assert.equal(decideProblemOutcome(1, [problem(0, 'not_found')]), 'refund');
  assert.equal(decideProblemOutcome(2, [problem(0, 'damaged'), problem(1, 'not_found')]), 'refund');
  assert.equal(decideProblemOutcome(3, [problem(1, 'not_found')]), 'partial');
  assert.equal(decideProblemOutcome(3, [problem(1, 'not_found'), problem(2, 'coming_soon')]), 'review');
  assert.equal(decideProblemOutcome(1, [problem(0, 'other')]), 'review');
  assert.equal(outcomeTargetStatusId('refund'), STATUS_IDS.UNDER_REVIEW_X4);
  assert.equal(outcomeTargetStatusId('review'), STATUS_IDS.UNDER_REVIEW);
  const note = buildProblemNote('241105', [problem(0, 'not_found')], 'الرف فارغ');
  assert.match(note, /241105/);
  assert.match(note, /غير موجود في الموقع/);
  assert.match(note, /الرف فارغ/);
});

test('scan matching: SKU confirms the dress; SKU|SIZE also confirms the size', () => {
  const items = [
    { index: 0, sku: '0115', size: 'XL', quantity: 1 },
    { index: 1, sku: '7413', size: 'M', quantity: 2 },
  ];
  assert.deepEqual(matchScan(' 0115 ', items, {}), { kind: 'match', index: 0, sizeVerified: false });
  assert.deepEqual(matchScan('7413|m', items, {}), { kind: 'match', index: 1, sizeVerified: true });
  assert.deepEqual(matchScan('7413', items, { 1: 1 }), { kind: 'match', index: 1, sizeVerified: false });
  assert.deepEqual(matchScan('7413', items, { 1: 2 }), { kind: 'already_done', index: 1 });
  assert.equal(matchScan('9999', items, {}).kind, 'mismatch');
  assert.equal(matchScan('', items, {}).kind, 'mismatch');
});

test('two lines of the same dress take scans in turn and are flagged', () => {
  const items = [
    { index: 0, sku: '0115', size: 'S', quantity: 1 },
    { index: 1, sku: '0115', size: 'L', quantity: 1 },
  ];
  assert.equal(hasSharedSku(items), true);
  assert.deepEqual(matchScan('0115', items, {}), { kind: 'match', index: 0, sizeVerified: false });
  assert.deepEqual(matchScan('0115', items, { 0: 1 }), { kind: 'match', index: 1, sizeVerified: false });
  assert.deepEqual(matchScan('0115|L', items, {}), { kind: 'match', index: 1, sizeVerified: true });
  assert.equal(hasSharedSku([items[0]]), false);
});

test('settings parse with safe defaults and validated updates', () => {
  assert.deepEqual(parsePrepSettings({}), DEFAULT_PREP_SETTINGS);
  const parsed = parsePrepSettings({
    'order_prep.priority_mode': 'regular_first',
    'order_prep.promo_aging_hours': '72',
    'order_prep.scan_mode': 'required',
    'order_prep.lease_minutes': '1',
    'order_prep.v2_enabled': 'true',
  });
  assert.equal(parsed.priorityMode, 'regular_first');
  assert.equal(parsed.promoAgingHours, 72);
  assert.equal(parsed.scanMode, 'required');
  assert.equal(parsed.leaseMinutes, 3);
  assert.equal(parsed.v2Enabled, true);
  assert.equal(parsePrepSettings({ 'order_prep.priority_mode': 'nonsense' }).priorityMode, 'oldest_first');
  assert.deepEqual(sanitizePrepSettingsPatch({ priorityMode: 'x', promoAgingHours: 0, leaseMinutes: 20, v2Enabled: 'yes' }), {
    leaseMinutes: 20,
  });
});

test('request parsing drops malformed input', () => {
  assert.deepEqual(parseHeldSlots([{ orderId: '1', slot: 'assigned' }, { orderId: '' }, { slot: 'preparing' }, null]), [
    { orderId: '1', slot: 'assigned' },
  ]);
  assert.deepEqual(parseItemChecks([{ index: 0, checked: 1, sku: 'A', method: 'scan' }, { index: -1, checked: 1 }]), [
    { index: 0, checked: 1, sku: 'A', method: 'scan' },
  ]);
  assert.deepEqual(
    parseProblemItems([
      { index: 0, reason: 'not_found', sku: 'A' },
      { index: 0, reason: 'damaged' },
      { index: 1, reason: 'bogus' },
    ]),
    [{ index: 0, reason: 'not_found', sku: 'A', name: null }],
  );
});
