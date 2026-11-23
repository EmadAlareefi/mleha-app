import { NextRequest } from 'next/server';
import { revokeOrderSession } from '@/app/lib/order-manage/access-service';
import { clearSessionCookie, jsonNoStore, rejectForeignOrigin, sessionFromRequest } from '@/app/lib/order-manage/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/public/order-manage/logout — ends the customer's session. */
export async function POST(request: NextRequest) {
  const foreign = rejectForeignOrigin(request);
  if (foreign) return foreign;
  const session = await sessionFromRequest(request).catch(() => null);
  if (session) await revokeOrderSession(session.accessId).catch(() => undefined);
  const response = jsonNoStore({ success: true });
  clearSessionCookie(response);
  return response;
}
