import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';

interface AuthorizationResult {
  allowed: boolean;
  response?: NextResponse;
  session?: Awaited<ReturnType<typeof getServerSession>>;
}

export async function requireAffiliateManagementSession(): Promise<AuthorizationResult> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      allowed: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const user = session.user as any;
  const userRoles: string[] = user?.roles || [];
  const isAdmin = user?.role === 'admin' || userRoles.includes('admin');
  const serviceKeys: string[] = user?.serviceKeys || [];

  if (isAdmin || serviceKeys.includes('affiliate-management')) {
    return { allowed: true, session };
  }

  return {
    allowed: false,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  };
}
