import type { OrderPrepAssignment, OrderPrepSallaSync } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { ensureInternationalPostalCode } from '@/app/lib/order-prep-service';
import { createSallaOrderHistoryEntry, updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import { STATUS_IDS, SUB_STATUSES } from '@/SALLA_ORDER_STATUSES';
import { fetchLiveOrder } from './salla-live';
import {
  MAX_SYNC_ATTEMPTS,
  decideSyncAction,
  nextBackoffMs,
  parseRetryAfter,
  statusEcho,
  type SyncKind,
} from './sync-rules';

/**
 * The Salla outbox worker. Prep actions only write OrderPrepSallaSync rows;
 * this applies them — right after the response (after()) and again from a
 * one-minute cron for anything that failed. Each job is checked against the
 * order's live status first (compare-and-set), so a cancelled or edited order
 * is flagged for a person instead of being overwritten.
 */

const LOCK_MS = 90_000;
const SALLA_TIMEOUT_MS = 10_000;

const TARGET_LABELS: Record<number, string> = {
  [STATUS_IDS.IN_PROGRESS]: 'جاري التجهيز',
  [SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id]: SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.name,
  [STATUS_IDS.UNDER_REVIEW_X4]: 'غير متوفر (ارجاع مبلغ)',
  [STATUS_IDS.UNDER_REVIEW]: 'تحت المراجعة',
  [STATUS_IDS.NEW_ORDER]: 'طلب جديد',
};

export type SyncOutcome = 'synced' | 'already' | 'conflict' | 'retry' | 'failed' | 'skipped';

/** Takes the job if it's due and nobody else holds it. */
async function lockJob(jobId: string, force: boolean): Promise<OrderPrepSallaSync | null> {
  const now = new Date();
  const rows = await prisma.orderPrepSallaSync.updateManyAndReturn({
    where: {
      id: jobId,
      state: { in: ['pending', 'failed'] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      ...(force ? {} : { nextAttemptAt: { lte: now } }),
    },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return rows[0] ?? null;
}

async function finish(
  job: OrderPrepSallaSync,
  data: Partial<Pick<OrderPrepSallaSync, 'state' | 'lastError' | 'liveStatus' | 'syncedAt' | 'nextAttemptAt' | 'attempts'>>,
) {
  await prisma.orderPrepSallaSync.update({
    where: { id: job.id },
    data: { ...data, lockedUntil: null },
  });
}

async function scheduleRetry(job: OrderPrepSallaSync, error: string, retryAfterMs?: number | null): Promise<SyncOutcome> {
  const attempts = job.attempts + 1;
  const failed = attempts >= MAX_SYNC_ATTEMPTS;
  await finish(job, {
    attempts,
    state: failed ? 'failed' : 'pending',
    lastError: error.slice(0, 1000),
    nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts, retryAfterMs)),
  });
  log.warn('Order prep Salla sync attempt failed', { jobId: job.id, orderId: job.orderId, attempts, error: error.slice(0, 300) });
  return failed ? 'failed' : 'retry';
}

/** Applies one outbox job. Safe to call from several places at once. */
export async function processSyncJob(jobId: string, options: { force?: boolean } = {}): Promise<SyncOutcome> {
  const job = await lockJob(jobId, Boolean(options.force));
  if (!job) return 'skipped';

  try {
    const live = await fetchLiveOrder(job.merchantId, job.orderId, { timeoutMs: SALLA_TIMEOUT_MS });
    if (live.kind === 'rate_limited') return scheduleRetry(job, 'salla_rate_limited', live.retryAfterMs);
    if (live.kind === 'error') return scheduleRetry(job, live.message);
    if (live.kind === 'not_found') {
      await finish(job, { state: 'conflict', lastError: 'الطلب غير موجود في سلة', liveStatus: null });
      return 'conflict';
    }

    const decision = decideSyncAction(job.kind as SyncKind, live.statusCustomId, job.targetStatusId);
    const liveStatus = [live.statusCustomId, live.statusName].filter(Boolean).join(' ');
    if (decision === 'conflict') {
      await finish(job, {
        state: 'conflict',
        liveStatus,
        lastError: `حالة الطلب في سلة "${live.statusName ?? live.statusCustomId}" لا تسمح بالتحويل`,
      });
      if (job.assignmentId) {
        await prisma.orderPrepAssignment
          .updateMany({
            where: { id: job.assignmentId },
            data: { verifyIssue: `conflict:${live.statusName ?? live.statusCustomId ?? 'unknown'}` },
          })
          .catch(() => undefined);
      }
      log.warn('Order prep Salla sync conflict', { jobId: job.id, orderId: job.orderId, kind: job.kind, liveStatus });
      return 'conflict';
    }

    if (decision === 'write') {
      if (job.kind === 'packed' && job.targetStatusId === SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id) {
        // Best effort, as before: the old flow patched short postal codes on
        // international orders. Never blocks the status change.
        await ensureInternationalPostalCode({
          id: job.assignmentId ?? job.id,
          merchantId: job.merchantId,
          orderId: job.orderId,
          orderData: live.detail,
        } as unknown as OrderPrepAssignment).catch(() => null);
      }
      const result = await updateSallaOrderStatus(job.merchantId, job.orderId, {
        statusId: job.targetStatusId,
        timeoutMs: SALLA_TIMEOUT_MS,
      });
      if (!result.success) {
        return scheduleRetry(job, result.error || 'status_update_failed', parseRetryAfter(result.retryAfter ?? null));
      }
    }

    let historyError: string | null = null;
    if (job.note && decision === 'write') {
      const label = TARGET_LABELS[job.targetStatusId] ?? String(job.targetStatusId);
      const comment = `تم تحويل الطلب إلى "${label}" بواسطة ${job.createdByName || 'فريق التجهيز'}.\nالملاحظة: ${job.note}`;
      const history = await createSallaOrderHistoryEntry(job.merchantId, job.orderId, comment, { timeoutMs: SALLA_TIMEOUT_MS });
      if (!history.success) historyError = `history: ${history.error ?? 'failed'}`.slice(0, 500);
    }

    const echo = statusEcho(job.targetStatusId);
    if (echo) {
      await prisma.sallaOrder
        .updateMany({ where: { merchantId: job.merchantId, orderId: job.orderId }, data: echo })
        .catch(() => undefined);
    }
    await finish(job, { state: 'synced', syncedAt: new Date(), liveStatus, lastError: historyError });
    return decision === 'already' ? 'already' : 'synced';
  } catch (error) {
    return scheduleRetry(job, error instanceof Error ? error.message : 'unknown_error');
  }
}

/** Due jobs, oldest first, within a time budget (the cron path). */
export async function processDueSyncJobs(options: { limit?: number; budgetMs?: number } = {}) {
  const limit = options.limit ?? 20;
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  const due = await prisma.orderPrepSallaSync.findMany({
    where: {
      state: { in: ['pending', 'failed'] },
      attempts: { lt: MAX_SYNC_ATTEMPTS },
      nextAttemptAt: { lte: new Date() },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  const results: Record<SyncOutcome, number> = { synced: 0, already: 0, conflict: 0, retry: 0, failed: 0, skipped: 0 };
  for (const { id } of due) {
    if (Date.now() > deadline) break;
    const outcome = await processSyncJob(id);
    results[outcome] += 1;
    // Salla is rate limited; one 429 means the rest can wait for the next run.
    if (outcome === 'retry') {
      const job = await prisma.orderPrepSallaSync.findUnique({ where: { id }, select: { lastError: true } });
      if (job?.lastError === 'salla_rate_limited') break;
    }
  }
  return { considered: due.length, results };
}

/** Runs the given jobs now (used from after() in the action routes). */
export async function processSyncJobsNow(jobIds: string[]) {
  for (const id of jobIds) {
    await processSyncJob(id).catch((error) =>
      log.error('Order prep Salla sync crashed', { jobId: id, error: error instanceof Error ? error.message : error }),
    );
  }
}

/** Supervisor action: try a failed or conflicting job again now. */
export async function retrySyncJob(jobId: string): Promise<SyncOutcome> {
  await prisma.orderPrepSallaSync.updateMany({
    where: { id: jobId, state: { in: ['failed', 'conflict', 'pending'] } },
    data: { state: 'pending', attempts: 0, nextAttemptAt: new Date(), lockedUntil: null },
  });
  return processSyncJob(jobId, { force: true });
}
