import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { ExpenseError, provider, text } from '@/app/lib/expenses/domain';
import { encryptCredentials, exchangeCredentials, stateHash } from '@/app/lib/expenses/credentials';
import { checkInvoiceAccess } from '@/app/lib/expenses/providers';
export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    await expenseUser(true);
    const kind = provider((await context.params).provider);
    const state = request.nextUrl.searchParams.get('state');
    if (!state || state !== request.cookies.get('expense_oauth_state')?.value) throw new ExpenseError('طلب تفويض غير صالح', 403);
    const connection = await prisma.adInvoiceConnection.findFirst({ where: { provider: kind, oauthStateHash: stateHash(state), oauthExpiresAt: { gt: new Date() } } });
    if (!connection) throw new ExpenseError('انتهت صلاحية التفويض؛ أعد المحاولة', 403);
    try {
      const code = text(request.nextUrl.searchParams.get(kind === 'tiktok' ? 'auth_code' : 'code'), 'رمز التفويض', 8000);
      const credentials = await exchangeCredentials(kind, code);
      await checkInvoiceAccess(kind, connection.billingOwnerId, credentials, connection.importFrom);
      const saved = await prisma.adInvoiceConnection.updateMany({ where: { id: connection.id, oauthStateHash: stateHash(state), OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { oauthStateHash: null, oauthExpiresAt: null, encryptedCredentials: encryptCredentials(credentials), state: 'active', lastError: null, nextAttemptAt: new Date(), failureCount: 0 } });
      if (!saved.count) throw new ExpenseError('تغير الحساب أو بدأت مزامنة؛ أعد الربط بعد انتهائها', 409);
    } catch (e) {
      await prisma.adInvoiceConnection.updateMany({ where: { id: connection.id, oauthStateHash: stateHash(state), OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { oauthStateHash: null, oauthExpiresAt: null, state: 'reconnect', lastError: e instanceof ExpenseError ? e.message : 'فشل الربط؛ تحقق من الصلاحيات أو استخدم الرفع اليدوي' } });
    }
    const response = NextResponse.redirect(new URL('/expenses?tab=ads', process.env.NEXTAUTH_URL));
    response.cookies.delete({ name: 'expense_oauth_state', path: '/api/expenses/ad-connections/callback' });
    return response;
  } catch (e) { return errorResponse(e); }
}
