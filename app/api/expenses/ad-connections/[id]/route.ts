import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { ExpenseError, provider, text } from '@/app/lib/expenses/domain';
import { encryptCredentials } from '@/app/lib/expenses/credentials';
import { checkInvoiceAccess } from '@/app/lib/expenses/providers';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await expenseUser(true);
    const { id } = await context.params;
    const body = await request.json();
    const connection = await prisma.adInvoiceConnection.findUnique({ where: { id } });
    if (!connection) throw new ExpenseError('الحساب غير موجود', 404);
    if (connection.lockedUntil && connection.lockedUntil > new Date()) throw new ExpenseError('انتظر انتهاء المزامنة', 409);
    const save = async (data: Parameters<typeof prisma.adInvoiceConnection.updateMany>[0]['data']) => {
      const result = await prisma.adInvoiceConnection.updateMany({ where: { id, updatedAt: connection.updatedAt, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data });
      if (!result.count) throw new ExpenseError('تغير الحساب أو بدأت مزامنة؛ أعد المحاولة', 409);
    };
    if (body.action === 'disconnect') {
      await save({ state: 'disconnected', encryptedCredentials: null, oauthStateHash: null, oauthExpiresAt: null });
    } else if (body.action === 'manual') {
      await save({ state: 'manual', encryptedCredentials: null, lastError: 'هذا الحساب يستخدم رفع الفواتير يدوياً', oauthStateHash: null, oauthExpiresAt: null });
    } else if (body.action === 'token') {
      const credentials = { accessToken: text(body.accessToken, 'رمز الوصول', 8000), ...(body.refreshToken ? { refreshToken: text(body.refreshToken, 'رمز التجديد', 8000) } : {}) };
      const encrypted = encryptCredentials(credentials);
      await checkInvoiceAccess(provider(connection.provider), connection.billingOwnerId, credentials, connection.importFrom);
      await save({ encryptedCredentials: encrypted, state: 'active', nextAttemptAt: new Date(), lastError: null, failureCount: 0 });
    } else throw new ExpenseError('الإجراء غير صالح');
    return NextResponse.json({ success: true });
  } catch (e) { return errorResponse(e); }
}
