import type { ShippingTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { promoLimitBlock } from '@/app/lib/promo-limit';
import { fetchLiveOrder, refreshMirrorFromLive } from '@/app/lib/order-prep/salla-live';
import {
  LABEL_GIVE_UP_AFTER_MS,
  LABEL_RECONCILE_AFTER_MS,
  MAX_CREATE_ATTEMPTS,
  decideCreate,
  nextBackoffMs,
  type OutgoingShipment,
} from './rules';
import { createShippingPolicy, fetchOutgoingShipment } from './salla-policy';
import { getShippingSettings } from './settings';
import { ensureShippingTask, findPackedOrdersWithoutTask } from './tasks';

/**
 * The background side of shipping v2: create the Salla shipment for packed
 * orders, and chase labels that are late. Every step is safe to repeat, and a
 * create request is never re-sent once its outcome is unclear — the order is
 * checked in Salla instead, so one order never gets two waybills.
 */

const LOCK_MS = 90_000;
const SALLA_TIMEOUT_MS = 12_000;

export type TaskOutcome = 'created' | 'adopted' | 'waiting' | 'deferred' | 'blocked' | 'retry' | 'failed' | 'skipped';

async function lockTask(taskId: string, force: boolean): Promise<ShippingTask | null> {
  const now = new Date();
  const rows = await prisma.shippingTask.updateManyAndReturn({
    where: {
      id: taskId,
      method: 'salla',
      state: { in: ['queued', 'creating'] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      ...(force ? {} : { nextAttemptAt: { lte: now } }),
    },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return rows[0] ?? null;
}

async function release(task: ShippingTask, data: Partial<ShippingTask>) {
  await prisma.shippingTask.update({ where: { id: task.id }, data: { ...data, lockedUntil: null } });
}

/** Leaves "creating" only if nothing (the label webhook) moved the task meanwhile. */
async function afterCreate(task: ShippingTask, data: Partial<ShippingTask>) {
  const updated = await prisma.shippingTask.updateMany({
    where: { id: task.id, state: 'creating' },
    data: { ...data, lockedUntil: null } as any,
  });
  if (updated.count === 0) {
    await prisma.shippingTask.update({
      where: { id: task.id },
      data: { operationRef: data.operationRef ?? undefined, attempts: data.attempts ?? undefined, lockedUntil: null },
    });
  }
}

async function retryLater(task: ShippingTask, error: string, retryAfterMs?: number | null): Promise<TaskOutcome> {
  const attempts = task.attempts + 1;
  const failed = attempts >= MAX_CREATE_ATTEMPTS;
  await release(task, {
    attempts,
    state: failed ? 'failed' : 'queued',
    lastError: error.slice(0, 1000),
    nextAttemptAt: new Date(Date.now() + nextBackoffMs(attempts, retryAfterMs)),
  });
  log.warn('Shipping task attempt failed', { taskId: task.id, orderId: task.orderId, attempts, error: error.slice(0, 300) });
  return failed ? 'failed' : 'retry';
}

async function block(task: ShippingTask, reason: string): Promise<TaskOutcome> {
  await release(task, { state: 'blocked', blockReason: reason.slice(0, 300), lastError: null });
  log.warn('Shipping task blocked', { taskId: task.id, orderId: task.orderId, reason });
  return 'blocked';
}

/**
 * Stores a waybill Salla already made (found through its shipments list) the
 * way the webhook would, and marks the task ready to print.
 */
async function adoptShipment(task: ShippingTask, shipment: OutgoingShipment): Promise<TaskOutcome> {
  const courier = shipment.courierName || 'Unknown';
  const fields = {
    orderNumber: task.orderNumber || task.orderId,
    trackingNumber: shipment.trackingNumber || shipment.trackingLink || '',
    courierName: courier,
    courierCode: courier.toLowerCase().replace(/\s+/g, '_'),
    status: shipment.status || 'created',
    labelUrl: shipment.labelUrl,
    shipmentData: {
      shipment_id: shipment.id,
      tracking_link: shipment.trackingLink,
      tracking_number: shipment.trackingNumber,
      label_url: shipment.labelUrl,
      source: 'shipping-v2.adopt',
    },
  };
  const stored = await prisma.sallaShipment.upsert({
    where: { merchantId_orderId: { merchantId: task.merchantId, orderId: task.orderId } },
    create: { merchantId: task.merchantId, orderId: task.orderId, ...fields },
    update: { labelUrl: shipment.labelUrl, trackingNumber: fields.trackingNumber, courierName: courier, status: fields.status },
    select: { id: true, printCount: true, labelPrinted: true },
  });
  const printed = stored.labelPrinted || stored.printCount > 0;
  await release(task, {
    state: printed ? 'printed' : 'label_ready',
    sallaShipmentId: stored.id,
    labelReadyAt: new Date(),
    lastError: null,
  });
  return 'adopted';
}

/**
 * Moves one Salla-courier task forward: checks, then asks Salla for the
 * shipment. `force` skips the schedule and the pre-create switch (a shipper
 * asked for it at the station).
 */
export async function processShippingTask(taskId: string, options: { force?: boolean } = {}): Promise<TaskOutcome> {
  const force = Boolean(options.force);
  const task = await lockTask(taskId, force);
  if (!task) return 'skipped';

  try {
    if (!force && task.state === 'queued') {
      const settings = await getShippingSettings();
      if (!settings.precreateEnabled) {
        // Waits for the shipper to scan it (the station forces it then).
        await release(task, { nextAttemptAt: new Date(Date.now() + 5 * 60_000) });
        return 'deferred';
      }
    }

    // A label we already have is never asked for again.
    const stored = await prisma.sallaShipment.findUnique({
      where: { merchantId_orderId: { merchantId: task.merchantId, orderId: task.orderId } },
      select: { id: true, labelUrl: true, printCount: true },
    });
    if (stored?.labelUrl) {
      await release(task, {
        state: stored.printCount > 0 ? 'printed' : 'label_ready',
        sallaShipmentId: stored.id,
        labelReadyAt: new Date(),
        lastError: null,
      });
      return 'adopted';
    }

    if (task.state === 'queued') {
      // Salla should see "جاري التجهيز" before the shipment: wait for the
      // pack's status update to go through first.
      if (task.source === 'prep') {
        const packed = await prisma.orderPrepSallaSync.findFirst({
          where: { merchantId: task.merchantId, orderId: task.orderId, kind: 'packed' },
          orderBy: { createdAt: 'desc' },
          select: { state: true },
        });
        if (packed && packed.state === 'conflict') {
          return block(task, 'تعارض في حالة الطلب عند التجهيز — راجع لوحة التجهيز');
        }
        if (packed && packed.state !== 'synced') {
          await release(task, { nextAttemptAt: new Date(Date.now() + 30_000) });
          return 'deferred';
        }
      }

      const doNotShip = await prisma.orderDoNotShipFlag.findUnique({
        where: { merchantId_orderId: { merchantId: task.merchantId, orderId: task.orderId } },
        select: { id: true },
      });
      if (doNotShip) return block(task, 'الطلب موقوف عن الشحن (لا تشحن)');

      const promo = await promoLimitBlock({
        merchantId: task.merchantId,
        orderId: task.orderId,
        orderNumber: task.orderNumber,
        context: 'shipping-v2.precreate',
        fetchLive: false,
      });
      if (promo) return block(task, promo.error || 'تجاوز حد عرض الريال');
    }

    const [live, existing] = await Promise.all([
      fetchLiveOrder(task.merchantId, task.orderId, { timeoutMs: SALLA_TIMEOUT_MS }),
      fetchOutgoingShipment(task.merchantId, task.orderId, { timeoutMs: SALLA_TIMEOUT_MS }),
    ]);
    if (live.kind === 'rate_limited') return retryLater(task, 'salla_rate_limited', live.retryAfterMs);
    if (existing.kind === 'rate_limited') return retryLater(task, 'salla_rate_limited', existing.retryAfterMs);
    if (live.kind === 'error') return retryLater(task, live.message);
    // Without the shipments list we can't rule out an existing waybill.
    if (existing.kind === 'error') return retryLater(task, existing.message);
    if (live.kind === 'not_found') return block(task, 'الطلب غير موجود في سلة');

    if (existing.kind === 'found') return adoptShipment(task, existing.shipment);
    if (task.state === 'creating') {
      // A create call may already have gone out (we stopped mid-way). Never
      // send it again blind: wait for the label instead.
      await release(task, { state: 'awaiting_label', creatingAt: task.creatingAt ?? new Date() });
      return 'waiting';
    }

    const decision = decideCreate({
      liveStatusId: live.statusCustomId,
      liveStatusName: live.statusName,
      hasLabel: false,
      manual: task.source === 'manual',
    });
    if (decision.action === 'wait_label') {
      await release(task, { state: 'awaiting_label', creatingAt: new Date() });
      return 'waiting';
    }
    if (decision.action === 'block') {
      await refreshMirrorFromLive(task.merchantId, live.detail);
      return block(task, decision.reason);
    }

    // Recorded before the call: if we stop after it, the next run checks
    // Salla instead of creating a second shipment.
    const creatingAt = new Date();
    await prisma.shippingTask.update({ where: { id: task.id }, data: { state: 'creating', creatingAt } });
    const result = await createShippingPolicy(task.merchantId, task.orderId, { timeoutMs: 15_000 });
    switch (result.kind) {
      case 'accepted':
        // The webhook may already have delivered the label (→ label_ready);
        // only a task still "creating" moves to waiting.
        await afterCreate(task, {
          state: 'awaiting_label',
          creatingAt,
          operationRef: result.operationId,
          attempts: task.attempts + 1,
          lastError: null,
        });
        await prisma.sallaOrder
          .updateMany({ where: { merchantId: task.merchantId, orderId: task.orderId }, data: { fulfillmentStatus: 'processing' } })
          .catch(() => undefined);
        log.info('Shipping policy requested', { taskId: task.id, orderId: task.orderId, operationId: result.operationId });
        return 'created';
      case 'rate_limited':
        return retryLater({ ...task, state: 'queued' }, 'salla_rate_limited', result.retryAfterMs);
      case 'rejected':
        return retryLater({ ...task, state: 'queued' }, `سلة رفضت إنشاء الشحنة: ${result.message}`);
      case 'unknown':
        await afterCreate(task, { state: 'awaiting_label', creatingAt, lastError: `unclear: ${result.message}`.slice(0, 500) });
        return 'waiting';
    }
  } catch (error) {
    // Unexpected: if a create went out we must not send it again, so a task
    // caught mid-create stays "creating" and is checked live next time.
    const message = error instanceof Error ? error.message : 'unknown_error';
    const current = await prisma.shippingTask.findUnique({ where: { id: task.id }, select: { state: true } });
    if (current?.state === 'creating') {
      await release(task, { lastError: message.slice(0, 500), nextAttemptAt: new Date(Date.now() + 60_000) });
      return 'retry';
    }
    return retryLater(task, message);
  }
}

/**
 * Late labels: a create that Salla accepted but whose label hasn't come by
 * webhook. Checked live after a few minutes; handed to a person after 30.
 */
export async function reconcileAwaitingLabels(options: { limit?: number; budgetMs?: number } = {}) {
  const now = Date.now();
  const deadline = now + (options.budgetMs ?? 40_000);
  const tasks = await prisma.shippingTask.findMany({
    where: {
      state: 'awaiting_label',
      creatingAt: { lt: new Date(now - LABEL_RECONCILE_AFTER_MS) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now) } }],
    },
    orderBy: { creatingAt: 'asc' },
    take: options.limit ?? 15,
  });
  const results = { adopted: 0, waiting: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const candidate of tasks) {
    if (Date.now() > deadline) break;
    const locked = await prisma.shippingTask.updateManyAndReturn({
      where: { id: candidate.id, state: 'awaiting_label', OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
      data: { lockedUntil: new Date(Date.now() + LOCK_MS) },
    });
    const task = locked[0];
    if (!task) {
      results.skipped += 1;
      continue;
    }
    const existing = await fetchOutgoingShipment(task.merchantId, task.orderId, { timeoutMs: SALLA_TIMEOUT_MS });
    if (existing.kind === 'rate_limited') {
      await release(task, {});
      break;
    }
    if (existing.kind === 'found') {
      await adoptShipment(task, existing.shipment);
      results.adopted += 1;
      continue;
    }
    const waitedMs = Date.now() - (task.creatingAt?.getTime() ?? Date.now());
    if (waitedMs > LABEL_GIVE_UP_AFTER_MS) {
      await release(task, {
        state: 'failed',
        lastError: 'لم تصل البوليصة من سلة خلال 30 دقيقة — تحقق من الطلب في سلة ثم أعد المحاولة',
      });
      results.failed += 1;
    } else {
      await release(task, {});
      results.waiting += 1;
    }
  }
  return { considered: tasks.length, results };
}

/** Cron: tasks for packed orders the hook missed, then due creates. */
export async function processDueShippingTasks(options: { limit?: number; budgetMs?: number } = {}) {
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  let created = 0;
  for (const orderId of await findPackedOrdersWithoutTask(50)) {
    const task = await ensureShippingTask(orderId, 'prep').catch((error) => {
      log.warn('Failed to create shipping task', { orderId, error: error instanceof Error ? error.message : error });
      return null;
    });
    if (task) created += 1;
  }

  const due = await prisma.shippingTask.findMany({
    where: {
      method: 'salla',
      state: { in: ['queued', 'creating'] },
      nextAttemptAt: { lte: new Date() },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 20,
    select: { id: true },
  });
  const results: Record<TaskOutcome, number> = {
    created: 0,
    adopted: 0,
    waiting: 0,
    deferred: 0,
    blocked: 0,
    retry: 0,
    failed: 0,
    skipped: 0,
  };
  for (const { id } of due) {
    if (Date.now() > deadline) break;
    const outcome = await processShippingTask(id);
    results[outcome] += 1;
    if (outcome === 'retry') {
      const task = await prisma.shippingTask.findUnique({ where: { id }, select: { lastError: true } });
      if (task?.lastError === 'salla_rate_limited') break;
    }
  }
  return { tasksCreated: created, considered: due.length, results };
}

/**
 * After a pack: make the order's task and, for courier orders, start the
 * shipment straight away (runs after the pack's Salla status update).
 */
export async function startShippingAfterPack(orderId: string): Promise<void> {
  try {
    const task = await ensureShippingTask(orderId, 'prep');
    if (task && task.method === 'salla' && task.state === 'queued') {
      await processShippingTask(task.id);
    }
  } catch (error) {
    log.error('Failed to start shipping after pack', { orderId, error: error instanceof Error ? error.message : error });
  }
}
