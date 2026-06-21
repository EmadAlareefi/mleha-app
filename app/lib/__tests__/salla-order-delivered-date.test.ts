import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractDeliveredDateFromHistory,
  type SallaOrderHistoryEntry,
} from '../salla-api';

// Salla returns history timestamps as { date, timezone } objects, e.g.
//   "created_at": { "date": "2026-06-10 14:30:00.000000", "timezone": "Asia/Riyadh" }
const sallaDate = (date: string) => ({ date, timezone: 'Asia/Riyadh' });

test('returns the delivered date matched by status slug', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: { name: 'قيد التنفيذ', slug: 'in_progress' }, created_at: sallaDate('2026-06-08 09:00:00.000000') },
    { status: { name: 'تم التوصيل', slug: 'delivered' }, created_at: sallaDate('2026-06-10 14:30:00.000000') },
  ];

  const result = extractDeliveredDateFromHistory(history);
  assert.equal(result?.toISOString(), new Date('2026-06-10 14:30:00.000000'.replace(' ', 'T')).toISOString());
});

test('matches the delivered status by Arabic name when slug is missing', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: { name: 'تم التوصيل' }, created_at: sallaDate('2026-06-10 14:30:00.000000') },
  ];

  assert.ok(extractDeliveredDateFromHistory(history));
});

test('matches a string status equal to the delivered name', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: 'تم التوصيل', created_at: sallaDate('2026-06-10 14:30:00.000000') },
  ];

  assert.ok(extractDeliveredDateFromHistory(history));
});

test('returns the EARLIEST date when delivered appears more than once', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: { slug: 'delivered' }, created_at: sallaDate('2026-06-12 10:00:00.000000') },
    { status: { slug: 'delivered' }, created_at: sallaDate('2026-06-10 14:30:00.000000') },
  ];

  const result = extractDeliveredDateFromHistory(history);
  assert.equal(result?.toISOString(), new Date('2026-06-10 14:30:00.000000'.replace(' ', 'T')).toISOString());
});

test('falls back to the `created` field when `created_at` is absent', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: { slug: 'delivered' }, created: sallaDate('2026-06-10 14:30:00.000000') },
  ];

  assert.ok(extractDeliveredDateFromHistory(history));
});

test('accepts plain ISO string timestamps', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: { slug: 'delivered' }, created_at: '2026-06-10T14:30:00.000Z' },
  ];

  const result = extractDeliveredDateFromHistory(history);
  assert.equal(result?.toISOString(), '2026-06-10T14:30:00.000Z');
});

test('returns null when there is no delivered entry', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: { name: 'قيد التنفيذ', slug: 'in_progress' }, created_at: sallaDate('2026-06-08 09:00:00.000000') },
    { status: { name: 'تم الشحن', slug: 'shipped' }, created_at: sallaDate('2026-06-09 09:00:00.000000') },
  ];

  assert.equal(extractDeliveredDateFromHistory(history), null);
});

test('returns null for empty, null, or malformed input', () => {
  assert.equal(extractDeliveredDateFromHistory([]), null);
  assert.equal(extractDeliveredDateFromHistory(null), null);
  assert.equal(extractDeliveredDateFromHistory(undefined), null);
});

test('ignores delivered entries with unparseable dates', () => {
  const history: SallaOrderHistoryEntry[] = [
    { status: { slug: 'delivered' }, created_at: sallaDate('not-a-date') },
  ];

  assert.equal(extractDeliveredDateFromHistory(history), null);
});
