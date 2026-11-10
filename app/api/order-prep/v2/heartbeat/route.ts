import { after } from 'next/server';
import { heartbeat } from '@/app/lib/order-prep/queue';
import { requirePrepUser } from '@/app/lib/order-prep/route-auth';
import { readJson, serverError, stateResponse } from '@/app/lib/order-prep/route-responses';
import { parseHeldSlots } from '@/app/lib/order-prep/request-parsing';
import { verifyUnverifiedClaims } from '@/app/lib/order-prep/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sent every minute while the page is visible: renews the packer's claims,
 * re-claims any the phone still shows after a lapsed lease (if nobody else took
 * them), tops up a missing next order, and returns fresh counters.
 */
export async function POST(request: Request) {
  const auth = await requirePrepUser();
  if ('response' in auth) return auth.response;
  const { user } = auth;
  try {
    const body = await readJson(request);
    await heartbeat(user, parseHeldSlots(body.held));
    after(() => verifyUnverifiedClaims(user));
    return stateResponse(user.id);
  } catch (error) {
    return serverError('heartbeat', error);
  }
}
