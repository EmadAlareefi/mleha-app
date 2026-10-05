import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type AdInvoiceConnection } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptCredentials, encryptCredentials, exchangeCredentials } from './credentials';
import { ExpenseError, expenseInstant, provider, today, withinCutoff } from './domain';
import { invoicePage, invoicePdf, type Invoice } from './providers';

export function invoiceFingerprint(invoice: Invoice) {
  return createHash('sha256').update(JSON.stringify([invoice.number, invoice.issueDate, invoice.amount, invoice.currency, invoice.billingPeriod || '', invoice.taxDetails || null, invoice.reviewReason || ''])).digest('hex');
}
export async function recordInvoice(connection: AdInvoiceConnection, invoice: Invoice, pdf: Buffer | null, documentError: string | null = null, db = prisma) {
  if (!withinCutoff(invoice.issueDate, connection.importFrom)) return 'skipped';
  const fingerprint = invoiceFingerprint(invoice);
  const identity = { provider: connection.provider, billingOwnerId: connection.billingOwnerId, providerId: invoice.id };
  const metadata = { number: invoice.number, issueDate: invoice.issueDate, amount: invoice.amount, currency: invoice.currency, billingPeriod: invoice.billingPeriod || '', taxDetails: invoice.taxDetails || {}, reviewReason: invoice.reviewReason || '' };
  return db.$transaction(async tx => {
    // Serializes manual uploads and API imports as well as import/update races.
    await tx.$queryRaw`SELECT id FROM "AdInvoiceConnection" WHERE id = ${connection.id} FOR UPDATE`;
    const existing = await tx.adImportedInvoice.findUnique({ where: { provider_billingOwnerId_providerId: identity } });
    if (existing) {
      const changed = existing.fingerprint !== fingerprint;
      await tx.adImportedInvoice.update({ where: { id: existing.id }, data: {
        ...(changed ? { state: 'review', reviewReason: 'تغيرت بيانات الفاتورة لدى المصدر؛ المصروف الأصلي لم يتغير', latestMetadata: metadata } : {}),
        ...(!changed && pdf && !existing.document ? { document: new Uint8Array(pdf), documentError: null } : {}),
        ...(!existing.document && documentError ? { documentError } : {}),
      } });
      return changed ? 'review' : 'duplicate';
    }
    await tx.adImportedInvoice.create({ data: {
      ...identity, connection: { connect: { id: connection.id } }, number: invoice.number, issueDate: invoice.issueDate, amount: invoice.amount, currency: invoice.currency, billingPeriod: invoice.billingPeriod, taxDetails: invoice.taxDetails as Prisma.InputJsonValue | undefined,
      fingerprint, state: invoice.reviewReason ? 'review' : 'imported', reviewReason: invoice.reviewReason, document: pdf ? new Uint8Array(pdf) : undefined, documentError,
      ...(invoice.reviewReason ? {} : { expense: { create: { merchantId: connection.merchantId, title: `${connection.label} — ${invoice.number}`, description: invoice.billingPeriod ? `فترة الفوترة: ${invoice.billingPeriod}` : undefined, amount: invoice.amount, currency: invoice.currency, category: 'marketing', expenseDate: expenseInstant(invoice.issueDate), source: 'ad_invoice', status: 'approved', createdBy: `system:${connection.provider}`, approvedBy: `system:connection:${connection.createdBy}`, approvedAt: new Date() } } }),
    } });
    return invoice.reviewReason ? 'review' : 'imported';
  });
}
export async function syncConnection(id: string, manual = false, db = prisma) {
  const lockToken = randomUUID();
  const now = new Date();
  const acquired = await db.adInvoiceConnection.updateMany({ where: { id, state: { in: ['active', 'error'] }, ...(manual ? {} : { nextAttemptAt: { lte: now } }), OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockToken, lockedUntil: new Date(now.getTime() + 6 * 60 * 1000) } });
  if (!acquired.count) throw new ExpenseError('الحساب غير نشط أو توجد مزامنة قيد التنفيذ', 409);
  const connection = await db.adInvoiceConnection.findUniqueOrThrow({ where: { id } });
  const run = await db.expenseSyncRun.create({ data: { connectionId: id } });
  let imported = 0;
  let reviewed = 0;
  try {
    if (!connection.encryptedCredentials) throw new ExpenseError('أعد ربط الحساب أولاً', 401);
    const kind = provider(connection.provider);
    let credentials = decryptCredentials(connection.encryptedCredentials);
    if (credentials.expiresAt && credentials.expiresAt < Date.now() + 60000) {
      if (kind !== 'snapchat' || !credentials.refreshToken) throw new ExpenseError('انتهى التفويض؛ أعد ربط الحساب', 401);
      credentials = await exchangeCredentials(kind, credentials.refreshToken, true);
      await db.adInvoiceConnection.update({ where: { id }, data: { encryptedCredentials: encryptCredentials(credentials) } });
    }
    const started = connection.syncStartedAt || now;
    // Full scan from the immutable cutoff on each completed cycle catches delayed and amended invoices.
    const page = await invoicePage(kind, connection.billingOwnerId, credentials, connection.importFrom, today(started), connection.cursor);
    for (const invoice of page.invoices) {
      if (Date.now() - now.getTime() > 180000) throw new ExpenseError('انتهت مهلة الدفعة؛ ستستكمل تلقائياً دون تكرار', 503);
      if (!withinCutoff(invoice.issueDate, connection.importFrom)) continue;
      const old = await db.adImportedInvoice.findUnique({ where: { provider_billingOwnerId_providerId: { provider: kind, billingOwnerId: connection.billingOwnerId, providerId: invoice.id } }, select: { id: true, document: true } });
      let pdf: Buffer | null = null;
      let documentError: string | null = null;
      if (!old?.document) {
        try { pdf = await invoicePdf(kind, connection.billingOwnerId, invoice, credentials); }
        catch { documentError = 'تعذر تنزيل PDF؛ ستتم إعادة المحاولة في المزامنة التالية أو يمكن رفعه يدوياً'; }
      }
      const result = await recordInvoice(connection, invoice, pdf, documentError, db);
      if (result === 'imported') imported++;
      if (result === 'review') reviewed++;
    }
    await db.adInvoiceConnection.update({ where: { id }, data: { state: 'active', lastError: null, failureCount: 0, cursor: page.next, syncStartedAt: page.next ? started : null, ...(page.next ? {} : { lastSuccessAt: now }), nextAttemptAt: new Date(now.getTime() + (page.next ? 60000 : 24 * 60 * 60 * 1000)) } });
    await db.expenseSyncRun.update({ where: { id: run.id }, data: { state: page.next ? 'partial' : 'completed', imported, reviewed, finishedAt: new Date() } });
    return { imported, reviewed, hasMore: !!page.next };
  } catch (error) {
    const message = error instanceof ExpenseError ? error.message : 'تعذرت المزامنة؛ تحقق من الربط وأعد المحاولة';
    const needsAuth = error instanceof ExpenseError && error.status === 401;
    const delay = Math.min(24 * 60, 15 * 2 ** Math.min(connection.failureCount, 7));
    await db.adInvoiceConnection.update({ where: { id }, data: { state: needsAuth ? 'reconnect' : 'error', lastError: message, failureCount: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + delay * 60000) } });
    await db.expenseSyncRun.update({ where: { id: run.id }, data: { state: 'failed', imported, reviewed, error: message, finishedAt: new Date() } });
    throw new ExpenseError(message, error instanceof ExpenseError ? error.status : 502);
  } finally {
    await db.adInvoiceConnection.updateMany({ where: { id, lockToken }, data: { lockToken: null, lockedUntil: null } });
  }
}
