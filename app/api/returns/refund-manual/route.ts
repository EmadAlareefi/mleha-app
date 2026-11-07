import { NextRequest, NextResponse } from 'next/server';
import { markRefundedManually } from '@/app/lib/returns/process-return';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';

export const runtime = 'nodejs';

/**
 * POST /api/returns/refund-manual
 * { returnRequestId, mode: 'salla' | 'manual', amount?, note? }
 *
 * 'salla'  — the refund was made in the Salla dashboard; closes only when it
 *            appears in the order history.
 * 'manual' — paid outside Salla (bank transfer); staff state the amount.
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.returnRequestId === 'string' ? body.returnRequestId : '';
  if (!id) return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });

  const amount = body?.amount === undefined || body?.amount === null || body?.amount === '' ? undefined : Number(body.amount);
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0 || amount > 50000)) {
    return NextResponse.json({ error: 'المبلغ غير صالح' }, { status: 400 });
  }
  if (body?.mode === 'manual' && amount === undefined) {
    return NextResponse.json({ error: 'الرجاء إدخال المبلغ المحوّل' }, { status: 400 });
  }

  const result = await markRefundedManually(id, {
    actor: staffActorName(auth.session),
    amount,
    note: typeof body?.note === 'string' ? body.note.slice(0, 500) : undefined,
    requireSallaEvidence: body?.mode === 'salla',
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
