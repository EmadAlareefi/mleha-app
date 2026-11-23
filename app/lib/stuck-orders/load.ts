import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { MERCHANT_ID } from '@/app/lib/shipping/tasks';
import { findOrderIdByCode } from '@/app/lib/shipping/station';
import { buildJourney, classifyOrder, classifyReturn, reachedStages, type ClassifyOptions } from './classify';
import type {
  CategorySummary,
  OrderJourney,
  OrderSnapshot,
  ReturnSnapshot,
  StuckCategory,
  StuckItem,
  StuckOrdersResult,
} from './types';

/** Orders placed further back than this are not scanned for the list (search still finds them). */
const LOOKBACK_DAYS = 60;
const DAY_MS = 86_400_000;
const SEARCH_LIMIT = 20;

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/** Everything the classifier needs, for a batch of orders, in a fixed number of queries. */
export async function loadSnapshots(orderIds: string[]): Promise<OrderSnapshot[]> {
  if (orderIds.length === 0) return [];
  const where = { merchantId: MERCHANT_ID, orderId: { in: orderIds } };
  const [orders, preps, escalations, syncJobs, tasks, sallaShipments, localShipments, events, flags, holds] = await Promise.all([
    prisma.sallaOrder.findMany({
      where,
      select: {
        orderId: true,
        orderNumber: true,
        referenceId: true,
        customerName: true,
        customerMobile: true,
        customerCity: true,
        statusSlug: true,
        statusCustomId: true,
        statusName: true,
        placedAt: true,
        updatedAtRemote: true,
        trackingNumber: true,
      },
    }),
    prisma.orderPrepAssignment.findMany({
      where,
      select: { orderId: true, status: true, userName: true, assignedAt: true, startedAt: true, completedAt: true, verifyIssue: true },
    }),
    prisma.orderPrepEscalation.findMany({ where, orderBy: { createdAt: 'asc' } }),
    prisma.orderPrepSallaSync.findMany({ where, orderBy: { createdAt: 'asc' } }),
    prisma.shippingTask.findMany({ where }),
    prisma.sallaShipment.findMany({ where }),
    prisma.localShipment.findMany({
      where,
      select: {
        orderId: true,
        trackingNumber: true,
        status: true,
        createdAt: true,
        deliveredAt: true,
        cancelledAt: true,
        assignment: { select: { assignedAt: true, pickedUpAt: true } },
      },
    }),
    prisma.webhookEvent.findMany({
      where: { orderId: { in: orderIds }, status: { not: null } },
      select: { orderId: true, status: true, receivedAt: true },
      orderBy: { receivedAt: 'asc' },
    }),
    prisma.orderDoNotShipFlag.findMany({ where }),
    prisma.customerOrderChange.findMany({
      where: { ...where, holdActive: true },
      select: { orderId: true, kind: true, state: true, createdAt: true },
    }),
  ]);

  const one = <T extends { orderId: string }>(rows: T[]) => new Map(rows.map((row) => [row.orderId, row]));
  const many = <T extends { orderId: string | null }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.orderId) continue;
      const list = map.get(row.orderId) ?? [];
      list.push(row);
      map.set(row.orderId, list);
    }
    return map;
  };
  const prepBy = one(preps);
  const taskBy = one(tasks);
  const sallaShipmentBy = one(sallaShipments);
  const localBy = one(localShipments);
  const flagBy = one(flags);
  const holdBy = one(holds);
  const escalationsBy = many(escalations);
  const syncBy = many(syncJobs);
  const eventsBy = many(events);

  // Warehouse exit scans are keyed by tracking number only.
  const trackingFor = (orderId: string, fallback: string | null) =>
    sallaShipmentBy.get(orderId)?.trackingNumber || localBy.get(orderId)?.trackingNumber || fallback || null;
  const trackings = orders.map((o) => trackingFor(o.orderId, o.trackingNumber)).filter((t): t is string => Boolean(t));
  const scans = trackings.length
    ? await prisma.shipment.findMany({
        where: { trackingNumber: { in: trackings }, type: 'outgoing' },
        select: { trackingNumber: true, scannedAt: true, scannedBy: true, handoverScannedAt: true, handoverScannedBy: true },
      })
    : [];
  const scanBy = new Map(scans.map((scan) => [scan.trackingNumber, scan]));

  return orders.map((o): OrderSnapshot => {
    const prep = prepBy.get(o.orderId);
    const task = taskBy.get(o.orderId);
    const sallaShipment = sallaShipmentBy.get(o.orderId);
    const local = localBy.get(o.orderId);
    const tracking = trackingFor(o.orderId, o.trackingNumber);
    const scan = tracking ? scanBy.get(tracking) : undefined;
    const flag = flagBy.get(o.orderId);
    const hold = holdBy.get(o.orderId);
    return {
      orderId: o.orderId,
      orderNumber: o.orderNumber,
      referenceId: o.referenceId,
      customerName: o.customerName,
      customerMobile: o.customerMobile,
      customerCity: o.customerCity,
      statusSlug: o.statusSlug,
      statusCustomId: o.statusCustomId,
      statusName: o.statusName,
      placedAt: iso(o.placedAt),
      updatedAtRemote: iso(o.updatedAtRemote),
      trackingNumber: tracking,
      prep: prep
        ? {
            status: prep.status,
            userName: prep.userName,
            assignedAt: prep.assignedAt.toISOString(),
            startedAt: iso(prep.startedAt),
            completedAt: iso(prep.completedAt),
            verifyIssue: prep.verifyIssue,
          }
        : null,
      escalations: (escalationsBy.get(o.orderId) ?? []).map((e) => ({
        id: e.id,
        reason: e.reason,
        statusTarget: e.statusTarget,
        notes: e.notes,
        createdAt: e.createdAt.toISOString(),
        createdByName: e.createdByName,
        resolvedAt: iso(e.resolvedAt),
        resolvedByName: e.resolvedByName,
      })),
      syncJobs: (syncBy.get(o.orderId) ?? []).map((j) => ({
        id: j.id,
        kind: j.kind,
        state: j.state,
        targetStatusId: j.targetStatusId,
        lastError: j.lastError,
        liveStatus: j.liveStatus,
        note: j.note,
        createdAt: j.createdAt.toISOString(),
        syncedAt: iso(j.syncedAt),
        createdByName: j.createdByName,
      })),
      task: task
        ? {
            id: task.id,
            method: task.method,
            state: task.state,
            lastError: task.lastError,
            blockReason: task.blockReason,
            attempts: task.attempts,
            createdAt: task.createdAt.toISOString(),
            creatingAt: iso(task.creatingAt),
            labelReadyAt: iso(task.labelReadyAt),
            printedAt: iso(task.printedAt),
            printedByName: task.printedByName,
            updatedAt: task.updatedAt.toISOString(),
          }
        : null,
      sallaShipment: sallaShipment
        ? {
            trackingNumber: sallaShipment.trackingNumber,
            courierName: sallaShipment.courierName,
            status: sallaShipment.status,
            createdAt: sallaShipment.createdAt.toISOString(),
            labelPrintedAt: iso(sallaShipment.labelPrintedAt),
            labelPrintedByName: sallaShipment.labelPrintedByName,
          }
        : null,
      localShipment: local
        ? {
            trackingNumber: local.trackingNumber,
            status: local.status,
            createdAt: local.createdAt.toISOString(),
            deliveredAt: iso(local.deliveredAt),
            cancelledAt: iso(local.cancelledAt),
            pickedUpAt: iso(local.assignment?.pickedUpAt),
            agentAssignedAt: iso(local.assignment?.assignedAt),
          }
        : null,
      scan: scan
        ? {
            scannedAt: scan.scannedAt.toISOString(),
            scannedBy: scan.scannedBy,
            handoverScannedAt: iso(scan.handoverScannedAt),
            handoverScannedBy: scan.handoverScannedBy,
          }
        : null,
      statusEvents: (eventsBy.get(o.orderId) ?? []).map((e) => ({ status: e.status as string, receivedAt: e.receivedAt.toISOString() })),
      doNotShip: flag ? { notes: flag.notes, createdAt: flag.createdAt.toISOString(), createdByName: flag.createdByName } : null,
      customerHold: hold ? { kind: hold.kind, state: hold.state, createdAt: hold.createdAt.toISOString() } : null,
    };
  });
}

const returnSelect = {
  id: true,
  orderId: true,
  orderNumber: true,
  customerName: true,
  customerPhone: true,
  status: true,
  processingStatus: true,
  refundStatus: true,
  smsaTrackingNumber: true,
  createdAt: true,
  receivedAt: true,
  processedAt: true,
  updatedAt: true,
} satisfies Prisma.ReturnRequestSelect;

type ReturnRow = Prisma.ReturnRequestGetPayload<{ select: typeof returnSelect }>;

const toReturnSnapshot = (r: ReturnRow): ReturnSnapshot => ({
  id: r.id,
  orderId: r.orderId,
  orderNumber: r.orderNumber,
  customerName: r.customerName,
  customerPhone: r.customerPhone,
  status: r.status,
  processingStatus: r.processingStatus,
  refundStatus: r.refundStatus,
  smsaTrackingNumber: r.smsaTrackingNumber,
  createdAt: r.createdAt.toISOString(),
  receivedAt: iso(r.receivedAt),
  processedAt: iso(r.processedAt),
  updatedAt: r.updatedAt.toISOString(),
});

export function orderItem(s: OrderSnapshot, opts: ClassifyOptions): StuckItem {
  return {
    key: `order:${s.orderId}`,
    kind: 'order',
    orderId: s.orderId,
    orderNumber: s.orderNumber,
    customerName: s.customerName,
    customerCity: s.customerCity,
    statusName: s.statusName,
    trackingNumber: s.trackingNumber,
    reached: reachedStages(s),
    diagnosis: classifyOrder(s, opts),
  };
}

const RETURN_STAGES = ['requested', 'received', 'processing', 'done'] as const;

export function returnItem(r: ReturnSnapshot, opts: ClassifyOptions): StuckItem {
  const diagnosis = classifyReturn(r, opts);
  const reachedIndex = RETURN_STAGES.indexOf(diagnosis.stage as (typeof RETURN_STAGES)[number]);
  return {
    key: `return:${r.id}`,
    kind: 'return',
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    customerName: r.customerName,
    customerCity: null,
    statusName: null,
    trackingNumber: r.smsaTrackingNumber,
    // The stage the return is waiting on is not reached yet; "done" is.
    reached: RETURN_STAGES.slice(0, diagnosis.stage === 'done' ? RETURN_STAGES.length : Math.max(1, reachedIndex)),
    diagnosis,
    returnId: r.id,
  };
}

const sortByAge = (items: StuckItem[]) =>
  items.sort((a, b) => (b.diagnosis.ageMs ?? -1) - (a.diagnosis.ageMs ?? -1));

/** The list: every order and return that stopped moving for longer than the threshold. */
export async function loadStuckOrders({ thresholdHours, nowMs = Date.now() }: { thresholdHours: number; nowMs?: number }): Promise<StuckOrdersResult> {
  const opts: ClassifyOptions = { nowMs, thresholdMs: thresholdHours * 3_600_000 };
  const since = new Date(nowMs - LOOKBACK_DAYS * DAY_MS);

  const [openOrders, cancelledWithTask, returns] = await Promise.all([
    prisma.sallaOrder.findMany({
      where: { merchantId: MERCHANT_ID, placedAt: { gte: since }, statusSlug: { in: ['under_review', 'in_progress', 'completed'] } },
      select: { orderId: true },
    }),
    prisma.$queryRaw<Array<{ orderId: string }>>`
      SELECT o."orderId"
      FROM "SallaOrder" o
      JOIN "ShippingTask" t ON t."merchantId" = o."merchantId" AND t."orderId" = o."orderId"
      WHERE o."merchantId" = ${MERCHANT_ID}
        AND o."statusSlug" = 'canceled'
        AND t."state" <> 'cancelled'
        AND o."placedAt" >= ${since}`,
    prisma.returnRequest.findMany({
      where: {
        merchantId: MERCHANT_ID,
        createdAt: { gte: since },
        OR: [
          { receivedAt: { not: null }, status: { notIn: ['completed', 'rejected', 'cancelled'] } },
          { status: 'delivered' },
          { processingStatus: 'needs_attention' },
        ],
      },
      select: returnSelect,
    }),
  ]);

  const ids = [...new Set([...openOrders.map((o) => o.orderId), ...cancelledWithTask.map((o) => o.orderId)])];
  const snapshots = await loadSnapshots(ids);

  const items: StuckItem[] = [];
  for (const snapshot of snapshots) {
    const item = orderItem(snapshot, opts);
    if (item.diagnosis.stuck) items.push(item);
  }
  for (const row of returns) {
    const item = returnItem(toReturnSnapshot(row), opts);
    if (item.diagnosis.stuck) items.push(item);
  }

  const counts: Partial<Record<StuckCategory, CategorySummary>> = {};
  let heldCount = 0;
  for (const item of items) {
    if (item.diagnosis.held) {
      heldCount += 1;
      continue;
    }
    const category = item.diagnosis.category as StuckCategory;
    const summary = (counts[category] ??= { count: 0, critical: 0, oldestAgeMs: null });
    summary.count += 1;
    if (item.diagnosis.severity === 'critical') summary.critical += 1;
    summary.oldestAgeMs = Math.max(summary.oldestAgeMs ?? 0, item.diagnosis.ageMs ?? 0);
  }

  return { generatedAt: new Date(nowMs).toISOString(), thresholdHours, counts, heldCount, items: sortByAge(items) };
}

/** Order ids matching a search: an exact code first, then phone or customer name. */
export async function searchOrderIds(rawQuery: string): Promise<string[]> {
  const query = rawQuery.trim().slice(0, 80);
  if (!query) return [];
  const byCode = await findOrderIdByCode(query);
  if (byCode) return [byCode];

  const digits = query.replace(/\D/g, '');
  const returnByTracking = digits.length >= 6
    ? await prisma.returnRequest.findFirst({ where: { merchantId: MERCHANT_ID, smsaTrackingNumber: query }, select: { orderId: true } })
    : null;
  if (returnByTracking) return [returnByTracking.orderId];

  const or: Array<Record<string, unknown>> = [];
  if (digits.length >= 7) or.push({ customerMobile: { contains: digits.slice(-9) } });
  if (digits.length >= 3 && digits.length < 7) or.push({ orderNumber: { startsWith: digits } });
  if (/[^\d\s+]/.test(query) && query.length >= 2) or.push({ customerName: { contains: query, mode: 'insensitive' } });
  if (or.length === 0) return [];
  const rows = await prisma.sallaOrder.findMany({
    where: { merchantId: MERCHANT_ID, OR: or },
    select: { orderId: true },
    orderBy: { placedAt: 'desc' },
    take: SEARCH_LIMIT,
  });
  return rows.map((r) => r.orderId);
}

async function returnsFor(orderIds: string[], opts: ClassifyOptions): Promise<StuckItem[]> {
  if (orderIds.length === 0) return [];
  const rows = await prisma.returnRequest.findMany({
    where: { merchantId: MERCHANT_ID, orderId: { in: orderIds } },
    select: returnSelect,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => returnItem(toReturnSnapshot(row), opts));
}

/** Search results: every matching order with its diagnosis, stuck or not. */
export async function searchStuckOrders(query: string, thresholdHours: number, nowMs = Date.now()): Promise<StuckItem[]> {
  const opts: ClassifyOptions = { nowMs, thresholdMs: thresholdHours * 3_600_000 };
  const ids = await searchOrderIds(query);
  const snapshots = await loadSnapshots(ids);
  const order = new Map(ids.map((id, index) => [id, index]));
  const orders = snapshots
    .map((s) => orderItem(s, opts))
    .sort((a, b) => (order.get(a.orderId) ?? 0) - (order.get(b.orderId) ?? 0));
  const returns = (await returnsFor(ids, opts)).filter((r) => r.diagnosis.stuck);
  return [...returns, ...orders];
}

/** The detail sheet: diagnosis plus the full event timeline. */
export async function loadOrderJourney(orderId: string, thresholdHours: number, nowMs = Date.now()): Promise<OrderJourney | null> {
  const opts: ClassifyOptions = { nowMs, thresholdMs: thresholdHours * 3_600_000 };
  const [snapshot] = await loadSnapshots([orderId]);
  if (!snapshot) return null;
  return { item: orderItem(snapshot, opts), events: buildJourney(snapshot), returns: await returnsFor([orderId], opts) };
}
