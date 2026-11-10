import type { Prisma, ShippingTask } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { detectInternationalOrder } from '@/app/lib/order-destination';
import { getShippingCompanyName } from '@/app/lib/shipping-company';
import { initialState, LABEL_PENDING_STATES, routeMethod, type ShippingMethod } from './rules';

/**
 * Creating and moving ShippingTask rows. A task is one order's way from
 * packed to label printed; the row's unique (merchantId, orderId) key is what
 * stops two shipments being made for one order.
 */

export const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

type Db = Prisma.TransactionClient | typeof prisma;

export function methodForOrder(rawOrder: unknown): ShippingMethod {
  return routeMethod({
    isInternational: detectInternationalOrder(rawOrder).isInternational,
    shippingCompany: getShippingCompanyName(rawOrder),
  });
}

/**
 * The order's task, created if missing. A shipment that already exists (made
 * on the old page, by hand in Salla, or a local one) is adopted so it's never
 * created twice.
 */
export async function ensureShippingTask(
  orderId: string,
  source: 'prep' | 'manual',
  db: Db = prisma,
): Promise<ShippingTask | null> {
  const existing = await db.shippingTask.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
  });
  if (existing) return existing;

  const order = await db.sallaOrder.findUnique({
    where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
    select: { orderId: true, orderNumber: true, referenceId: true, rawOrder: true },
  });
  if (!order) return null;
  const orderNumber = order.referenceId || order.orderNumber || order.orderId;
  const method = methodForOrder(order.rawOrder);

  const [sallaShipment, localShipment] = await Promise.all([
    db.sallaShipment.findUnique({
      where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
      select: { id: true, labelUrl: true, printCount: true, labelPrinted: true, labelPrintedAt: true, labelPrintedByName: true },
    }),
    db.localShipment.findFirst({
      where: { merchantId: MERCHANT_ID, OR: [{ orderId }, { orderNumber }] },
      select: { id: true, createdAt: true },
    }),
  ]);

  let data: Prisma.ShippingTaskUncheckedCreateInput = {
    merchantId: MERCHANT_ID,
    orderId,
    orderNumber,
    method,
    source,
    state: initialState(method),
  };
  if (localShipment) {
    data = { ...data, method: 'local', state: 'printed', localShipmentId: localShipment.id, printedAt: localShipment.createdAt, printCount: 1 };
  } else if (sallaShipment?.labelUrl) {
    const printed = sallaShipment.labelPrinted || sallaShipment.printCount > 0;
    data = {
      ...data,
      state: printed ? 'printed' : 'label_ready',
      sallaShipmentId: sallaShipment.id,
      labelReadyAt: new Date(),
      printCount: sallaShipment.printCount,
      printedAt: printed ? sallaShipment.labelPrintedAt ?? new Date() : null,
      printedByName: printed ? sallaShipment.labelPrintedByName : null,
    };
  }

  try {
    return await db.shippingTask.create({ data });
  } catch (error) {
    // Created by a parallel request: use that one.
    if ((error as { code?: string })?.code === 'P2002') {
      return db.shippingTask.findUnique({ where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } } });
    }
    throw error;
  }
}

/**
 * Called when Salla's webhook (or the reconcile pass) stores a shipment with
 * a label: the order's task becomes ready to print. No-op for orders without
 * a task or whose label was already handled.
 */
export async function markLabelArrived(
  merchantId: string,
  orderId: string,
  shipment: { id: string; printed: boolean },
): Promise<void> {
  try {
    const now = new Date();
    await prisma.shippingTask.updateMany({
      where: { merchantId, orderId, state: { in: LABEL_PENDING_STATES } },
      data: shipment.printed
        ? { state: 'printed', sallaShipmentId: shipment.id, labelReadyAt: now, printedAt: now, lockedUntil: null, lastError: null }
        : { state: 'label_ready', sallaShipmentId: shipment.id, labelReadyAt: now, lockedUntil: null, lastError: null },
    });
  } catch (error) {
    log.warn('Failed to mark shipping task label ready', {
      orderId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

/**
 * Packed orders (prep completed) from the last two days that have no task yet
 * — the safety net if the after-pack hook didn't run.
 */
export async function findPackedOrdersWithoutTask(limit = 50): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ orderId: string }>>`
    SELECT a."orderId"
    FROM "OrderPrepAssignment" a
    WHERE a."merchantId" = ${MERCHANT_ID}
      AND a.status = 'completed'
      AND a."completedAt" > now() - interval '2 days'
      AND NOT EXISTS (
        SELECT 1 FROM "ShippingTask" t WHERE t."merchantId" = a."merchantId" AND t."orderId" = a."orderId"
      )
    ORDER BY a."completedAt" ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => row.orderId);
}
