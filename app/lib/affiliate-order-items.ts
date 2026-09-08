import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

const ORDER_BATCH_SIZE = 500;

type OrderReference = { merchantId: string; orderId: string };
type CommissionItem = { productId: string | null; totalAmount: Prisma.Decimal | null };

/** Avoid Prisma's unbounded composite-key relation query for large date ranges. */
export async function loadAffiliateOrderItems<T extends OrderReference>(
  orders: T[]
): Promise<Array<T & { items: CommissionItem[] }>> {
  const ordersByMerchant = new Map<string, Map<string, CommissionItem[]>>();
  for (const order of orders) {
    let merchantOrders = ordersByMerchant.get(order.merchantId);
    if (!merchantOrders) {
      merchantOrders = new Map();
      ordersByMerchant.set(order.merchantId, merchantOrders);
    }
    merchantOrders.set(order.orderId, []);
  }

  for (const [merchantId, merchantOrders] of ordersByMerchant) {
    const orderIds = Array.from(merchantOrders.keys());
    for (let offset = 0; offset < orderIds.length; offset += ORDER_BATCH_SIZE) {
      const items = await prisma.sallaOrderItem.findMany({
        where: {
          merchantId,
          orderId: { in: orderIds.slice(offset, offset + ORDER_BATCH_SIZE) },
        },
        select: { orderId: true, productId: true, totalAmount: true },
      });
      for (const item of items) {
        merchantOrders.get(item.orderId)?.push({
          productId: item.productId,
          totalAmount: item.totalAmount,
        });
      }
    }
  }

  return orders.map((order) => ({
    ...order,
    items: ordersByMerchant.get(order.merchantId)!.get(order.orderId)!,
  }));
}
