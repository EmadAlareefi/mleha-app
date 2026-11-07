import type { Prisma } from '@prisma/client';

/**
 * Database filters for the management queues. They mirror `deriveStage` in
 * lib/returns/workflow.ts closely enough for tab counts; each row's badge uses
 * `deriveStage` itself.
 */
export const QUEUE_TABS = ['ready', 'needs_attention', 'received', 'in_transit', 'completed', 'closed', 'all'] as const;
export type QueueTab = (typeof QUEUE_TABS)[number];

const OPEN = { notIn: ['completed', 'cancelled', 'rejected'] };
const allInspected: Prisma.ReturnRequestWhereInput = {
  items: { some: {}, every: { conditionStatus: { not: null } } },
};
const notAllInspected: Prisma.ReturnRequestWhereInput = {
  items: { some: { conditionStatus: null } },
};

export function queueWhere(tab: QueueTab): Prisma.ReturnRequestWhereInput {
  switch (tab) {
    case 'ready':
      return { status: OPEN, processingStatus: 'idle', ...allInspected };
    case 'needs_attention':
      return { status: OPEN, processingStatus: { in: ['needs_attention', 'processing'] } };
    case 'received':
      return {
        status: OPEN,
        processingStatus: 'idle',
        AND: [
          notAllInspected,
          {
            OR: [
              { status: 'delivered' },
              { receivedAt: { not: null } },
              { items: { some: { conditionStatus: { not: null } } } },
            ],
          },
        ],
      };
    case 'in_transit':
      return {
        status: { in: ['pending_review', 'approved', 'shipped'] },
        processingStatus: 'idle',
        receivedAt: null,
        items: { none: { conditionStatus: { not: null } } },
      };
    case 'completed':
      return { status: 'completed' };
    case 'closed':
      return { status: { in: ['cancelled', 'rejected'] } };
    case 'all':
    default:
      return {};
  }
}

export const isQueueTab = (value: unknown): value is QueueTab =>
  typeof value === 'string' && (QUEUE_TABS as readonly string[]).includes(value);
