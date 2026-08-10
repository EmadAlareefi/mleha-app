import { NextResponse } from 'next/server';
import { restoreNotifyMeScriptRevision } from '@/app/lib/notify-me-script';
import {
  authorizeNotifyMeScriptEditor,
  notifyMeScriptErrorResponse,
} from '../../../_shared';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeNotifyMeScriptEditor();
  if (auth.response || !auth.session?.user) return auth.response!;
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const state = await restoreNotifyMeScriptRevision({
      id,
      baseDraftVersion: body?.baseDraftVersion,
      user: auth.session.user,
    });
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return notifyMeScriptErrorResponse(error);
  }
}
