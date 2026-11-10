import { releaseForUser } from '@/app/lib/order-prep/queue';
import { requirePrepUser } from '@/app/lib/order-prep/route-auth';
import { actionResponse, readJson, serverError } from '@/app/lib/order-prep/route-responses';
import { parseNote } from '@/app/lib/order-prep/request-parsing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** scope 'all': pause (hand both orders back). scope 'current': return the order on screen. */
export async function POST(request: Request) {
  const auth = await requirePrepUser();
  if ('response' in auth) return auth.response;
  const { user } = auth;
  try {
    const body = await readJson(request);
    const scope = body.scope === 'current' ? 'current' : 'all';
    const result = await releaseForUser(user, { scope, reason: parseNote(body.reason) });
    return actionResponse(user.id, result);
  } catch (error) {
    return serverError('release', error);
  }
}
