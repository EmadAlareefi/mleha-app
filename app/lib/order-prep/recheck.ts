import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { NEW_ORDER_STATUS_ID } from './sync-rules';

/** True when a Salla status means a packer should no longer be working on the order. */
export function statusNeedsRecheck(statusCustomId: string | null | undefined): boolean {
  return Boolean(statusCustomId) && statusCustomId !== NEW_ORDER_STATUS_ID;
}

/**
 * Salla says an order left "طلب جديد" (cancelled, moved to review, ...) while a
 * packer may be holding it. A claim is checked against Salla only once, when
 * it is taken, so a change after that went unnoticed until packing was done.
 *
 * This does not act on the webhook itself (its signature is not enforced): it
 * only clears the claim's "verified" mark. The packer's next heartbeat then
 * runs the normal live check, which drops a next-up order or shows the warning
 * on the one on screen.
 *
 * Completed claims are untouched, so the status change order prep itself makes
 * after packing does not trigger anything. v1 claims are never marked verified
 * and are untouched too.
 */
export async function markClaimsForRecheck(merchantId: string, orderId: string): Promise<number> {
  try {
    const marked = await prisma.orderPrepAssignment.updateMany({
      where: { merchantId, orderId, status: { in: ['assigned', 'preparing'] }, verifiedAt: { not: null } },
      data: { verifiedAt: null },
    });
    if (marked.count > 0) log.info('Order changed in Salla while claimed; live check queued', { orderId });
    return marked.count;
  } catch (error) {
    // Never fail a webhook over this; the outbox compare-and-set still protects Salla.
    log.warn('Could not queue a live check for a claimed order', { orderId, error: error instanceof Error ? error.message : error });
    return 0;
  }
}
