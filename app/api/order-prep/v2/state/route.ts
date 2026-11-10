import { requirePrepUser } from '@/app/lib/order-prep/route-auth';
import { serverError, stateResponse } from '@/app/lib/order-prep/route-responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The packer's current orders and counters. Read-only: never claims anything. */
export async function GET() {
  const auth = await requirePrepUser();
  if ('response' in auth) return auth.response;
  try {
    return await stateResponse(auth.user.id);
  } catch (error) {
    return serverError('state', error);
  }
}
