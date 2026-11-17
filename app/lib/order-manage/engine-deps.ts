import { Prisma, type CustomerOrderChange } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchLiveOrder } from '@/app/lib/order-prep/salla-live';
import { withCustomerHold } from '@/app/lib/order-prep/queue';
import { deriveStatusCustomId } from '@/app/lib/salla-orders';
import { upsertSallaOrderFromPayload } from '@/app/lib/salla-sync';
import { SALLA_CANCELED_STATUS_ID, cancelExchangeOrder } from '@/app/lib/salla-exchange-order';
import { createSallaOrderHistoryEntry } from '@/app/lib/salla-order-status';
import { findHistoryRefunds, listOrderTransactions, refundTransaction } from '@/app/lib/salla-transactions';
import type { ChangeRow, ChangeWhere, EngineDeps } from './engine';
import { loadOrderContext } from './facts';
import { isWriteAllowedInThisEnvironment, type OrderManageAction } from './settings';
import type { WorkerStore } from './worker';

/** The real database and Salla behind the customer-change engine. */

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function toRow(record: CustomerOrderChange): ChangeRow {
  const before = record.before && typeof record.before === 'object' && !Array.isArray(record.before) ? (record.before as Record<string, unknown>) : {};
  return {
    id: record.id,
    merchantId: record.merchantId,
    orderId: record.orderId,
    orderNumber: record.orderNumber,
    kind: record.kind as OrderManageAction,
    state: record.state as ChangeRow['state'],
    holdActive: record.holdActive,
    idempotencyKey: record.idempotencyKey,
    writeStatus: record.writeStatus as ChangeRow['writeStatus'],
    refundStatus: record.refundStatus as ChangeRow['refundStatus'],
    refundAmount: numberOrNull(record.refundAmount),
    refundTransactionId: record.refundTransactionId,
    currency: record.currency,
    paymentMethod: record.paymentMethod,
    orderTotal: numberOrNull(before.total),
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function whereOf(id: string, where: ChangeWhere): Prisma.CustomerOrderChangeWhereInput {
  const { refundStatus, ...rest } = where;
  return {
    id,
    ...rest,
    ...(refundStatus === undefined ? {} : { refundStatus: Array.isArray(refundStatus) ? { in: refundStatus } : refundStatus }),
  };
}

export const productionEngineDeps: EngineDeps = {
  now: () => new Date(),
  writeAllowed: (orderId) => isWriteAllowedInThisEnvironment(orderId),

  async loadContext(merchantId, orderId) {
    const context = await loadOrderContext(merchantId, orderId);
    if (!context) return null;
    const { view } = context;
    return {
      verdicts: context.verdicts,
      settings: context.settings,
      orderNumber: view.orderNumber,
      total: view.total,
      currency: view.currency,
      paymentMethod: view.paymentMethod,
      snapshot: {
        total: view.total,
        currency: view.currency,
        paymentMethod: view.paymentMethod,
        statusName: view.statusName,
        items: view.items.map((item) => ({ id: item.id, productId: item.productId, sku: item.sku, quantity: item.quantity, total: item.total })),
      },
    };
  },

  async findChange(id) {
    const record = await prisma.customerOrderChange.findUnique({ where: { id } });
    return record ? toRow(record) : null;
  },

  async findChangeByKey(idempotencyKey) {
    const record = await prisma.customerOrderChange.findUnique({ where: { idempotencyKey } });
    return record ? toRow(record) : null;
  },

  countHoldsSince: (since) => prisma.customerOrderChange.count({ where: { createdAt: { gte: since } } }),

  async createHold(input) {
    const result = await withCustomerHold(input.orderId, (tx) =>
      tx.customerOrderChange.create({
        data: {
          merchantId: input.merchantId,
          orderId: input.orderId,
          orderNumber: input.orderNumber,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          accessId: input.accessId,
          ipHash: input.ipHash,
          request: (input.request ?? {}) as Prisma.InputJsonValue,
          before: (input.before ?? {}) as Prisma.InputJsonValue,
          paymentMethod: input.paymentMethod,
          currency: input.currency,
          steps: [{ at: new Date().toISOString(), step: 'hold', result: 'ok' }],
        },
      }),
    );
    return result.ok ? toRow(result.value) : null;
  },

  async updateChange(id, where, patch) {
    const { step, after, ...fields } = patch;
    const updated = await prisma.customerOrderChange.updateMany({
      where: whereOf(id, where),
      data: { ...fields, ...(after === undefined ? {} : { after: (after ?? Prisma.JsonNull) as Prisma.InputJsonValue }) },
    });
    if (updated.count === 0) return false;
    if (step) {
      // The audit trail is appended in place, so two writers never lose an entry.
      const entry = JSON.stringify([{ at: new Date().toISOString(), ...step }]);
      await prisma.$executeRaw`
        UPDATE "CustomerOrderChange" SET "steps" = COALESCE("steps", '[]'::jsonb) || ${entry}::jsonb WHERE "id" = ${id}
      `.catch(() => undefined);
    }
    return true;
  },

  fetchLive: (merchantId, orderId) => fetchLiveOrder(merchantId, orderId, { withItems: true, timeoutMs: 10_000 }),

  async syncMirror(merchantId, detail) {
    const result = await upsertSallaOrderFromPayload({
      merchantId,
      merchant_id: merchantId,
      order: { ...detail, merchant_id: merchantId, merchantId },
    });
    if (!result.success || !result.orderId) return false;
    // The upsert skips payloads it believes are stale, so check what is stored.
    const stored = await prisma.sallaOrder.findUnique({
      where: { merchantId_orderId: { merchantId, orderId: result.orderId } },
      select: { statusCustomId: true },
    });
    return Boolean(stored) && stored!.statusCustomId === deriveStatusCustomId(detail);
  },

  async markMirrorCancelled(merchantId, orderId) {
    await prisma.sallaOrder.updateMany({
      where: { merchantId, orderId },
      data: { statusCustomId: String(SALLA_CANCELED_STATUS_ID), statusSlug: 'canceled', statusName: 'ملغي' },
    });
  },

  cancelOrder: (merchantId, orderId) => cancelExchangeOrder(merchantId, orderId),

  async addHistoryNote(merchantId, orderId, note) {
    await createSallaOrderHistoryEntry(merchantId, orderId, note, { timeoutMs: 8_000 });
  },

  listTransactions: listOrderTransactions,
  findHistoryRefunds,
  refund: refundTransaction,

  async autoRefundedSince(since) {
    const sum = await prisma.customerOrderChange.aggregate({
      _sum: { refundAmount: true },
      where: {
        refundStatus: { in: ['requested', 'refunded', 'unknown'] },
        refundTransactionId: { not: null },
        currency: 'SAR',
        updatedAt: { gte: since },
      },
    });
    return Number(sum._sum.refundAmount ?? 0);
  },
};

const BATCH = 20;
const RECENT_MS = 7 * 86_400_000;

const rows = (where: Prisma.CustomerOrderChangeWhereInput) =>
  prisma.customerOrderChange.findMany({ where, orderBy: { updatedAt: 'asc' }, take: BATCH }).then((records) => records.map(toRow));

export const productionWorkerStore: WorkerStore = {
  findAbandonedHolds: (before) => rows({ state: 'held', writeStatus: 'none', holdActive: true, updatedAt: { lt: before } }),
  findInterruptedWrites: (before) => rows({ state: 'applying', writeStatus: 'requested', updatedAt: { lt: before } }),
  findUnreleasedCancels: (before) => rows({ kind: 'cancel', writeStatus: 'done', holdActive: true, updatedAt: { lt: before } }),
  findUnknownCancels: () =>
    rows({ kind: 'cancel', state: 'needs_staff', writeStatus: 'unknown', createdAt: { gte: new Date(Date.now() - RECENT_MS) } }),
  findUndecidedRefunds: () => rows({ kind: 'cancel', state: 'completed', writeStatus: 'done', refundStatus: 'none' }),
  findUnknownRefunds: () => rows({ refundStatus: 'unknown', createdAt: { gte: new Date(Date.now() - RECENT_MS) } }),
};
