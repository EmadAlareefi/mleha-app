import { prisma } from '@/lib/prisma';
import { STATUS_IDS } from '@/SALLA_ORDER_STATUSES';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/** The last time staff stopped this order (moved it to X4), and why. */
export type StopReason = {
  note: string;
  byName: string | null;
  at: string;
  source: 'prep' | 'shipping';
};

/**
 * Latest X4 stop per order. A prep stop is kept on OrderPrepEscalation (also
 * from the old page); a shipping stop only on its outbox job (no escalation).
 */
export async function loadLastStops(orderIds: string[]): Promise<Map<string, StopReason>> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const result = new Map<string, StopReason>();
  if (ids.length === 0) return result;

  const [escalations, shippingJobs] = await Promise.all([
    prisma.orderPrepEscalation.findMany({
      where: { merchantId: MERCHANT_ID, orderId: { in: ids }, statusTarget: 'under_review_x4' },
      orderBy: { createdAt: 'desc' },
      select: { orderId: true, notes: true, createdByName: true, createdAt: true },
    }),
    prisma.orderPrepSallaSync.findMany({
      where: {
        merchantId: MERCHANT_ID,
        orderId: { in: ids },
        kind: 'exception',
        targetStatusId: STATUS_IDS.UNDER_REVIEW_X4,
        escalationId: null,
        state: { not: 'dismissed' },
      },
      orderBy: { createdAt: 'desc' },
      select: { orderId: true, note: true, createdByName: true, createdAt: true },
    }),
  ]);

  const candidates = [
    ...escalations.map((row) => ({ orderId: row.orderId, note: row.notes, byName: row.createdByName, at: row.createdAt, source: 'prep' as const })),
    ...shippingJobs.map((row) => ({ orderId: row.orderId, note: row.note, byName: row.createdByName, at: row.createdAt, source: 'shipping' as const })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  for (const row of candidates) {
    if (result.has(row.orderId)) continue;
    result.set(row.orderId, {
      note: row.note?.trim() || 'بدون سبب مسجّل',
      byName: row.byName,
      at: row.at.toISOString(),
      source: row.source,
    });
  }
  return result;
}
