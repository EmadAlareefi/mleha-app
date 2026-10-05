import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { currency, dateOnly, ExpenseError, money, text, validatePdf, withinCutoff } from '@/app/lib/expenses/domain';
import { recordInvoice } from '@/app/lib/expenses/invoices';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await expenseUser();
    const { id } = await context.params;
    const offset = Math.max(0, Number(new URL(request.url).searchParams.get('offset')) || 0);
    const invoices = await prisma.adImportedInvoice.findMany({ where: { connectionId: id }, orderBy: [{ issueDate: 'desc' }, { id: 'asc' }], take: 50, skip: offset, select: { id: true, providerId: true, number: true, issueDate: true, amount: true, currency: true, state: true, reviewReason: true, latestMetadata: true, documentError: true, expenseId: true } });
    // Return only document availability, never binary content in lists.
    const documents = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "AdImportedInvoice" WHERE "connectionId" = ${id} AND document IS NOT NULL`;
    const ids = new Set(documents.map(d => d.id));
    return NextResponse.json(invoices.map(invoice => ({ ...invoice, hasDocument: ids.has(invoice.id) })));
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await expenseUser(true);
    if (Number(request.headers.get('content-length')) > 6 * 1024 * 1024) throw new ExpenseError('الملف كبير جداً', 413);
    const { id } = await context.params;
    const connection = await prisma.adInvoiceConnection.findUnique({ where: { id } });
    if (!connection) throw new ExpenseError('الحساب غير موجود', 404);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024) throw new ExpenseError('اختر ملف PDF بحجم لا يتجاوز 5 ميجابايت');
    const pdf = validatePdf(new Uint8Array(await file.arrayBuffer()));
    const existingId = form.get('existingId');
    if (existingId) {
      const result = await prisma.adImportedInvoice.updateMany({ where: { id: text(existingId, 'الفاتورة'), connectionId: id }, data: { document: new Uint8Array(pdf), documentError: null } });
      if (!result.count) throw new ExpenseError('الفاتورة غير موجودة', 404);
      return NextResponse.json({ success: true });
    }
    const issueDate = dateOnly(form.get('issueDate'));
    if (!withinCutoff(issueDate, connection.importFrom)) throw new ExpenseError('الفاتورة تسبق تاريخ ربط الحساب');
    const result = await recordInvoice(connection, { id: text(form.get('providerId'), 'معرف الفاتورة'), number: text(form.get('number'), 'رقم الفاتورة'), issueDate, amount: money(form.get('amount')), currency: currency(form.get('currency')), billingPeriod: form.get('billingPeriod') ? text(form.get('billingPeriod'), 'فترة الفوترة') : undefined }, pdf);
    return NextResponse.json({ result }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
