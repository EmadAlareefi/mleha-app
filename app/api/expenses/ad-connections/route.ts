import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { ExpenseError, provider, text, today } from '@/app/lib/expenses/domain';
export async function GET() {
  try {
    await expenseUser();
    const connections = await prisma.adInvoiceConnection.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, provider: true, billingOwnerId: true, label: true, state: true, importFrom: true, lastSuccessAt: true, lastError: true, nextAttemptAt: true, cursor: true, runs: { take: 5, orderBy: { startedAt: 'desc' } } } });
    return NextResponse.json(connections.map(({ cursor, ...connection }) => ({ ...connection, hasMore: !!cursor })));
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await expenseUser(true);
    const body = await request.json();
    const kind = provider(body.provider);
    const billingOwnerId = text(body.billingOwnerId, 'معرف حساب الفوترة', 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(billingOwnerId)) throw new ExpenseError('معرف الحساب غير صالح');
    const existing = await prisma.adInvoiceConnection.findUnique({ where: { provider_billingOwnerId: { provider: kind, billingOwnerId } } });
    if (existing) throw new ExpenseError('الحساب مسجل بالفعل؛ استخدم إعادة الربط للحفاظ على تاريخ البداية', 409);
    const result = await prisma.adInvoiceConnection.create({ data: { provider: kind, billingOwnerId, label: text(body.label, 'اسم الحساب'), importFrom: today(), createdBy: actor } });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
