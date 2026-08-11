import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import { MARKETING_SERVICE_KEY } from '@/app/lib/marketing-customers';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';

export async function authorizeMarketing() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { session: null, response: NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 }) };
  }
  if (!hasServiceAccess(session, MARKETING_SERVICE_KEY)) {
    return {
      session: null,
      response: NextResponse.json({ error: 'غير مصرح لك بإدارة حملات التسويق' }, { status: 403 }),
    };
  }
  return { session, response: null };
}

export function marketingActor(session: any) {
  const user = session?.user as Record<string, unknown> | undefined;
  return {
    id: typeof user?.id === 'string' ? user.id : null,
    name:
      (typeof user?.name === 'string' && user.name) ||
      (typeof user?.username === 'string' && user.username) ||
      (typeof user?.email === 'string' && user.email) ||
      null,
  };
}

export function marketingErrorResponse(error: unknown, fallback = 'تعذر تنفيذ طلب التسويق') {
  log.error(fallback, { error });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function positiveInteger(value: string | null, fallback: number, maximum: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}
