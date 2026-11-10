import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { MERCHANT_ID, getQueueStats } from './queue';
import { riyadhStartOfDayUtc } from './riyadh-time';
import { retrySyncJob, processSyncJobsNow } from './salla-sync';
import { getPrepSettings, sanitizePrepSettingsPatch, updatePrepSettings, type PrepSettings } from './settings';
import { NEW_ORDER_STATUS_ID } from './sync-rules';
import type { QueueStats } from './types';

/** Supervisor board data: queue, packers, open exceptions, sync problems, settings. */

export type BoardPacker = {
  userId: string;
  name: string;
  current: { orderNumber: string; minutes: number | null; verifyIssue: string | null } | null;
  next: { orderNumber: string } | null;
  completedToday: number;
  scannedToday: number;
  perHour: number | null;
  lastCompletedAt: string | null;
};

export type BoardException = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  reason: string;
  statusTarget: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  sync: { state: string; lastError: string | null } | null;
};

export type BoardSyncIssue = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  kind: string;
  state: string;
  attempts: number;
  lastError: string | null;
  liveStatus: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type BoardData = {
  stats: QueueStats;
  packedToday: number;
  packedLastHour: number;
  packers: BoardPacker[];
  exceptions: BoardException[];
  syncIssues: BoardSyncIssue[];
  pendingSync: { count: number; oldestAt: string | null };
  settings: PrepSettings;
  generatedAt: string;
};

export async function getBoardData(): Promise<BoardData> {
  const dayStart = riyadhStartOfDayUtc();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [stats, active, completedToday, packedLastHour, escalations, syncIssues, pending, settings] = await Promise.all([
    getQueueStats(),
    prisma.orderPrepAssignment.findMany({
      where: { merchantId: MERCHANT_ID, status: { in: ['assigned', 'preparing'] } },
      select: { userId: true, userName: true, status: true, orderNumber: true, orderId: true, startedAt: true, verifyIssue: true },
      orderBy: { assignedAt: 'asc' },
    }),
    prisma.orderPrepAssignment.findMany({
      where: { merchantId: MERCHANT_ID, status: 'completed', completedAt: { gte: dayStart } },
      select: { userId: true, userName: true, completedAt: true, scanMethod: true },
    }),
    prisma.orderPrepAssignment.count({
      where: { merchantId: MERCHANT_ID, status: 'completed', completedAt: { gte: hourAgo } },
    }),
    prisma.orderPrepEscalation.findMany({
      where: { merchantId: MERCHANT_ID, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 150,
    }),
    prisma.orderPrepSallaSync.findMany({
      where: { state: { in: ['failed', 'conflict'] } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.orderPrepSallaSync.aggregate({
      where: { state: 'pending' },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    getPrepSettings(),
  ]);

  const escalationJobs = escalations.length
    ? await prisma.orderPrepSallaSync.findMany({
        where: { escalationId: { in: escalations.map((row) => row.id) } },
        select: { escalationId: true, state: true, lastError: true },
      })
    : [];
  const jobByEscalation = new Map(escalationJobs.map((job) => [job.escalationId, job]));

  const packers = new Map<string, BoardPacker>();
  const ensure = (userId: string, name: string) => {
    let packer = packers.get(userId);
    if (!packer) {
      packer = { userId, name, current: null, next: null, completedToday: 0, scannedToday: 0, perHour: null, lastCompletedAt: null };
      packers.set(userId, packer);
    }
    return packer;
  };
  const firstDone = new Map<string, number>();
  for (const row of completedToday) {
    const packer = ensure(row.userId, row.userName);
    packer.completedToday += 1;
    if (row.scanMethod === 'scan') packer.scannedToday += 1;
    const at = row.completedAt?.getTime() ?? 0;
    if (!packer.lastCompletedAt || at > Date.parse(packer.lastCompletedAt)) packer.lastCompletedAt = new Date(at).toISOString();
    firstDone.set(row.userId, Math.min(firstDone.get(row.userId) ?? at, at));
  }
  for (const row of active) {
    const packer = ensure(row.userId, row.userName);
    const orderNumber = row.orderNumber || row.orderId;
    if (row.status === 'preparing' && !packer.current) {
      packer.current = {
        orderNumber,
        minutes: row.startedAt ? Math.round((Date.now() - row.startedAt.getTime()) / 60000) : null,
        verifyIssue: row.verifyIssue,
      };
    } else if (row.status === 'assigned' && !packer.next) {
      packer.next = { orderNumber };
    }
  }
  for (const packer of packers.values()) {
    const first = firstDone.get(packer.userId);
    const last = packer.lastCompletedAt ? Date.parse(packer.lastCompletedAt) : null;
    if (first && last && packer.completedToday >= 3 && last > first) {
      packer.perHour = Math.round(((packer.completedToday - 1) / ((last - first) / 3_600_000)) * 10) / 10;
    }
  }

  return {
    stats,
    packedToday: completedToday.length,
    packedLastHour,
    packers: [...packers.values()].sort((a, b) => Number(Boolean(b.current)) - Number(Boolean(a.current)) || b.completedToday - a.completedToday),
    exceptions: escalations.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      reason: row.reason,
      statusTarget: row.statusTarget,
      notes: row.notes,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
      sync: jobByEscalation.get(row.id)
        ? { state: jobByEscalation.get(row.id)!.state, lastError: jobByEscalation.get(row.id)!.lastError }
        : null,
    })),
    syncIssues: syncIssues.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      kind: row.kind,
      state: row.state,
      attempts: row.attempts,
      lastError: row.lastError,
      liveStatus: row.liveStatus,
      createdByName: row.createdByName,
      createdAt: row.createdAt.toISOString(),
    })),
    pendingSync: { count: pending._count._all, oldestAt: pending._min.createdAt?.toISOString() ?? null },
    settings,
    generatedAt: new Date().toISOString(),
  };
}

type Actor = { id: string | null; name: string };

export type BoardActionResult = { ok: true; syncJobIds?: string[] } | { ok: false; error: string };

/** Hands back every order a packer holds (e.g. they went home mid-order). */
export async function releasePackerClaims(userId: string, actor: Actor): Promise<BoardActionResult> {
  const removed = await prisma.orderPrepAssignment.deleteMany({
    where: { merchantId: MERCHANT_ID, userId, status: { in: ['assigned', 'preparing'] } },
  });
  log.info('Supervisor released packer claims', { userId, count: removed.count, by: actor.name });
  return { ok: true };
}

/** Item found / problem fixed: back to "طلب جديد" so it re-enters the queue. */
export async function requeueEscalation(escalationId: string, actor: Actor): Promise<BoardActionResult> {
  const escalation = await prisma.orderPrepEscalation.findUnique({ where: { id: escalationId } });
  if (!escalation || escalation.resolvedAt) return { ok: false, error: 'لم يعد هذا الطلب ضمن الاستثناءات' };
  const now = new Date();
  const job = await prisma.$transaction(async (tx) => {
    await tx.orderPrepEscalation.update({
      where: { id: escalation.id },
      data: { resolvedAt: now, resolvedById: actor.id, resolvedByName: actor.name },
    });
    await tx.orderPrepUnavailableItem.updateMany({
      where: { merchantId: escalation.merchantId, orderId: escalation.orderId, resolvedAt: null },
      data: { resolvedAt: now, resolvedById: actor.id, resolvedByName: actor.name, resolution: 'found' },
    });
    return tx.orderPrepSallaSync.create({
      data: {
        merchantId: escalation.merchantId,
        orderId: escalation.orderId,
        orderNumber: escalation.orderNumber,
        kind: 'requeue',
        targetStatusId: Number(NEW_ORDER_STATUS_ID),
        note: `أُعيد الطلب للتجهيز بواسطة ${actor.name}.`,
        escalationId: escalation.id,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
  });
  return { ok: true, syncJobIds: [job.id] };
}

/** Handled outside prep (refunded / cancelled in Salla): close the exception. */
export async function resolveEscalation(
  escalationId: string,
  resolution: 'refunded' | 'handled',
  actor: Actor,
): Promise<BoardActionResult> {
  const escalation = await prisma.orderPrepEscalation.findUnique({ where: { id: escalationId } });
  if (!escalation || escalation.resolvedAt) return { ok: false, error: 'لم يعد هذا الطلب ضمن الاستثناءات' };
  const now = new Date();
  await prisma.$transaction([
    prisma.orderPrepEscalation.update({
      where: { id: escalation.id },
      data: { resolvedAt: now, resolvedById: actor.id, resolvedByName: actor.name },
    }),
    ...(resolution === 'refunded'
      ? [
          prisma.orderPrepUnavailableItem.updateMany({
            where: { merchantId: escalation.merchantId, orderId: escalation.orderId, resolvedAt: null },
            data: { resolvedAt: now, resolvedById: actor.id, resolvedByName: actor.name, resolution: 'refunded' },
          }),
        ]
      : []),
  ]);
  return { ok: true };
}

export async function retrySync(jobId: string): Promise<BoardActionResult> {
  const outcome = await retrySyncJob(jobId);
  return outcome === 'synced' || outcome === 'already' ? { ok: true } : { ok: false, error: `لم تنجح المحاولة (${outcome})` };
}

export async function dismissSync(jobId: string): Promise<BoardActionResult> {
  await prisma.orderPrepSallaSync.updateMany({
    where: { id: jobId, state: { in: ['failed', 'conflict'] } },
    data: { state: 'dismissed', lockedUntil: null },
  });
  return { ok: true };
}

export async function saveSettings(patch: Record<string, unknown>): Promise<BoardActionResult & { settings?: PrepSettings }> {
  const clean = sanitizePrepSettingsPatch(patch);
  if (Object.keys(clean).length === 0) return { ok: false, error: 'لا توجد إعدادات صالحة للحفظ' };
  const settings = await updatePrepSettings(clean);
  return { ok: true, settings };
}

export { processSyncJobsNow };
