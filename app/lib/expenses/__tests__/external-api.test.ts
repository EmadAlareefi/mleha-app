import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expenseApiKeyAuth } from '../auth';
import { parseDateRange, parseExternalExpense } from '../external-api';

const req = (authorization?: string) => new Request('https://example.test/api/expenses', authorization ? { headers: { authorization } } : {});

test('expense API key: none without bearer, invalid when wrong or unset, valid on exact match', () => {
  const previous = process.env.EXPENSES_API_KEY;
  try {
    delete process.env.EXPENSES_API_KEY;
    assert.equal(expenseApiKeyAuth(req()), 'none');
    assert.equal(expenseApiKeyAuth(req('Basic abc')), 'none');
    assert.equal(expenseApiKeyAuth(req('Bearer anything')), 'invalid');
    process.env.EXPENSES_API_KEY = 'test-expense-key';
    for (const value of ['Bearer ', 'Bearer wrong', 'Bearer test-expense-key-more', 'Bearer test-expense-ke']) assert.equal(expenseApiKeyAuth(req(value)), 'invalid');
    assert.equal(expenseApiKeyAuth(req('Bearer test-expense-key')), 'valid');
    assert.equal(expenseApiKeyAuth(req('bearer test-expense-key')), 'valid');
  } finally { if (previous === undefined) delete process.env.EXPENSES_API_KEY; else process.env.EXPENSES_API_KEY = previous; }
});

test('from / to: date-only covers the whole Riyadh day; ISO used as-is; bad input rejected', () => {
  assert.equal(parseDateRange(null, null), undefined);
  const range = parseDateRange('2026-11-01', '2026-11-30')!;
  assert.equal(range.gte!.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(range.lte!.toISOString(), '2026-11-30T20:59:59.999Z');
  assert.equal(parseDateRange('2026-11-01T10:00:00Z', null)!.gte!.toISOString(), '2026-11-01T10:00:00.000Z');
  assert.throws(() => parseDateRange('yesterday', null), /تاريخ غير صالح/);
  assert.throws(() => parseDateRange('2026-12-01', '2026-11-01'), /قبل/);
});

test('external expense body: validated, status fields ignored, externalId trimmed', () => {
  const data = parseExternalExpense({ title: ' Fuel ', amount: '12.345', category: 'operations', externalId: ' abc-1 ', status: 'approved', approvedBy: 'x', createdBy: 'y' });
  assert.deepEqual(data, { merchantId: 'default', title: 'Fuel', description: undefined, amount: 12.35, currency: 'SAR', category: 'operations', expenseDate: data.expenseDate, notes: undefined, externalId: 'abc-1' });
  assert.ok(!('status' in data) && !('createdBy' in data) && !('approvedBy' in data));
  assert.throws(() => parseExternalExpense({ title: 'x', amount: 0, category: 'other' }), /أكبر من صفر/);
  assert.throws(() => parseExternalExpense({ title: 'x', amount: 5, category: 'nope' }), /الفئة/);
  assert.throws(() => parseExternalExpense({ title: 'x', amount: 5, category: 'other', externalId: 7 }), /externalId/);
  assert.throws(() => parseExternalExpense({ title: 'x', amount: 5, category: 'other', currency: 'riyal' }), /العملة/);
  assert.throws(() => parseExternalExpense([]), /JSON/);
});
