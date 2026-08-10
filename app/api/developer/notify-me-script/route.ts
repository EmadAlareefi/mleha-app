import { NextRequest, NextResponse } from 'next/server';
import {
  getNotifyMeScriptEditorState,
  saveNotifyMeScriptDraft,
} from '@/app/lib/notify-me-script';
import {
  authorizeNotifyMeScriptEditor,
  notifyMeScriptErrorResponse,
} from './_shared';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorizeNotifyMeScriptEditor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ success: true, state: await getNotifyMeScriptEditorState() });
  } catch (error) {
    return notifyMeScriptErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeNotifyMeScriptEditor();
  if (auth.response || !auth.session?.user) return auth.response!;
  try {
    const body = await request.json().catch(() => null);
    const state = await saveNotifyMeScriptDraft({
      source: body?.source,
      baseDraftVersion: body?.baseDraftVersion,
      user: auth.session.user,
    });
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return notifyMeScriptErrorResponse(error);
  }
}
