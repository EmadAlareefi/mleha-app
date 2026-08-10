import { NextRequest, NextResponse } from 'next/server';
import { listNotifyMeScriptRevisions } from '@/app/lib/notify-me-script';
import {
  authorizeNotifyMeScriptEditor,
  notifyMeScriptErrorResponse,
} from '../_shared';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authorizeNotifyMeScriptEditor();
  if (auth.response) return auth.response;
  try {
    const take = Number.parseInt(request.nextUrl.searchParams.get('take') || '20', 10);
    const result = await listNotifyMeScriptRevisions({
      cursor: request.nextUrl.searchParams.get('cursor'),
      take: Number.isFinite(take) ? take : 20,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return notifyMeScriptErrorResponse(error);
  }
}
