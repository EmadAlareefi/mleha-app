import { NextRequest, NextResponse } from 'next/server';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { maybeReleaseExchangeOrderHold } from '@/app/lib/returns/exchange-order';
import { applyPieceChanges } from '@/app/lib/returns/piece-changes-service';
import { reopenReturnRequest } from '@/app/lib/returns/reopen-service';
import { canTransition } from '@/lib/returns/workflow';
import { syncLocalReturnPickupTask } from '@/app/lib/returns/local-return-pickup';

export const runtime = 'nodejs';

const VALID_STATUSES = ['pending_review', 'approved', 'rejected', 'shipped', 'delivered', 'completed', 'cancelled'];

/**
 * POST /api/returns/update { id, status?, adminNotes?, type?, items?, reason? }
 *
 * - Piece changes (`type` for the whole request, `items[].type` /
 *   `items[].refundIncluded`) go through the piece-change service, the same
 *   rules as POST /api/returns/pieces. Changes that need a confirmation (coupon,
 *   category policy) are refused here with 409: use /api/returns/pieces.
 * - `status: 'pending_review'` on a closed request is "إعادة للمراجعة" and goes
 *   through the reopen service (POST /api/returns/reopen takes a reason).
 * - `status: 'completed'` closes without processing ("إغلاق بدون معالجة").
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;
  const actor = staffActorName(auth.session);

  try {
    const body = await request.json();
    const { id, status, adminNotes, type } = body ?? {};
    const pieceUpdates: Array<{ id: string; type?: string; refundIncluded?: boolean }> = Array.isArray(body?.items) ? body.items : [];

    if (!id) {
      return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'حالة غير صالحة' }, { status: 400 });
    }

    // 1. Pieces.
    if (type || pieceUpdates.length > 0) {
      const result = await applyPieceChanges({
        id,
        actor,
        setAll: type || undefined,
        changes: type
          ? undefined
          : pieceUpdates.map((piece) => ({ itemId: String(piece.id), type: piece.type, refundIncluded: piece.refundIncluded })),
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.message, code: result.code, preview: result.preview }, { status: result.status });
      }
      if (!status && adminNotes === undefined) {
        const returnRequest = await prisma.returnRequest.findUnique({ where: { id }, include: { items: true } });
        return NextResponse.json({ success: true, message: result.message, returnRequest });
      }
    }

    const current = await prisma.returnRequest.findUnique({
      where: { id },
      select: { status: true, processingStatus: true, processingAudit: true, exchangeOrderId: true, type: true },
    });
    if (!current) {
      return NextResponse.json({ error: 'طلب الإرجاع غير موجود' }, { status: 404 });
    }

    // 2. Back to review.
    if (status === 'pending_review' && current.status !== 'pending_review') {
      const result = await reopenReturnRequest({
        id,
        actor,
        reason: typeof body?.reason === 'string' && body.reason.trim() ? body.reason : 'إعادة للمراجعة',
        clearInspection: body?.clearInspection === true,
      });
      if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
      const returnRequest = await prisma.returnRequest.findUnique({ where: { id }, include: { items: true } });
      return NextResponse.json({ success: true, message: result.message, returnRequest });
    }

    // 3. Other status changes and notes.
    if (status && !canTransition(current.status, status)) {
      return NextResponse.json({ error: `لا يمكن نقل الطلب من "${current.status}" إلى "${status}"` }, { status: 400 });
    }
    if (current.processingStatus === 'processing') {
      return NextResponse.json({ error: 'الطلب قيد المعالجة حالياً' }, { status: 409 });
    }

    const updateData: Record<string, unknown> = {};
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    if (status && status !== current.status) {
      updateData.status = status;
      updateData.reviewedBy = actor;
      updateData.reviewedAt = new Date();
      if (status === 'completed') {
        // Closed by hand: nothing left to process. processedAt stays empty — the
        // app did not process it.
        updateData.processingStatus = 'done';
        updateData.processingError = null;
        const audit = Array.isArray(current.processingAudit) ? (current.processingAudit as unknown[]) : [];
        updateData.processingAudit = [
          ...audit,
          { at: new Date().toISOString(), step: 'complete', result: 'info', by: actor, details: { closedWithoutProcessing: true } },
        ];
      }
    }

    const returnRequest = await prisma.returnRequest.update({
      where: { id },
      data: updateData as any,
      include: { items: true },
    });

    if (status && current.exchangeOrderId && current.type !== 'return' && ['delivered', 'completed'].includes(status)) {
      await maybeReleaseExchangeOrderHold(id, { source: 'update', actor }).catch((error) =>
        log.error('Exchange release after status update failed', { id, error }),
      );
    }
    if (status) {
      await syncLocalReturnPickupTask(id);
    }

    log.info('Return request updated', { id, status, by: actor });
    return NextResponse.json({ success: true, returnRequest });
  } catch (error) {
    log.error('Error updating return request', { error });
    return NextResponse.json({ error: 'حدث خطأ أثناء تحديث طلب الإرجاع' }, { status: 500 });
  }
}
