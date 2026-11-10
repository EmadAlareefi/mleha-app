import { prisma } from '@/lib/prisma';
import { buildPrepOrder } from '@/app/lib/order-prep/payload';
import type { OrderItemsDetail } from './types';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/** Items of one order for an expanded analytics row (stored data only). */
export async function getOrderItemsDetail(orderId: string): Promise<OrderItemsDetail | null> {
  const order = await prisma.sallaOrder.findUnique({
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
  const card = buildPrepOrder({
    orderId,
    orderNumber: order.referenceId || order.orderNumber,
    placedAt: order.placedAt,
    rawOrder: order.rawOrder,
    storedItems: order.items,
    locations: [],
  });
  return {
    items: card.items.map((item) => ({
      name: item.name,
      size: item.size,
      color: item.color,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      sku: item.sku,
    })),
    sallaUrl: `https://s.salla.sa/orders/order/${encodeURIComponent(orderId)}`,
  };
}
