import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { MERCHANT_ID, claimForUser, findUnverifiedClaims, type PrepUser } from './queue';
import { fetchLiveOrder, refreshMirrorFromLive } from './salla-live';
import { NEW_ORDER_STATUS_ID } from './sync-rules';

/**
 * Live check of a claimed order against Salla — one GET, off the packer's
 * path. The local mirror can lag a missed or late webhook; this makes sure
 * nobody packs an order that was cancelled or changed in the meantime.
 *
 * - still "طلب جديد": mark verified
 * - changed, and it's the prefetched next order: fix the mirror, drop the
 *   claim and claim a replacement (the phone picks it up on its next sync)
 * - changed, and it's already on screen: flag it so the page shows a warning
 */
export async function verifyClaim(
  assignmentId: string,
  user: PrepUser,
  options: { timeoutMs?: number; replaceFreshCurrent?: boolean } = {},
): Promise<'ok' | 'replaced' | 'flagged' | 'unknown'> {
  const row = await prisma.orderPrepAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, orderId: true, orderNumber: true, status: true, userId: true, startedAt: true },
  });
  if (!row || (row.status !== 'assigned' && row.status !== 'preparing')) return 'unknown';

  const live = await fetchLiveOrder(MERCHANT_ID, row.orderId, {
    timeoutMs: options.timeoutMs ?? 8_000,
    withItems: true,
  });
  if (live.kind === 'rate_limited' || live.kind === 'error') {
    log.info('Order prep live check skipped', { orderId: row.orderId, reason: live.kind });
    return 'unknown';
  }

  if (live.kind === 'ok' && live.statusCustomId === NEW_ORDER_STATUS_ID) {
    await prisma.orderPrepAssignment.updateMany({
      where: { id: row.id },
      data: { verifiedAt: new Date(), verifyIssue: null },
    });
    return 'ok';
  }

  const issue =
    live.kind === 'not_found' ? 'not_found' : `status:${live.statusName ?? live.statusCustomId ?? 'unknown'}`;
  if (live.kind === 'ok') {
    await refreshMirrorFromLive(MERCHANT_ID, live.detail);
  } else {
    // Gone from Salla (deleted): take it out of the queue so it isn't handed out again.
    await prisma.sallaOrder
      .updateMany({ where: { merchantId: MERCHANT_ID, orderId: row.orderId }, data: { statusCustomId: 'not_found' } })
      .catch(() => undefined);
  }
  log.warn('Claimed order is no longer packable', { orderId: row.orderId, orderNumber: row.orderNumber, issue });

  // A next order, or one put on screen moments ago at shift start (nothing
  // packed yet), is swapped silently; one being packed is flagged instead.
  const freshCurrent =
    options.replaceFreshCurrent &&
    row.status === 'preparing' &&
    row.startedAt !== null &&
    Date.now() - row.startedAt.getTime() < 30_000;
  if (row.status === 'assigned' || freshCurrent) {
    const removed = await prisma.orderPrepAssignment.deleteMany({ where: { id: row.id, status: row.status } });
    if (removed.count > 0) {
      await claimForUser(user).catch((error) =>
        log.error('Failed to claim a replacement order', { error: error instanceof Error ? error.message : error }),
      );
      return 'replaced';
    }
  }
  await prisma.orderPrepAssignment.updateMany({
    where: { id: row.id },
    data: { verifiedAt: new Date(), verifyIssue: issue },
  });
  return 'flagged';
}

/** Checks the packer's claims that haven't been checked yet. */
export async function verifyUnverifiedClaims(
  user: PrepUser,
  options: { onlyStatus?: 'assigned' | 'preparing'; timeoutMs?: number; replaceFreshCurrent?: boolean } = {},
) {
  const claims = await findUnverifiedClaims(user.id);
  for (const claim of claims) {
    if (options.onlyStatus && claim.status !== options.onlyStatus) continue;
    await verifyClaim(claim.id, user, {
      timeoutMs: options.timeoutMs,
      replaceFreshCurrent: options.replaceFreshCurrent,
    }).catch((error) =>
      log.error('Order prep live check crashed', { error: error instanceof Error ? error.message : error }),
    );
  }
}
