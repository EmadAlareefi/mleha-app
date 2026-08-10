import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/app/lib/auth';
import {
  NotifyMeScriptConflictError,
  NotifyMeScriptInputError,
  NotifyMeScriptNotFoundError,
  NOTIFY_ME_SCRIPT_SERVICE_KEY,
} from '@/app/lib/notify-me-script';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';

export async function authorizeNotifyMeScriptEditor() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      session: null,
      response: NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 }),
    };
  }
  if (!hasServiceAccess(session, NOTIFY_ME_SCRIPT_SERVICE_KEY)) {
    return {
      session: null,
      response: NextResponse.json({ error: 'غير مصرح لك بإدارة السكربت' }, { status: 403 }),
    };
  }
  return { session, response: null };
}

export function notifyMeScriptErrorResponse(error: unknown) {
  if (error instanceof NotifyMeScriptConflictError) {
    return NextResponse.json({ error: error.message, code: 'draft_conflict' }, { status: 409 });
  }
  if (error instanceof NotifyMeScriptNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof NotifyMeScriptInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  log.error('Notify-me script editor request failed', { error });
  return NextResponse.json({ error: 'تعذر تنفيذ طلب محرر السكربت' }, { status: 500 });
}
