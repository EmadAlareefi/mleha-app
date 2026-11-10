import { after } from 'next/server';
import { claimForUser } from '@/app/lib/order-prep/queue';
import { requirePrepUser } from '@/app/lib/order-prep/route-auth';
import { readJson, serverError, stateResponse } from '@/app/lib/order-prep/route-responses';
import { parseHeldSlots } from '@/app/lib/order-prep/request-parsing';
import { verifyUnverifiedClaims } from '@/app/lib/order-prep/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start or resume packing: the packer gets the order to pack and the next one.
 * The order on screen is checked live against Salla first (3 s cap, then it
 * falls back to the background check); the next one is checked after the
 * response.
 */
export async function POST(request: Request) {
  const auth = await requirePrepUser();
  if ('response' in auth) return auth.response;
  const { user } = auth;
  try {
    const body = await readJson(request);
    await claimForUser(user, { prefer: parseHeldSlots(body.prefer) });
    await verifyUnverifiedClaims(user, { onlyStatus: 'preparing', timeoutMs: 3_000, replaceFreshCurrent: true });
    after(() => verifyUnverifiedClaims(user));
    return stateResponse(user.id);
  } catch (error) {
    return serverError('claim', error);
  }
}
