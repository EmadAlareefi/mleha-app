import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { getAuditUser } from '@/app/lib/audit';
import { log } from '@/app/lib/logger';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { Shipper } from './station';

/**
 * Auth for /api/shipping-v2/*. Middleware leaves that prefix public (crons
 * carry no session), so every route checks here.
 */
export async function requireShipper(): Promise<{ user: Shipper } | { response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { response: NextResponse.json({ success: false, error: { code: 'forbidden', message: 'يجب تسجيل الدخول' } }, { status: 401 }) };
  }
  if (!hasServiceAccess(session, ['order-shipping'])) {
    return {
      response: NextResponse.json({ success: false, error: { code: 'forbidden', message: 'ليست لديك صلاحية الشحن' } }, { status: 403 }),
    };
  }
  const sessionUser = session.user as { id?: string; name?: string | null; username?: string | null; role?: string };
  const audit = getAuditUser(session.user as any);
  return {
    user: {
      id: audit.id ?? sessionUser.id ?? null,
      name: audit.name || sessionUser.name || sessionUser.username || 'المستخدم',
      username: sessionUser.username ?? null,
      isSupervisor: sessionUser.role === 'admin' || hasServiceAccess(session, ['admin-order-prep']),
    },
  };
}

export function stationError(context: string, error: unknown) {
  log.error(`Shipping v2: ${context} failed`, { error: error instanceof Error ? error.message : error });
  return NextResponse.json(
    { success: false, error: { code: 'server', message: 'تعذر إتمام العملية، حاول مرة أخرى' } },
    { status: 500 },
  );
}
