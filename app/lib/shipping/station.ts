import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { printCommercialInvoiceIfInternational } from '@/app/lib/international-printing';
import { getPromoProductIds } from '@/app/lib/promo-limit';
import { STATUS_IDS } from '@/SALLA_ORDER_STATUSES';
import { loadLocations } from '@/app/lib/order-prep/locations';
import { buildPrepOrder } from '@/app/lib/order-prep/payload';
import { getShippingCompanyName } from '@/app/lib/shipping-company';
import { canRetryAtStation, decidePrint, normalizeCode, STATE_LABELS, type ShippingState } from './rules';
import { printLabelUrl, resolveLabelPrinter } from './printing';
import { ensureShippingTask, MERCHANT_ID, methodForOrder } from './tasks';
import type { StationError, StationView } from './types';
import { processShippingTask } from './worker';

/**
 * The shipping station's server side: find an order from a scan, build its
 * card from the local database only (no Salla call), and the station actions.
 */

export type Shipper = { id: string | null; name: string; username: string | null; isSupervisor: boolean };

type Result<T> = { ok: true; value: T; message?: string } | { ok: false; status: number; error: StationError };

const fail = (status: number, code: string, message: string): Result<never> => ({ ok: false, status, error: { code, message } });

/** Order id for a scanned ticket, order number, reference or tracking number. */
export async function findOrderIdByCode(raw: string): Promise<string | null> {
  const code = normalizeCode(raw);
  if (!code) return null;
  const order = await prisma.sallaOrder.findFirst({
    where: { merchantId: MERCHANT_ID, OR: [{ referenceId: code }, { orderNumber: code }, { orderId: code }] },
    select: { orderId: true },
    orderBy: { placedAt: 'desc' },
  });
  if (order) return order.orderId;
  const [sallaShipment, localShipment, byTracking] = await Promise.all([
    prisma.sallaShipment.findFirst({ where: { merchantId: MERCHANT_ID, trackingNumber: code }, select: { orderId: true } }),
    prisma.localShipment.findUnique({ where: { trackingNumber: code }, select: { orderId: true } }),
    prisma.sallaOrder.findFirst({ where: { merchantId: MERCHANT_ID, trackingNumber: code }, select: { orderId: true } }),
  ]);
  return sallaShipment?.orderId ?? localShipment?.orderId ?? byTracking?.orderId ?? null;
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/**
 * The order's card. Packed orders (and orders that already have a shipment)
 * get their shipping task here if the background missed it. `kick` tells the
 * route to push a waiting courier shipment through now: the shipper is
 * looking at the order.
 */
export async function getStationView(orderId: string): Promise<{ view: StationView; kickTaskId: string | null } | null> {
  const key = { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } };
  const order = await prisma.sallaOrder.findUnique({
    where: key,
    select: {
      orderId: true,
      orderNumber: true,
      referenceId: true,
      placedAt: true,
      rawOrder: true,
      statusName: true,
      customerName: true,
      customerCity: true,
      items: { select: { sku: true, name: true, quantity: true, productId: true } },
    },
  });
  if (!order) return null;

  const [prepRow, sallaShipment, doNotShip, highPriority, gift, existingTask] = await Promise.all([
    prisma.orderPrepAssignment.findUnique({
      where: key,
      select: { status: true, userName: true, completedAt: true, orderData: true },
    }),
    prisma.sallaShipment.findUnique({
      where: key,
      select: { id: true, labelUrl: true, printCount: true, courierName: true, trackingNumber: true },
    }),
    prisma.orderDoNotShipFlag.findUnique({ where: key, select: { notes: true, createdByName: true } }),
    prisma.highPriorityOrder.findUnique({ where: key, select: { reason: true, notes: true } }),
    prisma.orderGiftFlag.findUnique({ where: key, select: { reason: true, notes: true } }),
    prisma.shippingTask.findUnique({ where: key }),
  ]);
  const orderNumber = order.referenceId || order.orderNumber || order.orderId;
  const localShipment = await prisma.localShipment.findFirst({
    where: { merchantId: MERCHANT_ID, OR: [{ orderId }, { orderNumber }] },
    select: { id: true, trackingNumber: true, assignment: { select: { deliveryAgent: { select: { name: true, username: true } } } } },
  });

  const packed = prepRow?.status === 'completed';
  let task = existingTask;
  if (!task && (packed || sallaShipment?.labelUrl || localShipment)) {
    task = await ensureShippingTask(orderId, packed ? 'prep' : 'manual').catch((error) => {
      log.warn('Shipping station could not create task', { orderId, error: error instanceof Error ? error.message : error });
      return null;
    });
  }

  const rawItems = Array.isArray((order.rawOrder as any)?.items) ? ((order.rawOrder as any).items as any[]) : [];
  const locations = await loadLocations(
    [...rawItems.map((item) => item?.sku ?? item?.product?.sku), ...order.items.map((item) => item.sku)],
    [...rawItems.map((item) => (item?.product?.id ? String(item.product.id) : null)), ...order.items.map((item) => item.productId)],
  );
  const promoIds = await getPromoProductIds(MERCHANT_ID).catch(() => [] as string[]);
  const card = buildPrepOrder({
    orderId,
    orderNumber,
    placedAt: order.placedAt,
    rawOrder: order.rawOrder,
    storedItems: order.items,
    locations,
    giftFlagged: Boolean(gift),
    highPriority: Boolean(highPriority),
    promoProductIds: new Set(promoIds),
  });

  const statuses = ((prepRow?.orderData as any)?.prepItemStatuses ?? []) as Array<{ index?: number; status?: string }>;
  const shortIndexes = Array.isArray(statuses)
    ? statuses.filter((entry) => entry?.status === 'unavailable' && typeof entry.index === 'number').map((entry) => entry.index as number)
    : [];

  const state = (task?.state ?? null) as ShippingState | null;
  const agent = localShipment?.assignment?.deliveryAgent;
  const view: StationView = {
    orderId,
    orderNumber,
    customerName: order.customerName,
    city: order.customerCity || card.city,
    sallaStatus: order.statusName,
    method: (task?.method as StationView['method']) ?? methodForOrder(order.rawOrder),
    state,
    stateLabel: state ? STATE_LABELS[state] : packed ? 'جاري تجهيز مهمة الشحن' : 'لم يُجهَّز عبر صفحة التجهيز',
    task: task
      ? {
          id: task.id,
          attempts: task.attempts,
          lastError: task.lastError,
          blockReason: task.blockReason,
          printCount: task.printCount,
          printedAt: iso(task.printedAt),
          printedByName: task.printedByName,
          labelReadyAt: iso(task.labelReadyAt),
          creatingAt: iso(task.creatingAt),
          canRetry: task.method === 'salla' && canRetryAtStation({ state: task.state, creatingAt: task.creatingAt }),
        }
      : null,
    order: { ...card, shippingCompany: card.shippingCompany ?? getShippingCompanyName(order.rawOrder) },
    prep: { packed, packedBy: packed ? prepRow?.userName ?? null : null, packedAt: iso(prepRow?.completedAt), shortIndexes },
    flags: {
      doNotShip: doNotShip ? { notes: doNotShip.notes, by: doNotShip.createdByName } : null,
      highPriority: highPriority ? { reason: highPriority.reason, notes: highPriority.notes } : null,
      gift: gift ? { reason: gift.reason, notes: gift.notes } : null,
    },
    shipment: sallaShipment
      ? {
          courier: sallaShipment.courierName,
          trackingNumber: sallaShipment.trackingNumber || null,
          hasLabel: Boolean(sallaShipment.labelUrl),
          printCount: sallaShipment.printCount,
        }
      : null,
    local: localShipment
      ? { trackingNumber: localShipment.trackingNumber, agentName: agent ? agent.name || agent.username : null }
      : null,
  };

  const kickTaskId =
    task &&
    task.method === 'salla' &&
    task.state === 'queued' &&
    (task.attempts === 0 || task.nextAttemptAt.getTime() <= Date.now()) &&
    (!task.lockedUntil || task.lockedUntil.getTime() < Date.now())
      ? task.id
      : null;
  return { view, kickTaskId };
}

/**
 * Print the order's label. Server-side checks first (do-not-ship, state,
 * reprint rule); the same request repeated (a retried tap, same printKey) is
 * answered without printing twice, and a second shipper can't print while a
 * print for the order is in flight.
 */
export async function printForStation(orderId: string, user: Shipper, printKey: string): Promise<Result<null>> {
  const key = { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } };
  const task = await ensureShippingTask(orderId, 'manual');
  if (!task) return fail(404, 'not_found', 'لم يتم العثور على الطلب');
  if (task.lastPrintKey === printKey && task.printCount > 0) return { ok: true, value: null, message: 'تم إرسال البوليصة مسبقاً' };

  const [shipment, doNotShip] = await Promise.all([
    prisma.sallaShipment.findUnique({ where: key }),
    prisma.orderDoNotShipFlag.findUnique({ where: key, select: { id: true } }),
  ]);
  const labelUrl =
    shipment?.labelUrl ||
    (shipment?.shipmentData as any)?.label_url ||
    (shipment?.shipmentData as any)?.label?.url ||
    null;
  const printCount = Math.max(task.printCount, shipment?.printCount ?? 0);
  const decision = decidePrint({
    state: task.state as ShippingState,
    hasLabel: Boolean(labelUrl),
    printCount,
    doNotShip: Boolean(doNotShip),
    isSupervisor: user.isSupervisor,
  });
  if (!decision.ok) return fail(409, decision.code, decision.message);

  const now = new Date();
  const claimed = await prisma.shippingTask.updateMany({
    where: { id: task.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + 20_000) },
  });
  if (claimed.count === 0) return fail(409, 'busy', 'جاري إرسال بوليصة هذا الطلب للطابعة');

  try {
    const printer = await resolveLabelPrinter({ id: user.id, username: user.username });
    const result = await printLabelUrl({ labelUrl: labelUrl!, orderNumber: task.orderNumber || orderId, printer });
    if (!result.success) {
      await prisma.shippingTask.update({
        where: { id: task.id },
        data: { lockedUntil: null, lastError: `الطابعة: ${result.error ?? 'فشل الإرسال'}`.slice(0, 500) },
      });
      return fail(502, 'print_failed', 'تعذر إرسال البوليصة للطابعة — حاول مرة أخرى');
    }
    const printedAt = new Date();
    await prisma.$transaction([
      prisma.shippingTask.update({
        where: { id: task.id },
        data: {
          state: 'printed',
          printedAt,
          printedById: user.id,
          printedByName: user.name,
          printCount: { increment: 1 },
          lastPrintKey: printKey,
          lockedUntil: null,
          lastError: null,
          sallaShipmentId: shipment?.id ?? task.sallaShipmentId,
        },
      }),
      ...(shipment
        ? [
            prisma.sallaShipment.update({
              where: { id: shipment.id },
              data: {
                labelPrinted: true,
                labelPrintedAt: printedAt,
                labelPrintedBy: user.id || 'system',
                labelPrintedByName: user.name,
                printJobId: result.jobId ? String(result.jobId) : shipment.printJobId,
                printCount: { increment: 1 },
              },
            }),
          ]
        : []),
    ]);
    if (task.method === 'international') {
      await printCommercialInvoiceIfInternational({
        orderId,
        orderNumber: task.orderNumber || orderId,
        merchantId: MERCHANT_ID,
        assignmentId: null,
        triggeredBy: user.username || user.id || 'shipping-v2',
        source: 'shipping-v2',
      }).catch((error) =>
        log.warn('Commercial invoice print failed', { orderId, error: error instanceof Error ? error.message : error }),
      );
    }
    return { ok: true, value: null, message: decision.reprint ? 'أُعيدت طباعة البوليصة' : 'أُرسلت البوليصة للطابعة' };
  } catch (error) {
    await prisma.shippingTask.update({ where: { id: task.id }, data: { lockedUntil: null } }).catch(() => undefined);
    throw error;
  }
}

/**
 * "Create the shipment now" — for an order that didn't come through prep, a
 * failed create, or a label that's late. It runs the normal worker step,
 * which first looks at the order's shipments in Salla: a waybill that exists
 * is taken, never made twice. Capped so the station isn't left waiting.
 */
export async function createNowForStation(orderId: string): Promise<Result<null>> {
  const task = await ensureShippingTask(orderId, 'manual');
  if (!task) return fail(404, 'not_found', 'لم يتم العثور على الطلب');
  if (task.method !== 'salla') return fail(409, 'wrong_method', 'هذا الطلب لا يُشحن عبر شركات سلة');
  const late = canRetryAtStation({ state: task.state, creatingAt: task.creatingAt });
  if (task.state !== 'queued' && !late) {
    return { ok: true, value: null, message: STATE_LABELS[task.state as ShippingState] };
  }
  const now = new Date();
  const moved = await prisma.shippingTask.updateMany({
    where: {
      id: task.id,
      state: task.state,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: {
      state: 'queued',
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      source: task.source === 'prep' ? 'prep' : 'manual',
    },
  });
  if (moved.count === 0) return fail(409, 'busy', 'جاري التحقق من الشحنة — حاول بعد لحظات');
  const outcome = await Promise.race([
    processShippingTask(task.id, { force: true }),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000)),
  ]);
  const messages: Record<string, string> = {
    created: 'أُعيد طلب الشحنة من سلة — تُطبع فور وصولها',
    adopted: 'وُجدت البوليصة في سلة',
    blocked: 'تعذر الطلب — راجع السبب',
    retry: 'تعذر الاتصال بسلة — ستُعاد المحاولة تلقائياً',
  };
  return { ok: true, value: null, message: messages[outcome] };
}

/**
 * Local delivery: the agent is picked at the station. Uses the existing local
 * shipment flow (label, agent assignment, Salla status), guarded by the task
 * so two taps can't create two shipments.
 */
export async function shipLocalForStation(orderId: string, deliveryAgentId: string, user: Shipper): Promise<Result<null>> {
  const task = await ensureShippingTask(orderId, 'manual');
  if (!task) return fail(404, 'not_found', 'لم يتم العثور على الطلب');
  if (task.state === 'printed' && task.localShipmentId) return { ok: true, value: null, message: 'الشحنة المحلية موجودة مسبقاً' };
  const doNotShip = await prisma.orderDoNotShipFlag.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
    select: { id: true },
  });
  if (doNotShip) return fail(409, 'do_not_ship', 'هذا الطلب موقوف عن الشحن');

  const now = new Date();
  const locked = await prisma.shippingTask.updateMany({
    where: {
      id: task.id,
      state: { in: ['needs_agent', 'queued', 'failed', 'label_ready'] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil: new Date(now.getTime() + 60_000), method: 'local' },
  });
  if (locked.count === 0) return fail(409, 'busy', 'لا يمكن إنشاء شحنة محلية لهذا الطلب الآن');

  try {
    const { POST: createLocalShipment } = await import('@/app/api/local-shipping/create/route');
    const response = await createLocalShipment(
      new NextRequest('http://internal/api/local-shipping/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_ID,
          orderNumber: task.orderNumber,
          generatedBy: user.username || user.name,
          deliveryAgentId,
        }),
      }),
    );
    const data = (await response.json().catch(() => null)) as Record<string, any> | null;
    if (!response.ok || !data?.success) {
      const message = data?.error || 'تعذر إنشاء الشحنة المحلية';
      await prisma.shippingTask.update({
        where: { id: task.id },
        data: { lockedUntil: null, state: 'needs_agent', lastError: String(message).slice(0, 500) },
      });
      return fail(response.status >= 400 ? response.status : 502, 'local_failed', String(message));
    }
    await prisma.shippingTask.update({
      where: { id: task.id },
      data: {
        state: 'printed',
        method: 'local',
        localShipmentId: data.shipment?.id ?? null,
        printedAt: new Date(),
        printedById: user.id,
        printedByName: user.name,
        printCount: { increment: 1 },
        lockedUntil: null,
        lastError: data.autoPrint && !data.autoPrint.success ? `الطابعة: ${data.autoPrint.error ?? 'فشل'}` : null,
      },
    });
    return { ok: true, value: null, message: data.autoPrint?.success === false ? 'أُنشئت الشحنة لكن تعذرت الطباعة' : 'أُنشئت الشحنة المحلية وطُبعت' };
  } catch (error) {
    await prisma.shippingTask.update({ where: { id: task.id }, data: { lockedUntil: null } }).catch(() => undefined);
    throw error;
  }
}

export const SHIPPING_PROBLEM_REASONS: Record<string, string> = {
  wrong_item: 'قطعة خاطئة أو مقاس خاطئ',
  missing_item: 'قطعة ناقصة',
  damaged: 'قطعة تالفة',
  address: 'مشكلة في العنوان',
  other: 'أخرى',
};

/**
 * The shipper stops the order. The task is held for a supervisor; if no
 * waybill exists yet the order also goes to X4 in Salla (through the prep
 * outbox), so customer service sees it. Returns the outbox job to run.
 */
export async function reportShippingProblem(
  orderId: string,
  input: { reason: string; note: string | null },
  user: Shipper,
): Promise<Result<{ syncJobId: string | null }>> {
  const task = await ensureShippingTask(orderId, 'manual');
  if (!task) return fail(404, 'not_found', 'لم يتم العثور على الطلب');
  const reasonLabel = SHIPPING_PROBLEM_REASONS[input.reason] ?? SHIPPING_PROBLEM_REASONS.other;
  const text = [reasonLabel, input.note].filter(Boolean).join(' — ');
  await prisma.shippingTask.update({
    where: { id: task.id },
    data: { state: 'blocked', blockReason: `${text} (${user.name})`.slice(0, 300), lockedUntil: null },
  });

  const shipment = await prisma.sallaShipment.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
    select: { id: true },
  });
  if (shipment || task.localShipmentId) {
    return { ok: true, value: { syncJobId: null }, message: 'أُوقف الطلب — البوليصة موجودة في سلة، المشرف سيلغيها' };
  }
  const job = await prisma.orderPrepSallaSync.create({
    data: {
      merchantId: MERCHANT_ID,
      orderId,
      orderNumber: task.orderNumber,
      kind: 'exception',
      targetStatusId: STATUS_IDS.UNDER_REVIEW_X4,
      note: `مشكلة عند الشحن: ${text}`,
      createdById: user.id,
      createdByName: user.name,
    },
  });
  return { ok: true, value: { syncJobId: job.id }, message: 'أُوقف الطلب وحُوّل للمراجعة' };
}
