import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';

/**
 * `/api/returns` is a public middleware prefix (the customer form lives under
 * it), so every staff route guards itself with this.
 */
export async function requireReturnsStaff() {
  const session = await getServerSession(authOptions);
  if (!hasServiceAccess(session, 'returns-management')) {
    return {
      session: null,
      response: NextResponse.json({ error: 'ليست لديك صلاحية لإدارة طلبات الإرجاع' }, { status: session ? 403 : 401 }),
    } as const;
  }
  return { session, response: null } as const;
}

export function staffActorName(session: any): string {
  return session?.user?.username || session?.user?.name || session?.user?.email || 'user';
}
