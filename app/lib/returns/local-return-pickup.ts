import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

/**
 * Returns filed on orders that our own Jeddah delivery agents delivered are
 * collected by the same agent. Each one becomes a `return_pickup` task on that
 * agent, linked to the original LocalShipment so /my-deliveries can show the
 * customer's address, map pin and phone.
 */

export const RETURN_PICKUP_REQUEST_TYPE = 'return_pickup';

export const OPEN_RETURN_STATUSES = ['pending_review', 'approved'];
const OPEN_TASK_STATUSES = ['pending', 'in_progress'];

const JEDDAH_PATTERN = /جد[ةه]|jedd?ah|jiddah/i;

export const isJeddahCity = (...values: Array<string | null | undefined>) =>
  values.some((value) => typeof value === 'string' && JEDDAH_PATTERN.test(value));

/** The Jeddah local shipment for this order that an agent actually delivered, if any. */
export async function findDeliveredJeddahShipment(merchantId: string, orderId: string) {
  const shipments = await prisma.localShipment.findMany({
    where: {
      merchantId,
      orderId,
      assignment: { status: 'delivered' },
    },
    select: {
      id: true,
      shippingCity: true,
      orderItems: true,
      assignment: { select: { deliveryAgentId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    shipments.find((shipment) => {
      const meta = (shipment.orderItems as any)?.meta;
      return isJeddahCity(shipment.shippingCity, meta?.shipToCity);
    }) ?? null
  );
}

/**
 * Makes the agent's pickup task match the return request: opens one while the
 * return is awaiting collection, and cancels a still-open one once the return
 * is cancelled or has already reached the warehouse. Never throws.
 */
export async function syncLocalReturnPickupTask(returnRequestId: string): Promise<void> {
  try {
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { items: { select: { productName: true, variantName: true, quantity: true } } },
    });
    if (!returnRequest) return;

    const shipment = await findDeliveredJeddahShipment(returnRequest.merchantId, returnRequest.orderId);
    const agentId = shipment?.assignment?.deliveryAgentId;
    if (!shipment || !agentId) return;

    const openTasks = await prisma.deliveryAgentTask.findMany({
      where: {
        relatedShipmentId: shipment.id,
        requestType: RETURN_PICKUP_REQUEST_TYPE,
        status: { in: OPEN_TASK_STATUSES },
      },
      select: { id: true },
    });

    if (!OPEN_RETURN_STATUSES.includes(returnRequest.status)) {
      // Another open return on the same order still needs the pickup.
      const otherOpenReturn = await prisma.returnRequest.count({
        where: {
          merchantId: returnRequest.merchantId,
          orderId: returnRequest.orderId,
          id: { not: returnRequest.id },
          status: { in: OPEN_RETURN_STATUSES },
        },
      });
      if (openTasks.length > 0 && otherOpenReturn === 0) {
        await prisma.deliveryAgentTask.updateMany({
          where: { id: { in: openTasks.map((task) => task.id) } },
          data: {
            status: 'cancelled',
            completionNotes:
              returnRequest.status === 'cancelled' ? 'أُلغي طلب الإرجاع' : 'وصل المرتجع للمستودع',
          },
        });
      }
      return;
    }

    if (openTasks.length > 0) return;

    const isExchange = returnRequest.type === 'exchange';
    const itemsSummary = returnRequest.items
      .map((item) =>
        [item.productName, item.variantName ? `(${item.variantName})` : null, `× ${item.quantity}`]
          .filter(Boolean)
          .join(' ')
      )
      .join('، ');
    const quantity = returnRequest.items.reduce((sum, item) => sum + (item.quantity || 0), 0);

    await prisma.deliveryAgentTask.create({
      data: {
        deliveryAgentId: agentId,
        createdByName: 'نظام المرتجعات',
        title: `استلام ${isExchange ? 'استبدال' : 'مرتجع'} #${returnRequest.orderNumber ?? returnRequest.orderId}`,
        requestType: RETURN_PICKUP_REQUEST_TYPE,
        requestedItem: itemsSummary || null,
        quantity: quantity > 0 ? quantity : null,
        details: [returnRequest.reason, returnRequest.reasonDetails].filter(Boolean).join(' — ') || null,
        priority: 'normal',
        relatedShipmentId: shipment.id,
      },
    });

    log.info('Created local return pickup task', {
      returnRequestId,
      shipmentId: shipment.id,
      deliveryAgentId: agentId,
    });
  } catch (error) {
    log.error('Failed to sync local return pickup task', {
      returnRequestId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
