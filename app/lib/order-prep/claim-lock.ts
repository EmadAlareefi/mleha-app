import type { Prisma } from '@prisma/client';

/**
 * The one lock every order claim goes through. Order prep takes it before
 * handing an order to a packer; customer self-service takes the same lock
 * before putting a hold on an order, so an order is never both claimed and
 * being changed by its customer.
 */
export const prepQueueLockKey = (merchantId: string) => `order-prep-claim:${merchantId}`;

/** Held until the surrounding transaction ends. */
export async function lockPrepQueue(tx: Prisma.TransactionClient, merchantId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${prepQueueLockKey(merchantId)}))::text`;
}
