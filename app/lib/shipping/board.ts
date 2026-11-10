import { prisma } from '@/lib/prisma';
import { riyadhStartOfDayUtc } from '@/app/lib/order-prep/riyadh-time';
import { STATE_LABELS, type ShippingState } from './rules';
import { getShippingSettings, type ShippingSettings } from './settings';
import { MERCHANT_ID } from './tasks';
import { processShippingTask } from './worker';

/** Supervisor view of shipping v2: what's waiting, what's stuck, who's shipping. */

export type BoardTask = {
  id: string;
  orderId: string;
  orderNumber: string | null;
  method: string;
  state: ShippingState;
  stateLabel: string;
  lastError: string | null;
  blockReason: string | null;
  attempts: number;
  hasSallaShipment: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ShippingBoardData = {
  generatedAt: string;
  byState: Record<string, number>;
  waitingByAge: { under1h: number; h1to4: number; h4to24: number; over24h: number };
  printedToday: number;
  printedLastHour: number;
  shippers: Array<{ name: string; printedToday: number; medianGapSeconds: number | null; lastPrintedAt: string | null }>;
  problems: BoardTask[];
  international: BoardTask[];
  local: BoardTask[];
  settings: ShippingSettings;
};

const OPEN_STATES: ShippingState[] = [
  'queued',
  'creating',
  'awaiting_label',
  'label_ready',
  'needs_agent',
  'manual_international',
  'blocked',
  'failed',
];

type TaskRow = Awaited<ReturnType<typeof prisma.shippingTask.findMany>>[number];

const toBoardTask = (task: TaskRow): BoardTask => ({
  id: task.id,
  orderId: task.orderId,
  orderNumber: task.orderNumber,
  method: task.method,
  state: task.state as ShippingState,
  stateLabel: STATE_LABELS[task.state as ShippingState] ?? task.state,
  lastError: task.lastError,
  blockReason: task.blockReason,
  attempts: task.attempts,
  hasSallaShipment: Boolean(task.sallaShipmentId),
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
});

export async function getShippingBoard(): Promise<ShippingBoardData> {
  const now = Date.now();
  const startOfDay = riyadhStartOfDayUtc(now);
  const hourAgo = new Date(now - 60 * 60_000);
  const tenMinutesAgo = new Date(now - 10 * 60_000);

  const [stateCounts, ageRows, printedToday, printedLastHour, shipperRows, problems, international, local, settings] =
    await Promise.all([
      prisma.shippingTask.groupBy({
        by: ['state'],
        where: { merchantId: MERCHANT_ID, OR: [{ state: { in: OPEN_STATES } }, { printedAt: { gte: startOfDay } }] },
        _count: { _all: true },
      }),
      prisma.$queryRaw<Array<{ under1h: number; h1to4: number; h4to24: number; over24h: number }>>`
        SELECT
          count(*) FILTER (WHERE "createdAt" > now() - interval '1 hour')::int AS "under1h",
          count(*) FILTER (WHERE "createdAt" <= now() - interval '1 hour' AND "createdAt" > now() - interval '4 hours')::int AS "h1to4",
          count(*) FILTER (WHERE "createdAt" <= now() - interval '4 hours' AND "createdAt" > now() - interval '24 hours')::int AS "h4to24",
          count(*) FILTER (WHERE "createdAt" <= now() - interval '24 hours')::int AS "over24h"
        FROM "ShippingTask"
        WHERE "merchantId" = ${MERCHANT_ID} AND state = ANY(${OPEN_STATES}::text[])
      `,
      prisma.shippingTask.count({ where: { merchantId: MERCHANT_ID, printedAt: { gte: startOfDay } } }),
      prisma.shippingTask.count({ where: { merchantId: MERCHANT_ID, printedAt: { gte: hourAgo } } }),
      prisma.$queryRaw<Array<{ name: string; printed: number; median_gap: number | null; last_at: Date | null }>>`
        WITH p AS (
          SELECT coalesce("printedByName", '—') AS name, "printedAt",
            extract(epoch from "printedAt" - lag("printedAt") OVER (PARTITION BY coalesce("printedByName", '—') ORDER BY "printedAt")) AS gap
          FROM "ShippingTask"
          WHERE "merchantId" = ${MERCHANT_ID} AND "printedAt" >= ${startOfDay}
        )
        SELECT name, count(*)::int AS printed,
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) FILTER (WHERE gap < 600))::int AS median_gap,
          max("printedAt") AS last_at
        FROM p GROUP BY name ORDER BY printed DESC
      `,
      prisma.shippingTask.findMany({
        where: {
          merchantId: MERCHANT_ID,
          OR: [
            { state: { in: ['failed', 'blocked'] } },
            { state: 'awaiting_label', creatingAt: { lt: tenMinutesAgo } },
            { state: 'queued', attempts: { gt: 0 } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      prisma.shippingTask.findMany({
        where: { merchantId: MERCHANT_ID, state: 'manual_international' },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      prisma.shippingTask.findMany({
        where: { merchantId: MERCHANT_ID, state: 'needs_agent' },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      getShippingSettings({ fresh: true }),
    ]);

  return {
    generatedAt: new Date(now).toISOString(),
    byState: Object.fromEntries(stateCounts.map((row) => [row.state, row._count._all])),
    waitingByAge: ageRows[0] ?? { under1h: 0, h1to4: 0, h4to24: 0, over24h: 0 },
    printedToday,
    printedLastHour,
    shippers: shipperRows.map((row) => ({
      name: row.name,
      printedToday: row.printed,
      medianGapSeconds: row.median_gap,
      lastPrintedAt: row.last_at ? row.last_at.toISOString() : null,
    })),
    problems: problems.map(toBoardTask),
    international: international.map(toBoardTask),
    local: local.map(toBoardTask),
    settings,
  };
}

/** Supervisor: try again (failed / blocked / stuck) — the order goes back to "create". */
export async function retryShippingTask(taskId: string) {
  const task = await prisma.shippingTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false as const, message: 'المهمة غير موجودة' };
  if (task.method !== 'salla') {
    const state = task.method === 'local' ? 'needs_agent' : 'manual_international';
    await prisma.shippingTask.update({
      where: { id: taskId },
      data: { state, blockReason: null, lastError: null, lockedUntil: null },
    });
    return { ok: true as const, message: 'أُعيدت المهمة لمحطة الشحن' };
  }
  await prisma.shippingTask.update({
    where: { id: taskId },
    data: {
      state: task.sallaShipmentId ? 'label_ready' : 'queued',
      attempts: 0,
      nextAttemptAt: new Date(),
      blockReason: null,
      lastError: null,
      lockedUntil: null,
      // A supervisor retry may send the order from any status they've fixed.
      source: 'manual',
    },
  });
  if (!task.sallaShipmentId) await processShippingTask(taskId, { force: true });
  return { ok: true as const, message: 'أُعيدت المحاولة' };
}

/** Supervisor: dealt with outside the system (cancelled, shipped by hand…). */
export async function closeShippingTask(taskId: string) {
  await prisma.shippingTask.update({ where: { id: taskId }, data: { state: 'cancelled', lockedUntil: null } });
  return { ok: true as const, message: 'أُغلقت المهمة' };
}
