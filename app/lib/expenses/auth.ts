import { getServerSession, type Session } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { ExpenseError } from './domain';

export async function expenseUser(admin = false, readSession: () => Promise<Session | null> = () => getServerSession(authOptions)) {
  const session = await readSession();
  if (!session?.user) throw new ExpenseError('يجب تسجيل الدخول', 401);
  const user = session.user as { role?: string; roles?: string[]; username?: string; name?: string; id?: string };
  if (!hasServiceAccess(session, 'expenses') || (admin && user.role !== 'admin' && !user.roles?.includes('admin'))) throw new ExpenseError('لا تملك الصلاحية', 403);
  return user.username || user.name || user.id || 'admin';
}
export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const received = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return !!secret && received.length === expected.length && timingSafeEqual(received, expected);
}
export function errorResponse(error: unknown) {
  if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status });
  // Do not return or log provider payloads, credentials, or database connection details.
  console.error('Expense automation failed', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json({ error: 'تعذر إتمام العملية. حاول مرة أخرى.' }, { status: 500 });
}

export async function settingsUser(readSession: () => Promise<Session | null> = () => getServerSession(authOptions)) {
  const session = await readSession();
  if (!session?.user) throw new ExpenseError('يجب تسجيل الدخول', 401);
  if (!hasServiceAccess(session, 'settings')) throw new ExpenseError('لا تملك صلاحية الإعدادات', 403);
  const user = session.user as { id?: string; username?: string; name?: string };
  return user.id || user.username || user.name || 'staff';
}
