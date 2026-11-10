import { prisma } from '@/lib/prisma';

type Db = Pick<typeof prisma, 'returnRequest'>;

export type StaffLockResult<T> = { ok: true; value: T } | { ok: false; reason: 'locked' | 'not_found' };

/**
 * Runs `fn` while the request is marked `processing`, so one-click processing,
 * coupon actions and piece edits on the same request never interleave.
 *
 * Unlike claimProcessing (process-return.ts) it keeps `processingError` and puts
 * the previous processing status back afterwards — a "needs attention" request
 * stays one, a closed (`done`) one stays closed. A claim another run holds is
 * refused; an abandoned one is taken over by one-click processing, not here.
 */
export async function withStaffLock<T>(
  id: string,
  fn: (previousStatus: string) => Promise<T>,
  options: { db?: Db } = {},
): Promise<StaffLockResult<T>> {
  const db = options.db ?? prisma;
  const current = await db.returnRequest.findUnique({ where: { id }, select: { processingStatus: true } });
  if (!current) return { ok: false, reason: 'not_found' };
  const previous = current.processingStatus || 'idle';
  if (previous === 'processing') return { ok: false, reason: 'locked' };

  // Compare-and-set: only one caller moves it off `previous`.
  const claimed = await db.returnRequest.updateMany({
    where: { id, processingStatus: previous },
    data: { processingStatus: 'processing' },
  });
  if (claimed.count === 0) return { ok: false, reason: 'locked' };

  try {
    return { ok: true, value: await fn(previous) };
  } finally {
    await db.returnRequest.updateMany({
      where: { id, processingStatus: 'processing' },
      data: { processingStatus: previous },
    });
  }
}

export const STAFF_LOCK_MESSAGE = 'الطلب قيد المعالجة أو يُعدَّل الآن، حاولي بعد قليل.';
