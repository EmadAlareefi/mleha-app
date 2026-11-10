import { after } from 'next/server';
import { reportProblem } from '@/app/lib/order-prep/queue';
import { requirePrepUser } from '@/app/lib/order-prep/route-auth';
import { actionResponse, readJson, serverError } from '@/app/lib/order-prep/route-responses';
import { parseItemChecks, parseNote, parseOrderId, parseProblemItems } from '@/app/lib/order-prep/request-parsing';
import { processSyncJobsNow } from '@/app/lib/order-prep/salla-sync';
import { verifyUnverifiedClaims } from '@/app/lib/order-prep/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The packer can't pack the order as is. Some lines missing → the rest ships
 * and the shortage is recorded; otherwise the order goes to X4 / review for a
 * supervisor. Either way the next order moves up at once.
 */
export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const auth = await requirePrepUser();
  if ('response' in auth) return auth.response;
  const { user } = auth;
  try {
    const { assignmentId } = await context.params;
    const body = await readJson(request);
    const orderId = parseOrderId(body.orderId);
    const items = parseProblemItems(body.items);
    if (!orderId || items.length === 0) {
      return Response.json(
        { success: false, error: { code: 'invalid', message: 'حدد المنتج وسبب المشكلة' } },
        { status: 400 },
      );
    }
    const result = await reportProblem(user, {
      assignmentId,
      orderId,
      items,
      note: parseNote(body.note),
      itemChecks: parseItemChecks(body.itemChecks),
    });
    if (result.ok) {
      after(async () => {
        await processSyncJobsNow(result.syncJobIds);
        await verifyUnverifiedClaims(user);
      });
    }
    return actionResponse(user.id, result);
  } catch (error) {
    return serverError('exception', error);
  }
}
