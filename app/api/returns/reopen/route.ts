import { NextRequest, NextResponse } from 'next/server';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';
import { reopenReturnRequest } from '@/app/lib/returns/reopen-service';

export const runtime = 'nodejs';

/**
 * POST /api/returns/reopen { id, reason, clearInspection?, dryRun? }
 * "إعادة للمراجعة": back to the live queue from completed, rejected, ready or
 * needs-attention. dryRun says where the request will land.
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });

  const result = await reopenReturnRequest({
    id,
    reason: typeof body?.reason === 'string' ? body.reason : '',
    clearInspection: body?.clearInspection === true,
    dryRun: body?.dryRun === true,
    actor: staffActorName(auth.session),
  });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  return NextResponse.json({ success: true, executed: result.executed, plan: result.plan, message: result.message });
}
