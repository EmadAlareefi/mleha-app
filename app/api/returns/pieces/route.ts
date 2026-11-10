import { NextRequest, NextResponse } from 'next/server';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';
import { applyPieceChanges } from '@/app/lib/returns/piece-changes-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/returns/pieces
 * { id, setAll?: 'return'|'exchange', changes?: [{ itemId, type?, refundIncluded? }],
 *   dryRun?, confirm?: { policy?, coupon?, manualCoupon? }, note?, notifyCustomer? }
 *
 * Switches pieces between return and exchange (or in / out of the refund).
 * dryRun returns the preview (before / after money, coupon outcome, warnings);
 * the real run needs every confirmation the preview asked for.
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });

  const confirm = body?.confirm && typeof body.confirm === 'object' ? body.confirm : {};
  const result = await applyPieceChanges({
    id,
    actor: staffActorName(auth.session),
    setAll: typeof body?.setAll === 'string' ? body.setAll : undefined,
    changes: Array.isArray(body?.changes) ? body.changes : undefined,
    dryRun: body?.dryRun === true,
    confirm: {
      policy: confirm.policy === true,
      coupon: confirm.coupon === true,
      manualCoupon: confirm.manualCoupon === true,
    },
    note: typeof body?.note === 'string' ? body.note.slice(0, 500) : undefined,
    notifyCustomer: body?.notifyCustomer === true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code, preview: result.preview },
      { status: result.status },
    );
  }
  return NextResponse.json({ success: true, executed: result.executed, preview: result.preview, message: result.message });
}
