import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { expenseUser, errorResponse } from '@/app/lib/expenses/auth';
import { ExpenseError, provider } from '@/app/lib/expenses/domain';
import { authorizationUrl, stateHash } from '@/app/lib/expenses/credentials';
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await expenseUser(true);
    const { id } = await context.params;
    const connection = await prisma.adInvoiceConnection.findUnique({ where: { id } });
    if (!connection) throw new ExpenseError('الحساب غير موجود', 404);
    const state = randomBytes(32).toString('hex');
    const url = await authorizationUrl(provider(connection.provider), state);
    await prisma.adInvoiceConnection.update({ where: { id }, data: { oauthStateHash: stateHash(state), oauthExpiresAt: new Date(Date.now() + 10 * 60000) } });
    const response = NextResponse.json({ url });
    response.cookies.set('expense_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/expenses/ad-connections/callback', maxAge: 600 });
    return response;
  } catch (e) { return errorResponse(e); }
}
