import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

/**
 * One return/exchange creation per order at a time.
 *
 * Two quick taps on "send" reached /api/returns/create together; both passed
 * the "already requested" checks before either saved, and two requests (and
 * two waybills) were created for the same pieces. The lock is a row keyed on
 * the order in the existing `Settings` table, whose unique `key` makes the
 * insert atomic across serverless instances without a schema change. A lock
 * older than `STALE_MS` belongs to a crashed attempt and is taken over.
 */
export const CREATE_LOCK_PREFIX = 'lock:returns-create:';
const STALE_MS = 2 * 60 * 1000;

const lockKey = (merchantId: string, orderId: string) => `${CREATE_LOCK_PREFIX}${merchantId}:${orderId}`;

const isUniqueViolation = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');

/** true when this caller now holds the lock. */
export async function acquireCreateLock(merchantId: string, orderId: string): Promise<boolean> {
  const key = lockKey(merchantId, orderId);
  const value = String(Date.now());
  try {
    await prisma.settings.create({ data: { key, value, description: 'Temporary lock while a return request is created' } });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      // Never block a customer because the lock table misbehaved.
      log.warn('Return create lock unavailable, continuing without it', { error });
      return true;
    }
  }
  // Held: take it over only if it is stale, and only if nobody else did first.
  const taken = await prisma.settings.updateMany({
    where: { key, value: { lt: String(Date.now() - STALE_MS).padStart(value.length, '0') } },
    data: { value },
  });
  return taken.count === 1;
}

export async function releaseCreateLock(merchantId: string, orderId: string): Promise<void> {
  try {
    await prisma.settings.deleteMany({ where: { key: lockKey(merchantId, orderId) } });
  } catch (error) {
    log.warn('Failed to release return create lock', { error });
  }
}
