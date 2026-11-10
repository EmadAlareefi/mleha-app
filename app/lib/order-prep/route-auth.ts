import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getAuditUser } from '@/app/lib/audit';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import type { PrepUser } from './queue';

/**
 * Auth for /api/order-prep/v2/*. Middleware leaves /api/order-prep public, so
 * every route checks here: a signed-in packer with the order-prep permission
 * and an OrderUser row (claims are keyed by it).
 */
export async function requirePrepUser(): Promise<{ user: PrepUser } | { response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { response: NextResponse.json({ success: false, error: { code: 'forbidden', message: 'يجب تسجيل الدخول' } }, { status: 401 }) };
  }
  if (!hasServiceAccess(session, ['order-prep'])) {
    return {
      response: NextResponse.json({ success: false, error: { code: 'forbidden', message: 'ليست لديك صلاحية للوصول' } }, { status: 403 }),
    };
  }
  const sessionUser = session.user as { id?: string; name?: string | null };
  const orderUser = sessionUser.id
    ? await prisma.orderUser.findUnique({ where: { id: sessionUser.id }, select: { id: true, name: true } })
    : null;
  if (!orderUser) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: { code: 'forbidden', message: 'هذا الحساب غير مضاف ضمن مستخدمي التحضير. يرجى إنشاء حساب تحضير خاص بك.' },
        },
        { status: 403 },
      ),
    };
  }
  return { user: { id: orderUser.id, name: orderUser.name || sessionUser.name || 'المستخدم' } };
}

/** Supervisor board: the admin-order-prep permission. */
export async function requireBoardUser(): Promise<{ actor: { id: string | null; name: string } } | { response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { response: NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 }) };
  }
  if (!hasServiceAccess(session, ['admin-order-prep'])) {
    return { response: NextResponse.json({ success: false, error: 'ليست لديك صلاحية للوصول' }, { status: 403 }) };
  }
  const audit = getAuditUser(session.user as any);
  return { actor: { id: audit.id, name: audit.name || session.user.name || 'المشرف' } };
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
