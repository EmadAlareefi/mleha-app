import { Prisma, type OrderPrepAssignment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { detectInternationalOrder } from '@/app/lib/order-destination';
import { resolveOrderPrepSallaStatusId } from '@/app/lib/order-prep-salla-status';
import { getPromoProductIds, promoLimitBlock } from '@/app/lib/promo-limit';
import { getViolatingPromoOrderIds } from '@/app/lib/promo-limit-monitor';
import { loadLocations } from './locations';
import { buildPrepOrder, trimOrderData } from './payload';
import {
  buildProblemNote,
  decideProblemOutcome,
  outcomeEscalationReason,
  outcomeTargetStatusId,
} from './problem-rules';
import { placedAtCutoff, riyadhStartOfDayUtc, toSqlTimestamp } from './riyadh-time';
import { lockPrepQueue } from './claim-lock';
import { getPrepSettings, type PrepSettings } from './settings';
import {
  agedSql,
  guardActive,
  loadResolvedPriority,
  NO_PRIORITY,
  priorityHeadSql,
  prioritySortSql,
  ruleMatchSql,
  ruleTierSql,
  SAR_TOTAL_SQL,
  type ResolvedPriority,
} from './priority-rules';
import { NEW_ORDER_STATUS_ID } from './sync-rules';
import { loadLastStops, type StopReason } from './stop-reason';
import type {
  ActionError,
  ItemCheck,
  PrepAssignmentView,
  PrepOrder,
  PrepSlotStatus,
  PrepState,
  ProblemItem,
  QueueStats,
} from './types';

/**
 * The order prep queue, served entirely from the local Salla mirror
 * (SallaOrder, kept fresh by webhooks): no Salla call is ever made while a
 * packer waits. Each packer holds at most two claims — the order on screen
 * (`preparing`) and the next one, already loaded (`assigned`). Claims carry a
 * lease that the page renews; an expired one returns the order to the queue.
 * All claims go through one advisory lock, so no order is ever held twice.
 */

export const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const ACTIVE_STATUSES: PrepSlotStatus[] = ['assigned', 'preparing'];
// Prod runs next to the DB (~2 ms per query); the timeout leaves room for slow links.
const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

type Tx = Prisma.TransactionClient;
export type PrepUser = { id: string; name: string };
export type ActionResult = { ok: true; syncJobIds: string[] } | { ok: false; error: ActionError; status: number };

export type QueueContext = {
  settings: PrepSettings;
  promoIds: string[];
  violatorIds: string[];
  nowMs: number;
  /** Supervisor priority rules (priority-rules.ts); absent = none. */
  priority?: ResolvedPriority;
};

async function loadQueueContext(): Promise<QueueContext> {
  const nowMs = Date.now();
  const [settings, promoIds, violators, priority] = await Promise.all([
    getPrepSettings(),
    getPromoProductIds(MERCHANT_ID).catch((): string[] => []),
    getViolatingPromoOrderIds(MERCHANT_ID).catch(() => new Set<string>()),
    loadResolvedPriority(nowMs),
  ]);
  return { settings, promoIds, violatorIds: [...violators], nowMs, priority };
}

const leaseUntil = (ctx: QueueContext) => new Date(ctx.nowMs + ctx.settings.leaseMinutes * 60_000);

const nowSql = (ctx: QueueContext) => toSqlTimestamp(new Date(ctx.nowMs));

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Orders a packer may be given: "طلب جديد", paid, untouched, not blocked, and
 * not being changed by their customer right now (CustomerOrderChange hold), and
 * not waiting for its customer to complete the shipping info (ShippingInfoRequest).
 * A replacement order the returns app created waits until its return passed
 * inspection (exchangeOrderHoldActive) — the Salla hold status alone can lag the
 * payment webhook by a few seconds. Fully covered replacements stay "pending
 * payment" in Salla, so released ones are let through that filter.
 */
function eligibleWhere(ctx: QueueContext): Prisma.Sql {
  return Prisma.sql`
    s."merchantId" = ${MERCHANT_ID}
    AND s."statusCustomId" = ${NEW_ORDER_STATUS_ID}
    AND (
      s."isPendingPayment" IS NOT TRUE
      OR EXISTS (
        SELECT 1 FROM "ReturnRequest" rp
        WHERE rp."merchantId" = s."merchantId" AND rp."exchangeOrderId" = s."orderId" AND rp."exchangeMode" = 'order'
          AND rp."exchangePaymentStatus" = 'not_required' AND rp."exchangeOrderHoldActive" = false
          AND rp."exchangeOrderReleasedAt" IS NOT NULL
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM "ReturnRequest" rr
      WHERE rr."merchantId" = s."merchantId" AND rr."exchangeOrderId" = s."orderId" AND rr."exchangeMode" = 'order'
        AND (rr."exchangeOrderHoldActive" = true OR rr."exchangePaymentStatus" IN ('creating', 'pending', 'expiring'))
    )
    AND NOT EXISTS (SELECT 1 FROM "OrderPrepAssignment" a WHERE a."merchantId" = s."merchantId" AND a."orderId" = s."orderId")
    AND NOT EXISTS (SELECT 1 FROM "SallaShipment" sh WHERE sh."merchantId" = s."merchantId" AND sh."orderId" = s."orderId")
    AND NOT EXISTS (
      SELECT 1 FROM "OrderPrepEscalation" e
      WHERE e."merchantId" = s."merchantId" AND e."orderId" = s."orderId" AND e."resolvedAt" IS NULL
    )
    AND NOT EXISTS (SELECT 1 FROM "OrderDoNotShipFlag" d WHERE d."merchantId" = s."merchantId" AND d."orderId" = s."orderId")
    AND NOT EXISTS (
      SELECT 1 FROM "CustomerOrderChange" c
      WHERE c."merchantId" = s."merchantId" AND c."orderId" = s."orderId" AND c."holdActive" = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM "ShippingInfoRequest" si
      WHERE si."merchantId" = s."merchantId" AND si."orderId" = s."orderId" AND si."holdActive" = true
    )
    AND NOT (s."orderId" = ANY(${ctx.violatorIds}::text[]))
  `;
}

function campaignActive(ctx: QueueContext): boolean {
  return ctx.settings.priorityMode === 'regular_first' && ctx.promoIds.length > 0;
}

/** 1 for a promo order still inside the campaign age cap (goes after regular orders). */
function promoLaneSql(ctx: QueueContext): Prisma.Sql {
  return Prisma.sql`CASE WHEN s."placedAt" > ${toSqlTimestamp(placedAtCutoff(ctx.settings.promoAgingHours, ctx.nowMs))}::timestamp
        AND EXISTS (
          SELECT 1 FROM "SallaOrderItem" i
          WHERE i."merchantId" = s."merchantId" AND i."orderId" = s."orderId" AND i."productId" = ANY(${ctx.promoIds}::text[])
        ) THEN 1 ELSE 0 END`;
}

/**
 * High-priority flag first; then the supervisor's priority rules (max-wait
 * guard, rule tier — see priority-rules.ts); in campaign mode, promo orders
 * younger than the age cap go after regular ones; then the chosen sort
 * (oldest first by default).
 */
function priorityOrder(ctx: QueueContext): Prisma.Sql {
  const priority = ctx.priority ?? NO_PRIORITY;
  // Pieces are left out entirely when off: a bare constant in ORDER BY would
  // be read by Postgres as a column position.
  const promoLane = campaignActive(ctx) ? Prisma.sql`${promoLaneSql(ctx)} ASC,` : Prisma.empty;
  return Prisma.sql`(hp."id" IS NULL) ASC, ${priorityHeadSql(priority, ctx.nowMs)} ${promoLane} ${prioritySortSql(priority.sort)}, s."orderId" ASC`;
}

/** The queue pick, oldest eligible first (exported for tests and EXPLAIN checks). */
export function buildPickSql(ctx: QueueContext, options: { limit: number; only?: string[]; exclude?: string[] }): Prisma.Sql {
  const only = options.only && options.only.length > 0 ? Prisma.sql`AND s."orderId" = ANY(${options.only}::text[])` : Prisma.empty;
  const exclude =
    options.exclude && options.exclude.length > 0 ? Prisma.sql`AND NOT (s."orderId" = ANY(${options.exclude}::text[]))` : Prisma.empty;
  return Prisma.sql`
    SELECT s."orderId"
    FROM "SallaOrder" s
    LEFT JOIN "HighPriorityOrder" hp ON hp."merchantId" = s."merchantId" AND hp."orderId" = s."orderId"
    WHERE ${eligibleWhere(ctx)} ${only} ${exclude}
    ORDER BY ${priorityOrder(ctx)}
    LIMIT ${options.limit}
  `;
}

async function pickOrderIds(
  tx: Tx,
  ctx: QueueContext,
  options: { limit: number; only?: string[]; exclude?: string[] },
): Promise<string[]> {
  if (options.limit <= 0) return [];
  const rows = await tx.$queryRaw<Array<{ orderId: string }>>(buildPickSql(ctx, options));
  return rows.map((row) => row.orderId);
}

async function lockQueue(tx: Tx) {
  await lockPrepQueue(tx, MERCHANT_ID);
}

/** Drops v2 claims whose lease ran out; v1 rows (no lease) are never touched. */
async function expireLeases(tx: Tx, ctx: QueueContext) {
  const expired = await tx.$queryRaw<Array<{ id: string; orderId: string; userId: string; status: string }>>`
    DELETE FROM "OrderPrepAssignment"
    WHERE "merchantId" = ${MERCHANT_ID}
      AND "status" IN ('assigned', 'preparing')
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" < ${nowSql(ctx)}::timestamp
    RETURNING "id", "orderId", "userId", "status"
  `;
  if (expired.length > 0) {
    log.info('Order prep claims expired and returned to the queue', {
      claims: expired.map((row) => ({ orderId: row.orderId, userId: row.userId, status: row.status })),
    });
  }
}

async function buildOrderForClaim(tx: Tx, orderId: string, ctx: QueueContext) {
  const order = await tx.sallaOrder.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
    select: {
      orderId: true,
      orderNumber: true,
      referenceId: true,
      placedAt: true,
      rawOrder: true,
      items: { select: { sku: true, name: true, quantity: true, productId: true } },
    },
  });
  if (!order) return null;
  const rawItems = Array.isArray((order.rawOrder as any)?.items) ? ((order.rawOrder as any).items as any[]) : [];
  const skus = [...rawItems.map((item) => item?.sku ?? item?.product?.sku), ...order.items.map((item) => item.sku)];
  const productIds = [...rawItems.map((item) => (item?.product?.id ? String(item.product.id) : null)), ...order.items.map((item) => item.productId)];
  const locations = await loadLocations(skus, productIds, tx);
  const giftFlag = await tx.orderGiftFlag.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
    select: { id: true },
  });
  const highPriority = await tx.highPriorityOrder.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
    select: { id: true },
  });
  const prep = buildPrepOrder({
    orderId,
    orderNumber: order.referenceId || order.orderNumber || null,
    placedAt: order.placedAt,
    rawOrder: order.rawOrder,
    storedItems: order.items,
    locations,
    giftFlagged: Boolean(giftFlag),
    highPriority: Boolean(highPriority),
    promoProductIds: new Set(ctx.promoIds),
  });
  return { order, prep };
}

async function createClaim(
  tx: Tx,
  user: PrepUser,
  orderId: string,
  status: PrepSlotStatus,
  ctx: QueueContext,
): Promise<OrderPrepAssignment | null> {
  const built = await buildOrderForClaim(tx, orderId, ctx);
  if (!built) return null;
  const { order, prep } = built;
  return tx.orderPrepAssignment.create({
    data: {
      merchantId: MERCHANT_ID,
      userId: user.id,
      userName: user.name || 'المستخدم',
      orderId,
      orderNumber: prep.orderNumber,
      orderReference: order.referenceId || prep.orderNumber,
      orderData: { ...trimOrderData(order.rawOrder), prep } as unknown as Prisma.InputJsonValue,
      status,
      startedAt: status === 'preparing' ? new Date(ctx.nowMs) : null,
      leaseExpiresAt: leaseUntil(ctx),
    },
  });
}

type PreferredSlot = { orderId: string; slot: PrepSlotStatus };

/**
 * Tops the packer up to one order on screen and one ready next, renewing the
 * leases of what they hold. `prefer` re-claims orders the phone still shows
 * after a lapsed lease (when nobody else took them); `exclude` keeps a just
 * released order from coming straight back to the same packer.
 */
async function fillSlots(
  tx: Tx,
  user: PrepUser,
  ctx: QueueContext,
  options: { prefer?: PreferredSlot[]; exclude?: string[] } = {},
) {
  const held = await tx.orderPrepAssignment.findMany({
    where: { merchantId: MERCHANT_ID, userId: user.id, status: { in: ACTIVE_STATUSES } },
    orderBy: { assignedAt: 'asc' },
    select: { id: true, status: true, orderId: true },
  });
  let hasPreparing = held.some((row) => row.status === 'preparing');
  let hasAssigned = held.some((row) => row.status === 'assigned');
  const lease = leaseUntil(ctx);

  if (held.length > 0) {
    await tx.orderPrepAssignment.updateMany({
      where: { id: { in: held.map((row) => row.id) } },
      data: { leaseExpiresAt: lease },
    });
  }

  if (!hasPreparing && hasAssigned) {
    const promote = held.find((row) => row.status === 'assigned')!;
    await tx.orderPrepAssignment.update({
      where: { id: promote.id },
      data: { status: 'preparing', startedAt: new Date(ctx.nowMs), leaseExpiresAt: lease },
    });
    hasPreparing = true;
    hasAssigned = held.filter((row) => row.status === 'assigned').length > 1;
  }

  const needed: PrepSlotStatus[] = [];
  if (!hasPreparing) needed.push('preparing');
  if (!hasAssigned) needed.push('assigned');
  if (needed.length === 0) return;

  const heldIds = held.map((row) => row.orderId);
  const exclude = [...heldIds, ...(options.exclude ?? [])];
  const preferred = (options.prefer ?? []).filter((entry) => !heldIds.includes(entry.orderId));

  if (preferred.length > 0) {
    const free = new Set(
      await pickOrderIds(tx, ctx, { limit: preferred.length, only: preferred.map((entry) => entry.orderId), exclude }),
    );
    for (const entry of preferred) {
      if (!free.has(entry.orderId)) continue;
      const slot = needed.includes(entry.slot) ? entry.slot : needed[0];
      if (!slot) break;
      const created = await createClaim(tx, user, entry.orderId, slot, ctx);
      if (created) {
        needed.splice(needed.indexOf(slot), 1);
        exclude.push(entry.orderId);
      }
    }
  }

  if (needed.length === 0) return;
  const picked = await pickOrderIds(tx, ctx, { limit: needed.length, exclude });
  for (let index = 0; index < picked.length; index += 1) {
    await createClaim(tx, user, picked[index], needed[index], ctx);
  }
}

async function runQueueTransaction<T>(work: (tx: Tx, ctx: QueueContext) => Promise<T>): Promise<T> {
  const ctx = await loadQueueContext();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockQueue(tx);
        await expireLeases(tx, ctx);
        return work(tx, ctx);
      }, TX_OPTIONS);
    } catch (error) {
      // Only a v1 page claiming the same order at the same moment can collide.
      if (isUniqueViolation(error) && attempt === 0) continue;
      throw error;
    }
  }
}

/** Start or resume packing: make sure the packer has an order and a next one. */
export async function claimForUser(user: PrepUser, options: { prefer?: PreferredSlot[] } = {}) {
  await runQueueTransaction((tx, ctx) => fillSlots(tx, user, ctx, { prefer: options.prefer }));
}

/** Keep the packer's claims alive; re-claim lapsed ones the phone still shows. */
export async function heartbeat(user: PrepUser, held: PreferredSlot[]) {
  await runQueueTransaction((tx, ctx) => fillSlots(tx, user, ctx, { prefer: held }));
}

const conflict = (message: string): ActionResult => ({ ok: false, status: 409, error: { code: 'conflict', message } });

/** The packer's row for an order: by id, else by order (the id changes after a re-claim). */
async function findOwnRow(tx: Tx, user: PrepUser, assignmentId: string, orderId: string) {
  let row = await tx.orderPrepAssignment.findUnique({ where: { id: assignmentId } });
  if (!row || row.orderId !== orderId) {
    row = await tx.orderPrepAssignment.findUnique({
      where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
    });
  }
  return row;
}

async function isOrderFree(tx: Tx, ctx: QueueContext, orderId: string) {
  const ids = await pickOrderIds(tx, ctx, { limit: 1, only: [orderId] });
  return ids.length === 1;
}

/**
 * Runs `work` only if no packer holds the order and the queue could still hand
 * it out, under the same lock packers claim with. `work` must insert the
 * CustomerOrderChange hold row, which takes the order out of the queue in the
 * same transaction: after it commits, the order cannot be claimed.
 *
 * Expired leases are deliberately not cleared first. A packer whose lease
 * lapsed may still be standing at the shelf with the parcel, so the customer
 * loses to any claim row.
 */
export async function withCustomerHold<T>(
  orderId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'not_free' }> {
  const ctx = await loadQueueContext();
  try {
    return await prisma.$transaction(async (tx) => {
      await lockQueue(tx);
      if (!(await isOrderFree(tx, ctx, orderId))) return { ok: false as const, reason: 'not_free' as const };
      return { ok: true as const, value: await work(tx) };
    }, TX_OPTIONS);
  } catch (error) {
    // The partial unique index on active holds: another change got there first.
    if (isUniqueViolation(error)) return { ok: false, reason: 'not_free' };
    throw error;
  }
}

function withItemChecks(orderData: Prisma.JsonValue, checks: ItemCheck[], shortages: ProblemItem[]) {
  const base = orderData && typeof orderData === 'object' && !Array.isArray(orderData) ? (orderData as Record<string, unknown>) : {};
  const short = new Set(shortages.map((item) => item.index));
  const recordedAt = new Date().toISOString();
  return {
    ...base,
    prepItemChecks: checks,
    // Same shape the old page wrote, for readers of prepItemStatuses.
    prepItemStatuses: checks.map((check) => ({
      index: check.index,
      sku: check.sku,
      normalizedSku: check.sku ? check.sku.trim().toUpperCase() : null,
      status: short.has(check.index) ? 'unavailable' : 'ready',
      name: null,
      recordedAt,
    })),
  } as Prisma.InputJsonValue;
}

async function recordShortages(tx: Tx, user: PrepUser, orderId: string, orderNumber: string, items: ProblemItem[]) {
  for (const item of items) {
    if (item.reason !== 'not_found' && item.reason !== 'damaged') continue;
    const sku = item.sku?.trim();
    if (!sku) continue;
    const normalizedSku = sku.toUpperCase();
    await tx.orderPrepUnavailableItem.upsert({
      where: { merchantId_orderId_normalizedSku: { merchantId: MERCHANT_ID, orderId, normalizedSku } },
      create: {
        merchantId: MERCHANT_ID,
        orderId,
        orderNumber,
        sku,
        normalizedSku,
        itemName: item.name,
        reportedById: user.id,
        reportedByName: user.name,
        reason: item.reason,
      },
      update: {
        itemName: item.name,
        reportedById: user.id,
        reportedByName: user.name,
        reason: item.reason,
        resolvedAt: null,
        resolvedById: null,
        resolvedByName: null,
        resolution: null,
      },
    });
  }
}

/**
 * Done: mark the order packed, queue its Salla update, move the next order on
 * screen and claim a new next — one transaction, no Salla call. Repeating it
 * (a retried request) returns success without doing anything twice.
 */
export async function completeAssignment(
  user: PrepUser,
  input: { assignmentId: string; orderId: string; itemChecks: ItemCheck[]; scanMethod: 'scan' | 'manual'; shortages?: ProblemItem[] },
): Promise<ActionResult> {
  const blocked = await promoLimitBlock({
    merchantId: MERCHANT_ID,
    orderId: input.orderId,
    context: 'order-prep-v2.complete',
    userId: user.id,
    fetchLive: false,
  });
  if (blocked) {
    return { ok: false, status: 409, error: { code: 'promo_limit', message: blocked.error } };
  }

  return runQueueTransaction(async (tx, ctx) => {
    let row = await findOwnRow(tx, user, input.assignmentId, input.orderId);
    if (row && row.userId !== user.id) {
      return conflict(`الطلب انتقل إلى ${row.userName} — أعد القطعة أو سلّمها له`);
    }
    if (row && row.status === 'completed') return { ok: true, syncJobIds: [] } as ActionResult;
    if (row && !ACTIVE_STATUSES.includes(row.status as PrepSlotStatus)) {
      return conflict('حالة الطلب لا تسمح بإنهائه');
    }
    if (!row) {
      // The lease lapsed (phone locked) and the claim was dropped. The pack
      // still counts if nobody else has taken the order since.
      if (!(await isOrderFree(tx, ctx, input.orderId))) {
        return conflict('الطلب لم يعد متاحاً (أُلغي أو تغيّرت حالته أو أخذه زميل)');
      }
      row = await createClaim(tx, user, input.orderId, 'preparing', ctx);
      if (!row) return conflict('تعذر العثور على الطلب');
    }

    const now = new Date(ctx.nowMs);
    const isInternational = detectInternationalOrder(row.orderData).isInternational;
    const targetStatusId = resolveOrderPrepSallaStatusId('completed', isInternational)!;
    const shortages = input.shortages ?? [];
    const orderNumber = row.orderNumber || row.orderReference || row.orderId;

    await tx.orderPrepAssignment.update({
      where: { id: row.id },
      data: {
        status: 'completed',
        completedAt: now,
        startedAt: row.startedAt ?? now,
        leaseExpiresAt: null,
        scanMethod: input.scanMethod,
        orderData: withItemChecks(row.orderData, input.itemChecks, shortages),
      },
    });
    if (shortages.length > 0) {
      await recordShortages(tx, user, row.orderId, orderNumber, shortages);
    }
    await tx.orderPrepEscalation.updateMany({
      where: { merchantId: MERCHANT_ID, orderId: row.orderId, resolvedAt: null },
      data: { resolvedAt: now, resolvedById: user.id, resolvedByName: user.name },
    });
    const job = await tx.orderPrepSallaSync.create({
      data: {
        merchantId: MERCHANT_ID,
        orderId: row.orderId,
        orderNumber,
        kind: 'packed',
        targetStatusId,
        assignmentId: row.id,
        createdById: user.id,
        createdByName: user.name,
      },
    });

    await fillSlots(tx, user, ctx);
    return { ok: true, syncJobIds: [job.id] } as ActionResult;
  });
}

/**
 * The packer can't pack the order as is. Items missing on some lines only →
 * ship the rest (completeAssignment with shortages). Otherwise escalate: the
 * order leaves prep (X4 or review) until a supervisor sends it back.
 */
export async function reportProblem(
  user: PrepUser,
  input: { assignmentId: string; orderId: string; items: ProblemItem[]; note?: string | null; itemChecks?: ItemCheck[] },
): Promise<ActionResult> {
  const preview = await prisma.orderPrepAssignment.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId: input.orderId } },
    select: { orderData: true },
  });
  const previewData = (preview?.orderData ?? {}) as Record<string, any>;
  const itemCount =
    (previewData.prep as PrepOrder | undefined)?.items?.length ??
    (Array.isArray(previewData.items) ? previewData.items.length : input.items.length);
  const outcome = decideProblemOutcome(itemCount, input.items);
  if (!outcome) {
    return { ok: false, status: 400, error: { code: 'invalid', message: 'حدد المنتج وسبب المشكلة' } };
  }
  if (outcome === 'refund' && !input.note?.trim()) {
    return { ok: false, status: 400, error: { code: 'invalid', message: 'اكتب سبب إيقاف الطلب (X4)' } };
  }
  if (outcome === 'partial') {
    return completeAssignment(user, {
      assignmentId: input.assignmentId,
      orderId: input.orderId,
      itemChecks: input.itemChecks ?? [],
      scanMethod: 'manual',
      shortages: input.items,
    });
  }

  return runQueueTransaction(async (tx, ctx) => {
    const row = await findOwnRow(tx, user, input.assignmentId, input.orderId);
    if (row && row.userId !== user.id) {
      return conflict(`الطلب انتقل إلى ${row.userName}`);
    }
    if (row && !ACTIVE_STATUSES.includes(row.status as PrepSlotStatus)) {
      return conflict('حالة الطلب لا تسمح بتسجيل مشكلة');
    }
    if (!row && !(await isOrderFree(tx, ctx, input.orderId))) {
      return conflict('الطلب لم يعد متاحاً (أُلغي أو تغيّرت حالته أو أخذه زميل)');
    }

    const orderNumber = row?.orderNumber || row?.orderReference || input.orderId;
    const note = buildProblemNote(orderNumber, input.items, input.note);
    const targetStatusId = outcomeTargetStatusId(outcome);

    await recordShortages(tx, user, input.orderId, orderNumber, input.items);
    const escalation = await tx.orderPrepEscalation.create({
      data: {
        merchantId: MERCHANT_ID,
        orderId: input.orderId,
        orderNumber,
        reason: outcomeEscalationReason(outcome, input.items),
        statusTarget: outcome === 'refund' ? 'under_review_x4' : 'under_review_a',
        notes: note,
        createdById: user.id,
        createdByName: user.name,
      },
    });
    if (row) await tx.orderPrepAssignment.delete({ where: { id: row.id } });
    await tx.orderAssignment.deleteMany({ where: { merchantId: MERCHANT_ID, orderId: input.orderId } });
    const job = await tx.orderPrepSallaSync.create({
      data: {
        merchantId: MERCHANT_ID,
        orderId: input.orderId,
        orderNumber,
        kind: 'exception',
        targetStatusId,
        note,
        escalationId: escalation.id,
        createdById: user.id,
        createdByName: user.name,
      },
    });

    await fillSlots(tx, user, ctx, { exclude: [input.orderId] });
    return { ok: true, syncJobIds: [job.id] } as ActionResult;
  });
}

/**
 * Pause ('all': hand both orders back), or return the order on screen to the
 * queue ('current': the next one moves up and a new next is claimed).
 */
export async function releaseForUser(
  user: PrepUser,
  input: { scope: 'all' | 'current'; reason?: string | null },
): Promise<ActionResult> {
  return runQueueTransaction(async (tx, ctx) => {
    const held = await tx.orderPrepAssignment.findMany({
      where: { merchantId: MERCHANT_ID, userId: user.id, status: { in: ACTIVE_STATUSES } },
      orderBy: { assignedAt: 'asc' },
    });
    const targets =
      input.scope === 'all' ? held : held.filter((row) => row.status === 'preparing').slice(0, 1);
    if (targets.length > 0) {
      await tx.orderPrepAssignment.deleteMany({ where: { id: { in: targets.map((row) => row.id) } } });
      log.info('Order prep claims released by packer', {
        userId: user.id,
        scope: input.scope,
        reason: input.reason?.slice(0, 200) ?? null,
        orders: targets.map((row) => row.orderNumber || row.orderId),
      });
    }
    if (input.scope === 'current') {
      await fillSlots(tx, user, ctx, { exclude: targets.map((row) => row.orderId) });
    }
    return { ok: true, syncJobIds: [] } as ActionResult;
  });
}

// ---------------------------------------------------------------- reading

async function toView(row: OrderPrepAssignment, ctx?: QueueContext, lastStop: StopReason | null = null): Promise<PrepAssignmentView> {
  const data = row.orderData && typeof row.orderData === 'object' && !Array.isArray(row.orderData) ? (row.orderData as Record<string, any>) : {};
  let prep = data.prep as PrepOrder | undefined;
  if (!prep) {
    // A claim made by the old page: build the view from its stored payload.
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const locations = await loadLocations(
      rawItems.map((item: any) => item?.sku ?? item?.product?.sku),
      rawItems.map((item: any) => (item?.product?.id ? String(item.product.id) : null)),
    ).catch(() => []);
    prep = buildPrepOrder({
      orderId: row.orderId,
      orderNumber: row.orderNumber || row.orderReference,
      placedAt: null,
      rawOrder: data,
      locations,
      promoProductIds: new Set(ctx?.promoIds ?? []),
    });
  }
  return {
    assignmentId: row.id,
    status: row.status === 'preparing' ? 'preparing' : 'assigned',
    assignedAt: row.assignedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    verifyIssue: row.verifyIssue ?? null,
    lastStop,
    order: prep,
  };
}

/** Waiting orders by age (exported for tests and EXPLAIN checks). */
export function buildStatsSql(ctx: QueueContext): Prisma.Sql {
  const c24 = toSqlTimestamp(placedAtCutoff(24, ctx.nowMs));
  const c48 = toSqlTimestamp(placedAtCutoff(48, ctx.nowMs));
  const c96 = toSqlTimestamp(placedAtCutoff(96, ctx.nowMs));
  return Prisma.sql`
    SELECT
      count(*)::int AS waiting,
      min(s."placedAt") AS oldest,
      count(*) FILTER (WHERE s."placedAt" > ${c24}::timestamp)::int AS lt24h,
      count(*) FILTER (WHERE s."placedAt" <= ${c24}::timestamp AND s."placedAt" > ${c48}::timestamp)::int AS d1to2,
      count(*) FILTER (WHERE s."placedAt" <= ${c48}::timestamp AND s."placedAt" > ${c96}::timestamp)::int AS d2to4,
      count(*) FILTER (WHERE s."placedAt" <= ${c96}::timestamp)::int AS gt4d
    FROM "SallaOrder" s
    WHERE ${eligibleWhere(ctx)}
  `;
}

const STATS_TTL_MS = 15_000;
let statsCache: { at: number; value: QueueStats } | null = null;
let statsInflight: Promise<QueueStats> | null = null;

/** Waiting orders and their ages (shared by all packers for 15 seconds). */
export async function getQueueStats(options: { fresh?: boolean } = {}): Promise<QueueStats> {
  if (!options.fresh && statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.value;
  if (statsInflight) return statsInflight;
  statsInflight = (async () => {
    const ctx = await loadQueueContext();
    const [row] = await prisma.$queryRaw<
      Array<{ waiting: number; oldest: Date | null; lt24h: number; d1to2: number; d2to4: number; gt4d: number }>
    >(buildStatsSql(ctx));
    const value: QueueStats = {
      waiting: row?.waiting ?? 0,
      oldestPlacedAt: row?.oldest ? row.oldest.toISOString() : null,
      buckets: { lt24h: row?.lt24h ?? 0, d1to2: row?.d1to2 ?? 0, d2to4: row?.d2to4 ?? 0, gt4d: row?.gt4d ?? 0 },
      generatedAt: new Date().toISOString(),
    };
    statsCache = { at: Date.now(), value };
    return value;
  })().finally(() => {
    statsInflight = null;
  });
  return statsInflight;
}

/** The packer's orders and counters. Read-only: never claims anything. */
export async function getStateForUser(userId: string): Promise<PrepState> {
  const [rows, stats, myCompletedToday] = await Promise.all([
    prisma.orderPrepAssignment.findMany({
      where: { merchantId: MERCHANT_ID, userId, status: { in: ACTIVE_STATUSES } },
      orderBy: { assignedAt: 'asc' },
    }),
    getQueueStats(),
    prisma.orderPrepAssignment.count({
      where: { userId, status: 'completed', completedAt: { gte: riyadhStartOfDayUtc() } },
    }),
  ]);
  const current = rows.find((row) => row.status === 'preparing') ?? null;
  const next = rows.find((row) => row.status === 'assigned') ?? null;
  const stops = await loadLastStops([current?.orderId, next?.orderId].filter((id): id is string => Boolean(id))).catch(
    () => new Map<string, StopReason>(),
  );
  return {
    current: current ? await toView(current, undefined, stops.get(current.orderId) ?? null) : null,
    next: next ? await toView(next, undefined, stops.get(next.orderId) ?? null) : null,
    stats,
    myCompletedToday,
  };
}

/** Active claims not yet checked live against Salla (for the background check). */
export async function findUnverifiedClaims(userId: string): Promise<Array<{ id: string; status: string }>> {
  return prisma.orderPrepAssignment.findMany({
    where: { merchantId: MERCHANT_ID, userId, status: { in: ACTIVE_STATUSES }, verifiedAt: null },
    select: { id: true, status: true },
    take: 3,
  });
}

export type QueuePreviewRow = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  placedAt: string | null;
  totalSar: number | null;
  company: string | null;
  flagged: boolean;
  aged: boolean;
  promo: boolean;
  /** Id of the rule that set the order's tier; null when no rule matched. */
  ruleId: string | null;
};

export type QueuePreview = {
  total: number;
  flagged: number;
  aged: number;
  /** Waiting orders each live rule matches (an order can match more than one). */
  ruleCounts: Record<string, number>;
  rows: QueuePreviewRow[];
};

/**
 * The next `limit` orders packers would get under `priority` (the saved rules,
 * or a draft from the editor), with why each one sits where it does. Uses the
 * same WHERE and ORDER BY as the real pick; held claims are not counted.
 */
export async function previewQueue(priority: ResolvedPriority, limit = 25): Promise<QueuePreview> {
  const base = await loadQueueContext();
  const ctx: QueueContext = { ...base, priority };
  const tier = ruleTierSql(priority);
  const guard = guardActive(priority);
  const campaign = campaignActive(ctx);
  const from = Prisma.sql`
    FROM "SallaOrder" s
    LEFT JOIN "HighPriorityOrder" hp ON hp."merchantId" = s."merchantId" AND hp."orderId" = s."orderId"
    WHERE ${eligibleWhere(ctx)}`;

  const counts = priority.rules.map((rule, index) =>
    Prisma.sql`count(*) FILTER (WHERE ${ruleMatchSql(rule.match)})::int AS ${Prisma.raw(`"r${index}"`)}`,
  );
  const [countRow] = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`
    SELECT count(*)::int AS "total",
      count(hp."id")::int AS "flagged",
      ${guard ? Prisma.sql`count(*) FILTER (WHERE ${agedSql(priority, ctx.nowMs)})::int` : Prisma.sql`0`} AS "aged"
      ${counts.length ? Prisma.sql`, ${Prisma.join(counts, ', ')}` : Prisma.empty}
    ${from}`);

  const rows = await prisma.$queryRaw<
    Array<{
      orderId: string;
      orderNumber: string | null;
      customerName: string | null;
      placedAt: Date | null;
      totalSar: Prisma.Decimal | null;
      company: string | null;
      flagged: boolean;
      aged: boolean;
      promo: number;
      tier: number | null;
    }>
  >(Prisma.sql`
    SELECT s."orderId", s."orderNumber", s."customerName", s."placedAt",
      ${SAR_TOTAL_SQL} AS "totalSar",
      s."fulfillmentCompany" AS "company",
      (hp."id" IS NOT NULL) AS "flagged",
      ${guard ? Prisma.sql`COALESCE(${agedSql(priority, ctx.nowMs)}, false)` : Prisma.sql`false`} AS "aged",
      ${campaign ? promoLaneSql(ctx) : Prisma.sql`0`} AS "promo",
      ${tier ?? Prisma.sql`NULL::int`} AS "tier"
    ${from}
    ORDER BY ${priorityOrder(ctx)}
    LIMIT ${limit}`);

  const boosts = priority.rules.filter((rule) => rule.effect === 'boost').length;
  const ruleForTier = (value: number | null): string | null => {
    if (value === null || value === boosts) return null;
    return priority.rules[value < boosts ? value : value - 1]?.id ?? null;
  };
  return {
    total: countRow?.total ?? 0,
    flagged: countRow?.flagged ?? 0,
    aged: countRow?.aged ?? 0,
    ruleCounts: Object.fromEntries(priority.rules.map((rule, index) => [rule.id, countRow?.[`r${index}`] ?? 0])),
    rows: rows.map((row) => ({
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      placedAt: row.placedAt ? row.placedAt.toISOString() : null,
      totalSar: row.totalSar === null ? null : Number(row.totalSar),
      company: row.company,
      flagged: row.flagged,
      aged: row.aged,
      promo: Number(row.promo) === 1,
      ruleId: ruleForTier(row.tier === null ? null : Number(row.tier)),
    })),
  };
}
