import { prisma } from '@/lib/prisma';

/**
 * True while the customer is changing this order through /my-order (or a
 * change is waiting for staff). Packing and shipping must leave the order
 * alone until the hold is released.
 */
export async function isOrderHeldByCustomer(merchantId: string, orderId: string): Promise<boolean> {
  const hold = await prisma.customerOrderChange.findFirst({
    where: { merchantId, orderId, holdActive: true },
    select: { id: true },
  });
  return Boolean(hold);
}

export const CUSTOMER_HOLD_MESSAGE = 'العميل يعدّل هذا الطلب الآن. انتظر حتى ينتهي التعديل.';
