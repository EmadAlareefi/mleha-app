import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { syncLocalReturnPickupTask } from '@/app/lib/returns/local-return-pickup';
import { repriceRequest } from '@/app/lib/returns/reprice';
import { STAGE_LABELS } from '@/lib/returns/workflow';
import { planReopen, type ReopenPlan } from '@/lib/returns/reopen';

/**
 * "إعادة للمراجعة" — see lib/returns/reopen.ts for the rules. Compare-and-set
 * on the request's status and processing status, so it never races a running
 * process or another staff action.
 */

type Db = Pick<typeof prisma, 'returnRequest' | 'returnItem' | '$transaction'>;

export interface ReopenDeps {
  db: Db;
  reprice(id: string): Promise<unknown>;
  syncPickup(id: string, options: { skipIfPickedUp: boolean }): Promise<void>;
  now(): Date;
}

export const productionReopenDeps: ReopenDeps = {
  db: prisma,
  reprice: (id) => repriceRequest(id),
  syncPickup: (id, options) => syncLocalReturnPickupTask(id, options),
  now: () => new Date(),
};

export interface ReopenInput {
  id: string;
  reason: string;
  clearInspection?: boolean;
  actor: string;
  dryRun?: boolean;
}

export type ReopenServiceResult =
  | { ok: true; executed: boolean; plan: ReopenPlan; message: string }
  | { ok: false; status: number; code: string; message: string };

export const REOPEN_REASON_MIN = 3;
export const REOPEN_REASON_MAX = 500;

export async function reopenReturnRequest(input: ReopenInput, deps: ReopenDeps = productionReopenDeps): Promise<ReopenServiceResult> {
  const reason = (input.reason || '').trim();
  if (!input.dryRun && (reason.length < REOPEN_REASON_MIN || reason.length > REOPEN_REASON_MAX)) {
    return { ok: false, status: 400, code: 'REASON_REQUIRED', message: 'اكتبي سبب الإعادة للمراجعة (3 أحرف على الأقل).' };
  }

  const request = await deps.db.returnRequest.findUnique({ where: { id: input.id }, include: { items: true } });
  if (!request) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'طلب الإرجاع غير موجود' };

  const now = deps.now();
  const plan = planReopen(request, { clearInspection: input.clearInspection, now });
  if (!plan.ok) {
    return { ok: false, status: plan.code === 'PROCESSING' ? 409 : 400, code: plan.code, message: plan.message };
  }

  // A rejected request's pieces may have been claimed by a newer request since.
  if (request.status === 'rejected') {
    const keys = new Set(
      request.items.filter((item) => item.orderItemId).map((item) => `${item.orderItemId}:${item.unitIndex ?? 0}`),
    );
    if (keys.size > 0) {
      const others = await deps.db.returnRequest.findMany({
        where: {
          merchantId: request.merchantId,
          orderId: request.orderId,
          id: { not: request.id },
          status: { notIn: ['cancelled', 'rejected'] },
        },
        select: { orderNumber: true, items: { select: { orderItemId: true, unitIndex: true } } },
      });
      const clash = others.find((other) =>
        other.items.some((item) => item.orderItemId && keys.has(`${item.orderItemId}:${item.unitIndex ?? 0}`)),
      );
      if (clash) {
        return {
          ok: false,
          status: 409,
          code: 'PIECES_CLAIMED',
          message: 'قطع هذا الطلب موجودة في طلب إرجاع آخر نشط؛ لا يمكن إعادته للمراجعة.',
        };
      }
    }
  }

  const destination = STAGE_LABELS[plan.toStage];
  if (input.dryRun) {
    return { ok: true, executed: false, plan, message: `سينتقل الطلب إلى: ${destination}` };
  }

  const auditEntry = {
    at: now.toISOString(),
    step: 'reopen',
    result: 'info',
    by: input.actor,
    details: {
      reason,
      fromStage: plan.fromStage,
      toStage: plan.toStage,
      fromStatus: request.status,
      toStatus: plan.toStatus,
      clearedInspection: plan.clearItemIds.length,
      keptRestocked: plan.keptItems.length || undefined,
      previousError: plan.previousError || undefined,
    },
  };
  const inspectorNote = `إعادة فحص (${input.actor}): ${reason}`;

  const claimed = await deps.db.$transaction(async (tx) => {
    const updated = await tx.returnRequest.updateMany({
      where: { id: request.id, status: request.status, processingStatus: request.processingStatus },
      data: {
        status: plan.toStatus,
        processingStatus: 'idle',
        processingError: null,
        ...(plan.receivedAt ? { receivedAt: plan.receivedAt } : {}),
        reviewedBy: input.actor,
        reviewedAt: now,
      },
    });
    if (updated.count === 0) return false;
    // The row is locked by the update above until commit: append safely.
    const current = await tx.returnRequest.findUnique({ where: { id: request.id }, select: { processingAudit: true } });
    const audit = Array.isArray(current?.processingAudit) ? (current!.processingAudit as unknown[]) : [];
    await tx.returnRequest.update({ where: { id: request.id }, data: { processingAudit: [...audit, auditEntry] as any } });
    for (const item of request.items) {
      if (!plan.clearItemIds.includes(item.id)) continue;
      await tx.returnItem.update({
        where: { id: item.id },
        data: {
          conditionStatus: null,
          conditionNotes: null,
          inspectedBy: null,
          inspectedAt: null,
          refundIncluded: true,
          // A piece skipped for its condition gets a fresh restock decision.
          ...(item.restockStatus === 'skipped' || item.restockStatus === 'failed' ? { restockStatus: 'none' } : {}),
          preInspectionNotes: [item.preInspectionNotes?.trim(), inspectorNote].filter(Boolean).join('\n').slice(0, 1000),
        },
      });
    }
    return true;
  });
  if (!claimed) {
    return { ok: false, status: 409, code: 'CHANGED', message: 'تغيّر الطلب للتو (معالجة أو إجراء آخر). حدّثي الصفحة وحاولي مرة أخرى.' };
  }

  if (plan.clearItemIds.length > 0) {
    await deps.reprice(request.id).catch((error) => log.error('Reprice after reopen failed', { returnRequestId: request.id, error }));
  }
  if (plan.toStatus === 'pending_review') {
    await deps.syncPickup(request.id, { skipIfPickedUp: true }).catch(() => undefined);
  }

  log.info('Return request reopened', { returnRequestId: request.id, by: input.actor, from: plan.fromStage, to: plan.toStage });
  return {
    ok: true,
    executed: true,
    plan,
    message:
      plan.clearItemIds.length > 0
        ? `أُعيد الطلب للمراجعة وأُرسل للمستودع لإعادة الفحص (${destination}).`
        : `أُعيد الطلب للمراجعة: ${destination}.`,
  };
}
