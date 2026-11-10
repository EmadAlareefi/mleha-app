import { after } from 'next/server';
import { completeAssignment } from '@/app/lib/order-prep/queue';
import { requirePrepUser } from '@/app/lib/order-prep/route-auth';
import { actionResponse, readJson, serverError } from '@/app/lib/order-prep/route-responses';
import { parseItemChecks, parseOrderId } from '@/app/lib/order-prep/request-parsing';
import { processSyncJobsNow } from '@/app/lib/order-prep/salla-sync';
import { verifyUnverifiedClaims } from '@/app/lib/order-prep/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Done. One transaction marks the order packed, queues its Salla status
 * change, moves the next order up and claims a new next. Salla is updated
 * after the response; a retried request is a no-op.
 */
export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const auth = await requirePrepUser();
  if ('response' in auth) return auth.response;
  const { user } = auth;
  try {
    const { assignmentId } = await context.params;
    const body = await readJson(request);
    const orderId = parseOrderId(body.orderId);
    if (!orderId) {
      return Response.json({ success: false, error: { code: 'invalid', message: 'رقم الطلب مطلوب' } }, { status: 400 });
    }
    const result = await completeAssignment(user, {
      assignmentId,
      orderId,
      itemChecks: parseItemChecks(body.itemChecks),
      scanMethod: body.scanMethod === 'scan' ? 'scan' : 'manual',
    });
    if (result.ok) {
      after(async () => {
        await processSyncJobsNow(result.syncJobIds);
        await verifyUnverifiedClaims(user);
      });
    }
    return actionResponse(user.id, result);
  } catch (error) {
    return serverError('complete', error);
  }
}
