import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardData, BoardPacker } from '@/app/lib/order-prep/board';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import { autoTheme, clearTime, compareSoFar, idleMinutes, interventionKeys, newKeys, since, staleNote } from '@/app/admin/order-prep/live/_lib/metrics';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

test('clearTime: nothing left, and no pace to project from', () => {
  assert.deepEqual(clearTime(0, 0), { label: 'لا شيء متبقٍ', hours: 0 });
  assert.equal(clearTime(10, 0), null);
});

test('clearTime: under an hour shows minutes, and 59.6 min becomes 1 hour', () => {
  assert.equal(clearTime(5, 20)?.label, '~15 دقيقة');
  assert.equal(clearTime(1, 600)?.label, '~1 دقيقة');
  assert.equal(clearTime(99.4, 100)?.label, '~1 س');
});

test('clearTime: hours round to the quarter, never "2 س 60 د"', () => {
  assert.equal(clearTime(30, 10)?.label, '~3 س');
  assert.equal(clearTime(25, 10)?.label, '~2 س 30 د');
  assert.equal(clearTime(29.5, 10)?.label, '~3 س'); // 2.95 h
  assert.equal(clearTime(239.9, 10)?.label, '~يوم'); // 23.99 h
});

test('clearTime: days round to whole hours, never "يوم و24 س"', () => {
  assert.equal(clearTime(478, 10)?.label, '~يومان'); // 47.8 h
  assert.equal(clearTime(300, 10)?.label, '~يوم و6 س');
  assert.equal(clearTime(1000, 10)?.label, '~4 أيام و4 س');
});

test('interventionKeys covers exceptions, sync issues and shipping problems only', () => {
  const board = { exceptions: [{ id: 'e1' }], syncIssues: [{ id: 's1' }] } as unknown as BoardData;
  const shipping = { problems: [{ id: 't1' }], international: [{ id: 'i1' }], local: [{ id: 'l1' }] } as unknown as ShippingBoardData;
  assert.deepEqual(interventionKeys(board, shipping), ['ex:e1', 'sync:s1', 'shipping:t1']);
  assert.deepEqual(interventionKeys(null, null), []);
});

test('newKeys: nothing is new on first load; afterwards only unseen keys', () => {
  assert.deepEqual(newKeys(null, ['a', 'b']), []);
  assert.deepEqual(newKeys(new Set(['a']), ['a', 'b', 'c']), ['b', 'c']);
  assert.deepEqual(newKeys(new Set(['a', 'b']), ['a']), []);
});

const packer = (patch: Partial<BoardPacker> = {}): BoardPacker => ({
  userId: 'u1',
  name: 'Packer',
  current: null,
  next: null,
  completedToday: 5,
  scannedToday: 5,
  perHour: 10,
  lastCompletedAt: minutesAgo(20),
  ...patch,
});

test('idleMinutes: idle only with no order, a waiting queue and 15+ minutes since the last one', () => {
  assert.equal(idleMinutes(packer(), 8, NOW), 20);
  assert.equal(idleMinutes(packer({ lastCompletedAt: minutesAgo(14) }), 8, NOW), null);
  assert.equal(idleMinutes(packer(), 0, NOW), null);
  assert.equal(idleMinutes(packer({ current: { orderNumber: '1', minutes: 2, verifyIssue: null } }), 8, NOW), null);
  assert.equal(idleMinutes(packer({ next: { orderNumber: '2' } }), 8, NOW), null);
  assert.equal(idleMinutes(packer({ lastCompletedAt: null }), 8, NOW), null);
});

test('since formats minutes, hours and days', () => {
  assert.equal(since(null, NOW), '—');
  assert.equal(since(minutesAgo(0), NOW), 'الآن');
  assert.equal(since(minutesAgo(5), NOW), '5 د');
  assert.equal(since(minutesAgo(180), NOW), '3 س');
  assert.equal(since(minutesAgo(60 * 24), NOW), 'يوم');
  assert.equal(since(minutesAgo(60 * 48), NOW), 'يومان');
  assert.equal(since(minutesAgo(60 * 72), NOW), '3 أيام');
});

test('staleNote: null when every feed is fine, otherwise names the error', () => {
  assert.equal(staleNote({ error: null, at: NOW }), null);
  const note = staleNote({ error: null, at: NOW }, { error: 'boom', at: null });
  assert.match(note ?? '', /boom/);
  assert.match(note ?? '', /لم تُحمَّل بعد/);
});

test('compareSoFar: compares finished hours only, null before the first hour ends', () => {
  const today = [5, 5, 5, 99, 0];
  const yesterday = [4, 4, 2, 1, 50];
  assert.equal(compareSoFar(today, yesterday, 0), null);
  // currentHour 3: hours 0–2 only; today's 99 in hour 3 is in progress.
  assert.deepEqual(compareSoFar(today, yesterday, 3), { today: 15, yesterday: 10, deltaPct: 50 });
  assert.deepEqual(compareSoFar([1, 1], [0, 0], 2), { today: 2, yesterday: 0, deltaPct: null });
  assert.equal(compareSoFar([2, 2], [4, 4], 2)?.deltaPct, -50);
});

test('autoTheme: dark from 18:00 to 06:00 Riyadh time', () => {
  assert.equal(autoTheme(Date.parse('2026-11-23T14:59:00Z')), 'light'); // 17:59 Riyadh
  assert.equal(autoTheme(Date.parse('2026-11-23T15:00:00Z')), 'dark'); // 18:00 Riyadh
  assert.equal(autoTheme(Date.parse('2026-11-23T23:30:00Z')), 'dark'); // 02:30 Riyadh
  assert.equal(autoTheme(Date.parse('2026-11-24T02:59:00Z')), 'dark'); // 05:59 Riyadh
  assert.equal(autoTheme(Date.parse('2026-11-24T03:00:00Z')), 'light'); // 06:00 Riyadh
});
