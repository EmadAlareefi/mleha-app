import { NextRequest, NextResponse } from 'next/server';
import { resetNotifyMeScriptDraft } from '@/app/lib/notify-me-script';
import {
  authorizeNotifyMeScriptEditor,
  notifyMeScriptErrorResponse,
} from '../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await authorizeNotifyMeScriptEditor();
  if (auth.response || !auth.session?.user) return auth.response!;
  try {
    const body = await request.json().catch(() => null);
    const state = await resetNotifyMeScriptDraft({
      baseDraftVersion: body?.baseDraftVersion,
      user: auth.session.user,
    });
    return NextResponse.json({ success: true, state });
  } catch (error) {
    return notifyMeScriptErrorResponse(error);
  }
}
