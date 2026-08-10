import { NextResponse } from 'next/server';
import { getNotifyMeScriptRevision } from '@/app/lib/notify-me-script';
import {
  authorizeNotifyMeScriptEditor,
  notifyMeScriptErrorResponse,
} from '../../_shared';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authorizeNotifyMeScriptEditor();
  if (auth.response) return auth.response;
  try {
    const { id } = await context.params;
    return NextResponse.json({ success: true, revision: await getNotifyMeScriptRevision(id) });
  } catch (error) {
    return notifyMeScriptErrorResponse(error);
  }
}
