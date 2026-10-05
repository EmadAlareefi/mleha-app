import { afterEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, type AdInvoiceConnection } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { dateOnly, expenseInstant, money, nextOccurrence, subscriptionInput, today, validatePdf, withinCutoff } from '../domain';
import { decryptCredentials, encryptCredentials } from '../credentials';
import { invoicePage, invoicePdf, normalizeInvoice } from '../providers';
import { processSubscriptions, updateSubscription } from '../subscriptions';
import { recordInvoice, syncConnection } from '../invoices';

afterEach(() => mock.restoreAll());
test('Riyadh midnight and calendar validation', () => {
  assert.equal(today(new Date('2026-10-04T21:00:00Z')), '2026-10-05');
  assert.equal(expenseInstant('2026-10-05').toISOString(), '2026-10-04T21:00:00.000Z');
  assert.throws(() => dateOnly('2026-02-30'));
  assert.throws(() => money('NaN'));
  assert.throws(() => money('1.234'));
  assert.throws(() => money('-1'));
  assert.equal(money('99999999.99'), '99999999.99');
});
test('month-end and leap-day schedules retain their original anchor', () => {
  assert.equal(nextOccurrence('2024-01-31', 'monthly', '2024-01-31'), '2024-02-29');
  assert.equal(nextOccurrence('2024-01-31', 'monthly', '2024-02-29'), '2024-03-31');
  assert.equal(nextOccurrence('2024-02-29', 'yearly', '2024-02-29'), '2025-02-28');
  assert.equal(nextOccurrence('2024-02-29', 'yearly', '2027-02-28'), '2028-02-29');
  assert.equal(nextOccurrence('2024-01-31', 'monthly', '2026-10-05'), '2026-10-31');
  assert.equal(nextOccurrence('2027-01-01', 'monthly', '2026-10-05'), '2027-01-01');
});
test('subscription validation and import cutoff', () => {
  const input = { title: 'Hosting', amount: '10.00', currency: 'SAR', category: 'operations', frequency: 'monthly', startDate: '2026-10-05' };
  assert.equal(subscriptionInput(input).amount, '10.00');
  assert.throws(() => subscriptionInput({ ...input, endDate: '2026-10-04' }));
  assert.throws(() => subscriptionInput({ ...input, frequency: 'daily' }));
  assert.equal(withinCutoff('2026-10-05', '2026-10-05'), true);
  assert.equal(withinCutoff('2026-10-04', '2026-10-05'), false);
});
test('credentials are encrypted and tampering is rejected', () => {
  const previous = process.env.EXPENSE_CREDENTIAL_KEY;
  process.env.EXPENSE_CREDENTIAL_KEY = 'ab'.repeat(32);
  try {
    const secret = { accessToken: 'never-plaintext', refreshToken: 'refresh' };
    const encrypted = encryptCredentials(secret);
    assert.ok(!encrypted.includes(secret.accessToken));
    assert.deepEqual(decryptCredentials(encrypted), secret);
    const parts = encrypted.split('.'); parts[1] = Buffer.alloc(16).toString('base64');
    assert.throws(() => decryptCredentials(parts.join('.')));
  } finally { if (previous === undefined) delete process.env.EXPENSE_CREDENTIAL_KEY; else process.env.EXPENSE_CREDENTIAL_KEY = previous; }
});
const meta = { id: 'graph-id', invoice_id: 'inv-1', invoice_date: '2026-10-05T00:00:00Z', billed_amount_details: { total_amount: '115.00', tax_amount: '15.00', currency: 'SAR' }, billing_period: '2026-09', type: 'Invoice' };
test('provider adapters preserve totals, tax, invoice IDs, and flag credit notes', () => {
  const invoice = normalizeInvoice('meta', meta);
  assert.equal(invoice.amount, '115.00'); assert.equal(invoice.taxDetails?.tax, '15.00'); assert.equal(invoice.id, 'graph-id');
  const snap = normalizeInvoice('snapchat', { invoice_id: 'snap-1', document_number: '123', created_at: '2026-10-05', amount_cent: 132095, currency: 'USD' });
  assert.equal(snap.amount, '1320.95');
  const tiktok = normalizeInvoice('tiktok', { invoice_id: 'tt-1', invoice_date: '2026-10-05', total_amount: '120.00', currency: 'USD', invoice_type: 'CREDIT' });
  assert.ok(tiktok.reviewReason);
  assert.throws(() => normalizeInvoice('meta', { ...meta, invoice_date: undefined }));
  assert.throws(() => normalizeInvoice('tiktok', { invoice_id: 'tt-1', spend: 120, currency: 'USD' }));
});
test('Meta pagination uses a cursor without forwarding provider next URLs', async () => {
  const calls: URL[] = [];
  mock.method(globalThis, 'fetch', async (url: URL) => {
    calls.push(url);
    return Response.json({ data: [meta], paging: { next: 'https://untrusted.invalid?access_token=secret', cursors: { after: 'page-2' } } });
  });
  const result = await invoicePage('meta', 'business-1', { accessToken: 'test' }, '2026-10-05', '2026-10-06', 'page-1');
  assert.equal(result.next, 'page-2'); assert.equal(calls[0].hostname, 'graph.facebook.com'); assert.equal(calls[0].searchParams.get('after'), 'page-1');
});
test('TikTok pagination, missing response schema and rate-limit handling', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { invoice_list: [{ invoice_id: 'tt-1', invoice_date: '2026-10-05', total_amount: '120.00', currency: 'USD' }], page_info: { total_page: 2 } } }));
  const result = await invoicePage('tiktok', 'bc', { accessToken: 'test' }, '2026-10-05', '2026-10-06');
  assert.equal(result.next, '2');
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: {} }));
  await assert.rejects(invoicePage('tiktok', 'bc', { accessToken: 'test' }, '2026-10-05', '2026-10-06'));
  mock.restoreAll();
  mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  await assert.rejects(invoicePage('meta', 'bc', { accessToken: 'test' }, '2026-10-05', '2026-10-06'), /حد طلبات/);
});
test('PDF validation and untrusted download URLs', async () => {
  assert.throws(() => validatePdf(Buffer.from('<html>not a pdf')));
  assert.throws(() => validatePdf(Buffer.alloc(6 * 1024 * 1024)));
  await assert.rejects(invoicePdf('meta', 'owner', { ...normalizeInvoice('meta', meta), pdfUrl: 'http://127.0.0.1/internal' }));
  mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.searchParams.get('include_pdf'), 'true');
    return Response.json({ request_status: 'SUCCESS', invoices: [{ invoice: { invoice_content: Buffer.from('%PDF-1.4 fixture').toString('base64') } }] });
  });
  assert.ok((await invoicePdf('snapchat', 'owner', normalizeInvoice('meta', meta), { accessToken: 'test' }))?.toString().startsWith('%PDF-'));
});

// In-memory transactional doubles verify persistence decisions without contacting a live database.
test('scheduler catches up, stops at end date, and never recreates a deleted occurrence', async () => {
  const subscription = { id: 's1', title: 'Hosting', merchantId: 'default', amount: new Prisma.Decimal('20'), currency: 'SAR', category: 'operations', notes: null, startDate: '2026-01-31', nextDate: '2026-01-31', endDate: '2026-03-31', state: 'active', frequency: 'monthly', createdBy: 'admin' };
  const occurrences = new Set(['2026-01-31']);
  const created: Prisma.ExpenseOccurrenceCreateInput[] = [];
  const tx = {
    $queryRaw: async () => subscription.state === 'active' && subscription.nextDate <= '2026-04-05' ? [{ id: subscription.id }] : [],
    expenseSubscription: { findUniqueOrThrow: async () => ({ ...subscription }), update: async ({ data }: { data: Partial<typeof subscription> }) => Object.assign(subscription, data) },
    expenseOccurrence: { findUnique: async ({ where }: { where: { subscriptionId_dueDate: { dueDate: string } } }) => occurrences.has(where.subscriptionId_dueDate.dueDate) ? { expenseId: null } : null,
      create: async ({ data }: { data: Prisma.ExpenseOccurrenceCreateInput }) => { created.push(data); occurrences.add(data.dueDate); } },
  };
  const db = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx), expenseSubscription: { count: async () => 0 } } as unknown as typeof prisma;
  assert.equal((await processSubscriptions(new Date('2026-04-05T00:00:00Z'), 100, db)).created, 2);
  assert.deepEqual(created.map(c => c.dueDate), ['2026-02-28', '2026-03-31']);
  assert.equal(created[0].expense?.create?.status, 'approved');
  assert.equal(subscription.state, 'completed');
  assert.equal((await processSubscriptions(new Date('2026-04-05T00:00:00Z'), 100, db)).created, 0);
});
test('resume skips paused periods; edits cannot rewrite an outstanding occurrence', async () => {
  const old = { id: 's1', state: 'paused', startDate: '2024-01-31', frequency: 'monthly', endDate: null, nextDate: '2024-02-29' };
  const tx = { $queryRaw: async () => [], expenseSubscription: { findUnique: async () => old, update: async ({ data }: { data: unknown }) => data } };
  const db = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx), expenseSubscription: { count: async () => 0 } } as unknown as typeof prisma;
  const resumed = await updateSubscription('s1', { action: 'resume' }, db);
  assert.equal(resumed.nextDate, nextOccurrence(old.startDate, old.frequency, today()));
  assert.equal(resumed.state, 'active');
});
test('invoice import preserves dedupe tombstones and flags amendments without editing approved expense', async () => {
  const connection = { id: 'c1', provider: 'meta', billingOwnerId: 'business', importFrom: '2026-10-05', merchantId: 'default', label: 'Ads', createdBy: 'admin' } as AdInvoiceConnection;
  let stored: Record<string, unknown> | null = null;
  let creations = 0;
  const tx = { $queryRaw: async () => [], adImportedInvoice: {
    findUnique: async () => stored,
    create: async ({ data }: { data: Record<string, unknown> }) => { creations++; stored = { ...data, id: 'i1', expenseId: null }; },
    update: async ({ data }: { data: Record<string, unknown> }) => { stored = { ...stored, ...data }; },
  } };
  const db = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx), expenseSubscription: { count: async () => 0 } } as unknown as typeof prisma;
  const invoice = normalizeInvoice('meta', meta);
  assert.equal(await recordInvoice(connection, invoice, null, null, db), 'imported');
  assert.equal(await recordInvoice(connection, invoice, null, null, db), 'duplicate');
  assert.equal(creations, 1);
  assert.equal(await recordInvoice(connection, { ...invoice, amount: '116.00' }, null, null, db), 'review');
  assert.equal(creations, 1);
  assert.equal((stored as unknown as { amount: string }).amount, '115.00');
  assert.equal(await recordInvoice(connection, { ...invoice, id: 'old', issueDate: '2026-10-04' }, null, null, db), 'skipped');
});
test('sync refuses a second worker when the connection lease is held', async () => {
  const db = { adInvoiceConnection: { updateMany: async () => ({ count: 0 }) } } as unknown as typeof prisma;
  await assert.rejects(syncConnection('c1', false, db), /مزامنة قيد التنفيذ/);
});

test('expired authorization marks reconnect, preserves cursor, records failure and releases lease', async () => {
  const previous = process.env.EXPENSE_CREDENTIAL_KEY;
  process.env.EXPENSE_CREDENTIAL_KEY = 'ab'.repeat(32);
  try {
    const updates: Record<string, unknown>[] = [];
    const runUpdates: Record<string, unknown>[] = [];
    const db = {
      adInvoiceConnection: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { count: 1 }; },
        findUniqueOrThrow: async () => ({ id: 'c1', provider: 'meta', encryptedCredentials: encryptCredentials({ accessToken: 'expired', expiresAt: 1 }), failureCount: 0, cursor: 'saved-page' }),
        update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); },
      },
      expenseSyncRun: { create: async () => ({ id: 'run-1' }), update: async ({ data }: { data: Record<string, unknown> }) => { runUpdates.push(data); } },
    } as unknown as typeof prisma;
    await assert.rejects(syncConnection('c1', false, db), /انتهى التفويض/);
    assert.ok(updates.some(update => update.state === 'reconnect'));
    assert.equal(updates.at(-1)?.lockToken, null);
    assert.ok(!updates.some(update => 'cursor' in update));
    assert.equal(runUpdates[0].state, 'failed');
  } finally { if (previous === undefined) delete process.env.EXPENSE_CREDENTIAL_KEY; else process.env.EXPENSE_CREDENTIAL_KEY = previous; }
});
test('rate limited sync schedules a retry and preserves pagination', async () => {
  const previous = process.env.EXPENSE_CREDENTIAL_KEY;
  process.env.EXPENSE_CREDENTIAL_KEY = 'ab'.repeat(32);
  try {
    let failure: Record<string, unknown> = {};
    const db = {
      adInvoiceConnection: {
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({ id: 'c1', provider: 'meta', billingOwnerId: 'business', importFrom: '2026-10-05', encryptedCredentials: encryptCredentials({ accessToken: 'token' }), failureCount: 2, cursor: 'page-2', syncStartedAt: null }),
        update: async ({ data }: { data: Record<string, unknown> }) => { failure = data; },
      },
      expenseSyncRun: { create: async () => ({ id: 'run-1' }), update: async () => ({}) },
    } as unknown as typeof prisma;
    mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
    const before = Date.now();
    await assert.rejects(syncConnection('c1', false, db), /حد طلبات/);
    assert.equal(failure.state, 'error');
    assert.ok((failure.nextAttemptAt as Date).getTime() >= before + 60 * 60000);
    assert.equal('cursor' in failure, false);
  } finally { if (previous === undefined) delete process.env.EXPENSE_CREDENTIAL_KEY; else process.env.EXPENSE_CREDENTIAL_KEY = previous; }
});
test('credit invoice creates only a review record, with no approved expense', async () => {
  const connection = { id: 'c1', provider: 'meta', billingOwnerId: 'business', importFrom: '2026-10-05', merchantId: 'default', label: 'Ads', createdBy: 'admin' } as AdInvoiceConnection;
  let saved: Record<string, unknown> = {};
  const tx = { $queryRaw: async () => [], adImportedInvoice: { findUnique: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => { saved = data; } } };
  const db = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) } as unknown as typeof prisma;
  assert.equal(await recordInvoice(connection, normalizeInvoice('meta', { ...meta, type: 'Credit Memo' }), null, null, db), 'review');
  assert.equal('expense' in saved, false);
  assert.equal(saved.state, 'review');
});
test('Snapchat pagination is stable and honors the original date cutoff', async () => {
  const list = Array.from({ length: 30 }, (_, index) => ({ sub_request_status: 'SUCCESS', invoice: { invoice_id: `snap-${String(index).padStart(2, '0')}`, document_number: String(index), created_at: '2026-10-05T10:00:00Z', amount_cent: 1200, currency: 'USD' } }));
  list.push({ sub_request_status: 'SUCCESS', invoice: { invoice_id: 'old', document_number: 'old', created_at: '2026-10-04T10:00:00Z', amount_cent: 1200, currency: 'USD' } });
  mock.method(globalThis, 'fetch', async () => Response.json({ request_status: 'SUCCESS', invoices: list }));
  const first = await invoicePage('snapchat', 'account', { accessToken: 'test' }, '2026-10-05', '2026-10-06');
  const second = await invoicePage('snapchat', 'account', { accessToken: 'test' }, '2026-10-05', '2026-10-06', first.next);
  assert.equal(first.invoices.length, 25);
  assert.equal(second.invoices.length, 5);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.invoices, ...second.invoices].map(i => i.id)).size, 30);
});
