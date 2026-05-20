import 'server-only';

import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type { SallaInvoice, SallaOrder } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  postInvoiceToERP,
  syncOrderToERP,
  transformOrderToERPInvoice,
} from '@/app/lib/erp-invoice';
import { syncSallaInvoices } from '@/app/lib/salla-invoices-v2';
import { syncSallaOrders } from '@/app/lib/salla-orders';
import { upsertSallaOrderFromPayload } from '@/app/lib/salla-sync';
import {
  NEGATIVE_ERP_INVOICE_ID_PREFIX,
  getERPOrderSyncError,
  hasSuccessfulERPSync,
  isNegativeERPInvoiceId,
} from '@/lib/erp-order-sync';
import {
  buildUnsupportedERPCurrencyMessage,
  isSupportedERPCurrency,
} from '@/lib/erp-currency';
import {
  isDefiniteRefundStatus,
  isPotentialRefundStatus,
} from '@/lib/refund-status';

export type PendingERPOrderRowStatus = 'ready' | 'error' | 'synced';
export type PendingERPRefundRowStatus = 'ready' | 'error' | 'waiting';

export type PendingERPOrderRow = {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  statusSlug: string | null;
  statusName: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  totalAmount: number | null;
  customerName: string | null;
  customerMobile: string | null;
  placedAt: string | null;
  erpInvoiceId: string | null;
  erpSyncedAt: string | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
  queueStatus: PendingERPOrderRowStatus;
  queueStatusLabel: string;
  queueStatusMessage: string | null;
  canSync: boolean;
};

export type PendingERPRefundRow = {
  id: string;
  merchantId: string;
  orderRecordId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderStatusSlug: string | null;
  orderStatusName: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  totalAmount: number | null;
  customerName: string | null;
  customerMobile: string | null;
  placedAt: string | null;
  refundInvoiceRecordId: string | null;
  refundInvoiceId: string | null;
  refundInvoiceNumber: string | null;
  refundInvoiceStatus: string | null;
  refundInvoicePaymentStatus: string | null;
  refundInvoiceIssueDate: string | null;
  refundSource: 'order' | 'invoice' | 'order+invoice';
  refundSourceLabel: string;
  erpSyncedAt: string | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
  queueStatus: PendingERPRefundRowStatus;
  queueStatusLabel: string;
  queueStatusMessage: string | null;
  canSync: boolean;
};

export type SallaRefreshSummary = {
  ordersMerchantsProcessed: number;
  ordersFetched: number;
  ordersStored: number;
  orderErrors: number;
  invoicesMerchantsProcessed: number;
  invoicesFetched: number;
  invoicesStored: number;
  invoiceErrors: number;
};

export type InvoicesAndRefundInvoicesData = {
  generatedAt: string;
  orders: PendingERPOrderRow[];
  refunds: PendingERPRefundRow[];
};

export type SyncInvoicesAndRefundInvoicesResult =
  | {
      queueType: 'order';
      alreadyRecorded: boolean;
      erpInvoiceId: string;
      message: string;
      orderId: string;
      orderNumber: string | null;
    }
  | {
      queueType: 'refund';
      alreadyRecorded: boolean;
      erpInvoiceId: string;
      message: string;
      orderId: string | null;
      orderNumber: string | null;
      invoiceId: string | null;
      invoiceNumber: string | null;
    };

export class InvoicesAndRefundInvoicesError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'InvoicesAndRefundInvoicesError';
    this.statusCode = statusCode;
  }
}

type DateRangeInput = {
  startDate?: string;
  endDate?: string;
};

type RefundInvoiceRecord = {
  id: string;
  merchantId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  orderId: string | null;
  orderNumber: string | null;
  status: string | null;
  paymentStatus: string | null;
  currency: string | null;
  totalAmount: number | null;
  issueDate: Date | null;
  customerName: string | null;
  customerMobile: string | null;
  erpSyncedAt: Date | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
  rawOrder: unknown;
};

type RefundSyncStateRecord = {
  erpInvoiceId: string | null;
  erpSyncedAt: Date | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
};

type ERPRefundOrderSyncRecord = RefundSyncStateRecord & {
  id: string;
  merchantId: string;
  orderRecordId: string;
  orderId: string;
  orderNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseDateStart(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseDateEnd(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isRefundCandidateInvoice(
  invoice: Pick<SallaInvoice, 'status' | 'paymentStatus' | 'totalAmount'>
): boolean {
  return (
    isPotentialRefundStatus(invoice.status) ||
    isPotentialRefundStatus(invoice.paymentStatus) ||
    (invoice.totalAmount != null && Number(invoice.totalAmount) < 0)
  );
}

function isDefiniteRefundOrder(
  order: Pick<SallaOrder, 'statusSlug' | 'statusName' | 'totalAmount'>
): boolean {
  return (
    isDefiniteRefundStatus(order.statusSlug) ||
    isDefiniteRefundStatus(order.statusName) ||
    (order.totalAmount != null && Number(order.totalAmount) < 0)
  );
}

function hasCompletedRefundSync(
  state: Pick<RefundSyncStateRecord, 'erpSyncedAt' | 'erpSyncError'> | null
): boolean {
  return Boolean(state?.erpSyncedAt && !state.erpSyncError);
}

function mapOrderQueueStatus(
  order: Pick<SallaOrder, 'erpSyncedAt' | 'erpInvoiceId' | 'erpSyncError'>,
  options: {
    supportedCurrency?: boolean;
    currencyMessage?: string;
  } = {}
): Pick<PendingERPOrderRow, 'queueStatus' | 'queueStatusLabel' | 'queueStatusMessage' | 'canSync'> {
  if (hasSuccessfulERPSync(order)) {
    return {
      queueStatus: 'synced',
      queueStatusLabel: 'تم إرسال فاتورة البيع',
      queueStatusMessage: null,
      canSync: false,
    };
  }

  if (options.supportedCurrency === false) {
    return {
      queueStatus: 'error',
      queueStatusLabel: 'عملة غير مدعومة',
      queueStatusMessage: options.currencyMessage || buildUnsupportedERPCurrencyMessage(null),
      canSync: false,
    };
  }

  const erpSyncError = getERPOrderSyncError(order);

  if (erpSyncError) {
    return {
      queueStatus: 'error',
      queueStatusLabel: 'فشل سابقاً وقابل لإعادة المحاولة',
      queueStatusMessage: erpSyncError,
      canSync: true,
    };
  }

  return {
    queueStatus: 'ready',
    queueStatusLabel: 'جاهز لإرسال فاتورة البيع',
    queueStatusMessage: null,
    canSync: true,
  };
}

function mapRefundQueueStatus(
  syncState: Pick<RefundSyncStateRecord, 'erpSyncError'> | null,
  options: {
    allowDirectOrderSync?: boolean;
    hasSaleInvoiceSync?: boolean;
    saleInvoiceMessage?: string;
    supportedCurrency?: boolean;
    currencyMessage?: string;
  } = {}
): Pick<PendingERPRefundRow, 'queueStatus' | 'queueStatusLabel' | 'queueStatusMessage' | 'canSync'> {
  if (options.supportedCurrency === false) {
    return {
      queueStatus: 'error',
      queueStatusLabel: 'عملة غير مدعومة',
      queueStatusMessage: options.currencyMessage || buildUnsupportedERPCurrencyMessage(null),
      canSync: false,
    };
  }

  if (options.hasSaleInvoiceSync === false) {
    return {
      queueStatus: 'waiting',
      queueStatusLabel: 'بانتظار إرسال فاتورة البيع أولاً',
      queueStatusMessage:
        options.saleInvoiceMessage ||
        'يجب إرسال فاتورة البيع الأصلية إلى ERP أولاً قبل إرسال المرتجع.',
      canSync: false,
    };
  }

  if (syncState?.erpSyncError) {
    return {
      queueStatus: 'error',
      queueStatusLabel: 'فشل سابقاً وقابل لإعادة المحاولة',
      queueStatusMessage: syncState.erpSyncError,
      canSync: true,
    };
  }

  if (options.allowDirectOrderSync) {
    return {
      queueStatus: 'ready',
      queueStatusLabel: 'جاهز لإرسال المرتجع من الطلب',
      queueStatusMessage:
        'يمكن إرسال هذا المرتجع مباشرة من بيانات الطلب حتى لو لم تصل فاتورة المرتجع من سلة بعد.',
      canSync: true,
    };
  }

  return {
    queueStatus: 'ready',
    queueStatusLabel: 'جاهز لإرسال المرتجع كفاتورة',
    queueStatusMessage: null,
    canSync: true,
  };
}

function buildIdentityKeys(
  merchantId: string,
  orderId: string | null | undefined,
  orderNumber: string | null | undefined
): string[] {
  const keys = new Set<string>();

  const normalizedOrderId = String(orderId ?? '').trim();
  if (normalizedOrderId) {
    keys.add(`${merchantId}::id::${normalizedOrderId}`);
  }

  const normalizedOrderNumber = String(orderNumber ?? '').trim();
  if (normalizedOrderNumber) {
    keys.add(`${merchantId}::number::${normalizedOrderNumber}`);
  }

  return Array.from(keys);
}

function getRefundSourceLabel(source: PendingERPRefundRow['refundSource']): string {
  switch (source) {
    case 'order+invoice':
      return 'SallaOrder + SallaInvoice';
    case 'invoice':
      return 'SallaInvoice فقط';
    default:
      return 'SallaOrder فقط';
  }
}

function forceRefundOrder(order: SallaOrder): SallaOrder {
  return {
    ...order,
    statusSlug: 'refund',
  };
}

function forceSaleOrder(order: SallaOrder): SallaOrder {
  return {
    ...order,
    statusSlug: 'sale',
    statusName: 'sale',
  };
}

function getRawOrderRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, any>;
}

function getRawString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getRawStatus(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return getRawString(
      record.slug,
      record.code,
      record.status,
      record.name,
      record.label,
      record.value,
      record.id
    );
  }

  return null;
}

function getRawDate(...values: unknown[]): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const parsed = value instanceof Date ? value : new Date(String(value));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

async function listERPRefundOrderSyncRecords(
  orderRecordIds: string[]
): Promise<ERPRefundOrderSyncRecord[]> {
  const normalizedOrderRecordIds = Array.from(
    new Set(orderRecordIds.map((value) => String(value).trim()).filter(Boolean))
  );

  if (normalizedOrderRecordIds.length === 0) {
    return [];
  }

  return prisma.$queryRaw<ERPRefundOrderSyncRecord[]>(Prisma.sql`
    SELECT
      "id",
      "merchantId",
      "orderRecordId",
      "orderId",
      "orderNumber",
      "erpInvoiceId",
      "erpSyncedAt",
      "erpSyncError",
      "erpSyncAttempts",
      "createdAt",
      "updatedAt"
    FROM "ERPRefundOrderSync"
    WHERE "orderRecordId" IN (${Prisma.join(normalizedOrderRecordIds)})
  `);
}

async function getERPRefundOrderSyncRecord(
  orderRecordId: string
): Promise<ERPRefundOrderSyncRecord | null> {
  const [record] = await listERPRefundOrderSyncRecords([orderRecordId]);
  return record ?? null;
}

async function upsertERPRefundOrderSyncRecord(input: {
  order: Pick<SallaOrder, 'id' | 'merchantId' | 'orderId' | 'orderNumber'>;
  erpInvoiceId: string | null;
  erpSyncedAt: Date | null;
  erpSyncError: string | null;
}): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "ERPRefundOrderSync" (
        "id",
        "merchantId",
        "orderRecordId",
        "orderId",
        "orderNumber",
        "erpInvoiceId",
        "erpSyncedAt",
        "erpSyncError",
        "erpSyncAttempts",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${input.order.merchantId},
        ${input.order.id},
        ${input.order.orderId},
        ${input.order.orderNumber},
        ${input.erpInvoiceId},
        ${input.erpSyncedAt},
        ${input.erpSyncError},
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT ("orderRecordId") DO UPDATE SET
        "merchantId" = EXCLUDED."merchantId",
        "orderId" = EXCLUDED."orderId",
        "orderNumber" = EXCLUDED."orderNumber",
        "erpInvoiceId" = EXCLUDED."erpInvoiceId",
        "erpSyncedAt" = EXCLUDED."erpSyncedAt",
        "erpSyncError" = EXCLUDED."erpSyncError",
        "erpSyncAttempts" = "ERPRefundOrderSync"."erpSyncAttempts" + 1,
        "updatedAt" = NOW()
    `
  );
}

async function deleteERPRefundOrderSyncRecord(orderRecordId: string): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`DELETE FROM "ERPRefundOrderSync" WHERE "orderRecordId" = ${orderRecordId}`
  );
}

async function listPendingERPOrders(dateRange: DateRangeInput = {}): Promise<PendingERPOrderRow[]> {
  const startDate = parseDateStart(dateRange.startDate);
  const endDate = parseDateEnd(dateRange.endDate);
  const where: Prisma.SallaOrderWhereInput = {};

  if (startDate || endDate) {
    where.placedAt = {
      gte: startDate,
      lte: endDate,
    };
  }

  const orders = await prisma.sallaOrder.findMany({
    where,
    orderBy: {
      placedAt: 'asc',
    },
    select: {
      id: true,
      merchantId: true,
      orderId: true,
      orderNumber: true,
      statusSlug: true,
      statusName: true,
      paymentStatus: true,
      paymentMethod: true,
      currency: true,
      totalAmount: true,
      customerName: true,
      customerMobile: true,
      placedAt: true,
      erpInvoiceId: true,
      erpSyncedAt: true,
      erpSyncError: true,
      erpSyncAttempts: true,
    },
  });

  return orders.map((order) => {
    const queueStatus = mapOrderQueueStatus(order, {
      supportedCurrency: isSupportedERPCurrency(order.currency),
      currencyMessage: buildUnsupportedERPCurrencyMessage(order.currency),
    });
    const hasRefundSignal =
      isPotentialRefundStatus(order.statusSlug) ||
      isPotentialRefundStatus(order.statusName) ||
      (order.totalAmount != null && Number(order.totalAmount) < 0);

    return {
      id: order.id,
      merchantId: order.merchantId,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      statusSlug: order.statusSlug,
      statusName: order.statusName,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      currency: order.currency,
      totalAmount: order.totalAmount != null ? Number(order.totalAmount) : null,
      customerName: order.customerName,
      customerMobile: order.customerMobile,
      placedAt: order.placedAt?.toISOString() ?? null,
      erpInvoiceId: order.erpInvoiceId,
      erpSyncedAt: order.erpSyncedAt?.toISOString() ?? null,
      erpSyncError: getERPOrderSyncError(order),
      erpSyncAttempts: order.erpSyncAttempts,
      queueStatus: queueStatus.queueStatus,
      queueStatusLabel: queueStatus.queueStatusLabel,
      queueStatusMessage:
        queueStatus.queueStatusMessage ||
        (hasRefundSignal
          ? 'هذا الطلب عليه إشارة مرتجع لاحقاً، لكن يجب إرسال فاتورة البيع الأصلية إلى ERP أولاً.'
          : null),
      canSync: queueStatus.canSync,
    };
  });
}

async function listPendingERPRefunds(dateRange: DateRangeInput = {}): Promise<PendingERPRefundRow[]> {
  const startDate = parseDateStart(dateRange.startDate);
  const endDate = parseDateEnd(dateRange.endDate);

  const refundOrdersWhere: Prisma.SallaOrderWhereInput = {};
  if (startDate || endDate) {
    refundOrdersWhere.placedAt = {
      gte: startDate,
      lte: endDate,
    };
  }

  const refundInvoicesWhere: Prisma.SallaInvoiceWhereInput = {};
  if (startDate || endDate) {
    refundInvoicesWhere.issueDate = {
      gte: startDate,
      lte: endDate,
    };
  }

  const [allOrders, invoices] = await Promise.all([
    prisma.sallaOrder.findMany({
      where: refundOrdersWhere,
      orderBy: {
        placedAt: 'asc',
      },
      select: {
        id: true,
        merchantId: true,
        orderId: true,
        orderNumber: true,
        statusSlug: true,
        statusName: true,
        paymentStatus: true,
        paymentMethod: true,
        currency: true,
        totalAmount: true,
        customerName: true,
        customerMobile: true,
        placedAt: true,
        erpSyncedAt: true,
        erpInvoiceId: true,
        erpSyncError: true,
      },
    }),
    prisma.sallaInvoice.findMany({
      where: refundInvoicesWhere,
      orderBy: {
        issueDate: 'asc',
      },
      select: {
        id: true,
        merchantId: true,
        invoiceId: true,
        invoiceNumber: true,
        orderId: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        currency: true,
        totalAmount: true,
        issueDate: true,
        customerName: true,
        customerMobile: true,
        erpSyncedAt: true,
        erpSyncError: true,
        erpSyncAttempts: true,
        rawOrder: true,
      },
    }),
  ]);

  const refundOrders = allOrders.filter(
    (order) =>
      isPotentialRefundStatus(order.statusSlug) ||
      isPotentialRefundStatus(order.statusName) ||
      (order.totalAmount != null && Number(order.totalAmount) < 0)
  );

  const refundOrderSyncRecords = await listERPRefundOrderSyncRecords(refundOrders.map((order) => order.id));
  const refundOrderSyncByOrderRecordId = new Map(
    refundOrderSyncRecords.map((record) => [record.orderRecordId, record])
  );

  const refundInvoices = invoices
    .filter((invoice) => isRefundCandidateInvoice(invoice))
    .map((invoice) => ({
      id: invoice.id,
      merchantId: invoice.merchantId,
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      orderId: invoice.orderId,
      orderNumber: invoice.orderNumber,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      currency: invoice.currency,
      totalAmount: invoice.totalAmount != null ? Number(invoice.totalAmount) : null,
      issueDate: invoice.issueDate,
      customerName: invoice.customerName,
      customerMobile: invoice.customerMobile,
      erpSyncedAt: invoice.erpSyncedAt,
      erpSyncError: invoice.erpSyncError,
      erpSyncAttempts: invoice.erpSyncAttempts,
      rawOrder: invoice.rawOrder,
    }));

  const refundInvoicesByKey = new Map<string, RefundInvoiceRecord[]>();
  for (const invoice of refundInvoices) {
    for (const key of buildIdentityKeys(invoice.merchantId, invoice.orderId, invoice.orderNumber)) {
      const existing = refundInvoicesByKey.get(key) || [];
      existing.push(invoice);
      refundInvoicesByKey.set(key, existing);
    }
  }

  const ordersByKey = new Map<string, typeof allOrders>();
  for (const order of allOrders) {
    for (const key of buildIdentityKeys(order.merchantId, order.orderId, order.orderNumber)) {
      const existing = ordersByKey.get(key) || [];
      existing.push(order);
      ordersByKey.set(key, existing);
    }
  }

  const matchedInvoiceIds = new Set<string>();

  const orderRows = refundOrders.flatMap<PendingERPRefundRow>((order) => {
    const orderSyncRecord = refundOrderSyncByOrderRecordId.get(order.id) ?? null;
    const hasSaleInvoiceSync = hasSuccessfulERPSync(order);
    const supportedCurrency = isSupportedERPCurrency(order.currency);
    const linkedInvoices = buildIdentityKeys(order.merchantId, order.orderId, order.orderNumber)
      .flatMap((key) => refundInvoicesByKey.get(key) || [])
      .filter((invoice, index, array) => array.findIndex((item) => item.id === invoice.id) === index);

    linkedInvoices.forEach((invoice) => {
      matchedInvoiceIds.add(invoice.id);
    });

    const pendingLinkedInvoices = linkedInvoices.filter((invoice) => !hasCompletedRefundSync(invoice));
    const hasInvoiceEvidence = linkedInvoices.length > 0;
    const hasRefundSignal = isDefiniteRefundOrder(order) || hasInvoiceEvidence;

    if (!hasRefundSignal) {
      return [];
    }

    if (!hasInvoiceEvidence) {
      if (hasCompletedRefundSync(orderSyncRecord)) {
        return [];
      }

      const queueStatus = mapRefundQueueStatus(orderSyncRecord, {
        allowDirectOrderSync: true,
        hasSaleInvoiceSync,
        supportedCurrency,
        currencyMessage: buildUnsupportedERPCurrencyMessage(order.currency),
      });

      return [
        {
          id: `order:${order.id}`,
          merchantId: order.merchantId,
          orderRecordId: order.id,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          orderStatusSlug: order.statusSlug,
          orderStatusName: order.statusName,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          currency: order.currency,
          totalAmount: order.totalAmount != null ? Number(order.totalAmount) : null,
          customerName: order.customerName,
          customerMobile: order.customerMobile,
          placedAt: order.placedAt?.toISOString() ?? null,
          refundInvoiceRecordId: null,
          refundInvoiceId: null,
          refundInvoiceNumber: null,
          refundInvoiceStatus: null,
          refundInvoicePaymentStatus: null,
          refundInvoiceIssueDate: null,
          refundSource: 'order',
          refundSourceLabel: getRefundSourceLabel('order'),
          erpSyncedAt: orderSyncRecord?.erpSyncedAt?.toISOString() ?? null,
          erpSyncError: orderSyncRecord?.erpSyncError || null,
          erpSyncAttempts: orderSyncRecord?.erpSyncAttempts || 0,
          queueStatus: queueStatus.queueStatus,
          queueStatusLabel: queueStatus.queueStatusLabel,
          queueStatusMessage: queueStatus.queueStatusMessage,
          canSync: queueStatus.canSync,
        },
      ];
    }

    const shouldInheritOrderSyncState =
      Boolean(orderSyncRecord) &&
      linkedInvoices.length > 0 &&
      linkedInvoices.every((invoice) => !invoice.erpSyncedAt && !invoice.erpSyncError);

    let inheritedOrderSyncState = false;

    return pendingLinkedInvoices.flatMap((linkedInvoice) => {
      const effectiveSyncState: RefundSyncStateRecord =
        shouldInheritOrderSyncState && !inheritedOrderSyncState && orderSyncRecord
          ? {
              erpInvoiceId: orderSyncRecord.erpInvoiceId,
              erpSyncedAt: orderSyncRecord.erpSyncedAt,
              erpSyncError: orderSyncRecord.erpSyncError,
              erpSyncAttempts: Math.max(
                linkedInvoice.erpSyncAttempts || 0,
                orderSyncRecord.erpSyncAttempts || 0
              ),
            }
          : {
              erpInvoiceId: null,
              erpSyncedAt: linkedInvoice.erpSyncedAt,
              erpSyncError: linkedInvoice.erpSyncError,
              erpSyncAttempts: linkedInvoice.erpSyncAttempts || 0,
            };

      if (shouldInheritOrderSyncState && !inheritedOrderSyncState && orderSyncRecord) {
        inheritedOrderSyncState = true;
      }

      if (hasCompletedRefundSync(effectiveSyncState)) {
        return [];
      }

      const queueStatus = mapRefundQueueStatus(effectiveSyncState, {
        hasSaleInvoiceSync,
        supportedCurrency,
        currencyMessage: buildUnsupportedERPCurrencyMessage(order.currency),
      });
      const refundSource: PendingERPRefundRow['refundSource'] = 'order+invoice';

      return [
        {
          id: `order:${order.id}:invoice:${linkedInvoice.id}`,
          merchantId: order.merchantId,
          orderRecordId: order.id,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          orderStatusSlug: order.statusSlug,
          orderStatusName: order.statusName,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          currency: order.currency,
          totalAmount:
            linkedInvoice.totalAmount ?? (order.totalAmount != null ? Number(order.totalAmount) : null),
          customerName: linkedInvoice.customerName || order.customerName,
          customerMobile: linkedInvoice.customerMobile || order.customerMobile,
          placedAt: order.placedAt?.toISOString() ?? null,
          refundInvoiceRecordId: linkedInvoice.id,
          refundInvoiceId: linkedInvoice.invoiceId,
          refundInvoiceNumber: linkedInvoice.invoiceNumber,
          refundInvoiceStatus: linkedInvoice.status,
          refundInvoicePaymentStatus: linkedInvoice.paymentStatus,
          refundInvoiceIssueDate: linkedInvoice.issueDate?.toISOString() ?? null,
          refundSource,
          refundSourceLabel: getRefundSourceLabel(refundSource),
          erpSyncedAt: effectiveSyncState.erpSyncedAt?.toISOString() ?? null,
          erpSyncError: effectiveSyncState.erpSyncError || null,
          erpSyncAttempts: effectiveSyncState.erpSyncAttempts || 0,
          queueStatus: queueStatus.queueStatus,
          queueStatusLabel: queueStatus.queueStatusLabel,
          queueStatusMessage: queueStatus.queueStatusMessage,
          canSync: queueStatus.canSync,
        },
      ];
    });
  });

  const invoiceOnlyRows = refundInvoices.flatMap<PendingERPRefundRow>((invoice) => {
    if (matchedInvoiceIds.has(invoice.id)) {
      return [];
    }

    if (invoice.erpSyncedAt && !invoice.erpSyncError) {
      return [];
    }

    const rawOrder = getRawOrderRecord(invoice.rawOrder);
    const invoiceOrderId =
      invoice.orderId || getRawString(rawOrder?.id, rawOrder?.order_id, rawOrder?.orderId);
    const invoiceOrderNumber =
      invoice.orderNumber ||
      getRawString(
        rawOrder?.reference_id,
        rawOrder?.referenceId,
        rawOrder?.order_number,
        rawOrder?.orderNumber
      );
    const linkedOrders = buildIdentityKeys(invoice.merchantId, invoiceOrderId, invoiceOrderNumber)
      .flatMap((key) => ordersByKey.get(key) || [])
      .filter((order, index, array) => array.findIndex((item) => item.id === order.id) === index);
    const linkedOrder =
      linkedOrders.find((order) => hasSuccessfulERPSync(order)) || linkedOrders[0] || null;
    const hasSaleInvoiceSync = linkedOrder ? hasSuccessfulERPSync(linkedOrder) : false;
    const invoiceCurrency =
      invoice.currency ||
      getRawString(rawOrder?.currency, rawOrder?.currency_code, rawOrder?.amounts?.total?.currency);
    const supportedCurrency = isSupportedERPCurrency(invoiceCurrency);

    const queueStatus = mapRefundQueueStatus(invoice, {
      hasSaleInvoiceSync,
      supportedCurrency,
      currencyMessage: buildUnsupportedERPCurrencyMessage(invoiceCurrency),
      saleInvoiceMessage: linkedOrder
        ? 'هذا المرتجع مرتبط بطلب لم تُرسل فاتورة بيعه الأصلية إلى ERP بعد.'
        : 'تعذر ربط هذا المرتجع بطلب بيع مُرسل إلى ERP. أرسل الطلب الأصلي أولاً أو حدّث بيانات سلة.',
    });

    return [
      {
        id: `invoice:${invoice.id}`,
        merchantId: invoice.merchantId,
        orderRecordId: null,
        orderId: invoiceOrderId,
        orderNumber: invoiceOrderNumber,
        orderStatusSlug: getRawStatus(rawOrder?.status?.slug ?? rawOrder?.status),
        orderStatusName: getRawString(rawOrder?.status?.name, rawOrder?.status?.label),
        paymentStatus:
          getRawStatus(rawOrder?.payment_status ?? rawOrder?.paymentStatus ?? rawOrder?.payment?.status) ||
          invoice.paymentStatus,
        paymentMethod: getRawString(
          rawOrder?.payment_method,
          rawOrder?.paymentMethod,
          rawOrder?.payment?.method,
          rawOrder?.payment?.gateway
        ),
        currency:
          invoice.currency ||
          getRawString(rawOrder?.currency, rawOrder?.currency_code, rawOrder?.amounts?.total?.currency),
        totalAmount:
          invoice.totalAmount != null
            ? Number(invoice.totalAmount)
            : rawOrder?.total_amount != null
              ? Number(rawOrder.total_amount)
              : null,
        customerName:
          invoice.customerName ||
          getRawString(
            rawOrder?.customer?.full_name,
            rawOrder?.customer?.name,
            [rawOrder?.customer?.first_name, rawOrder?.customer?.last_name].filter(Boolean).join(' ')
          ),
        customerMobile:
          invoice.customerMobile ||
          getRawString(rawOrder?.customer?.mobile, rawOrder?.customer?.phone),
        placedAt: getRawDate(
          rawOrder?.date?.created,
          rawOrder?.created_at,
          rawOrder?.createdAt,
          invoice.issueDate
        ),
        refundInvoiceRecordId: invoice.id,
        refundInvoiceId: invoice.invoiceId,
        refundInvoiceNumber: invoice.invoiceNumber,
        refundInvoiceStatus: invoice.status,
        refundInvoicePaymentStatus: invoice.paymentStatus,
        refundInvoiceIssueDate: invoice.issueDate?.toISOString() ?? null,
        refundSource: 'invoice',
        refundSourceLabel: getRefundSourceLabel('invoice'),
        erpSyncedAt: invoice.erpSyncedAt?.toISOString() ?? null,
        erpSyncError: invoice.erpSyncError,
        erpSyncAttempts: invoice.erpSyncAttempts,
        queueStatus: queueStatus.queueStatus,
        queueStatusLabel: queueStatus.queueStatusLabel,
        queueStatusMessage: queueStatus.queueStatusMessage,
        canSync: queueStatus.canSync,
      },
    ];
  });

  return [...orderRows, ...invoiceOnlyRows].sort((left, right) => {
    const leftTimestamp = left.refundInvoiceIssueDate || left.placedAt || '';
    const rightTimestamp = right.refundInvoiceIssueDate || right.placedAt || '';
    return leftTimestamp.localeCompare(rightTimestamp);
  });
}

async function syncPendingOrder(input: {
  id?: string;
  orderId?: string;
  orderNumber?: string;
}): Promise<Extract<SyncInvoicesAndRefundInvoicesResult, { queueType: 'order' }>> {
  if (!input.id && !input.orderId && !input.orderNumber) {
    throw new InvoicesAndRefundInvoicesError('يجب إرسال معرف الطلب أو رقمه.', 400);
  }

  const order = await prisma.sallaOrder.findFirst({
    where: input.id
      ? { id: input.id }
      : input.orderId
        ? { orderId: input.orderId }
        : input.orderNumber
          ? { orderNumber: input.orderNumber }
          : undefined,
  });

  if (!order) {
    throw new InvoicesAndRefundInvoicesError('لم يتم العثور على الطلب داخل قاعدة البيانات.', 404);
  }

  if (!isSupportedERPCurrency(order.currency)) {
    throw new InvoicesAndRefundInvoicesError(
      buildUnsupportedERPCurrencyMessage(order.currency),
      400
    );
  }

  const result = await syncOrderToERP(forceSaleOrder(order), false);

  if (!result.success) {
    await prisma.sallaOrder.update({
      where: { id: order.id },
      data: {
        erpSyncError: result.error || result.message || 'Unknown error',
        erpSyncedAt: isNegativeERPInvoiceId(order.erpInvoiceId) ? null : undefined,
        erpSyncAttempts: {
          increment: 1,
        },
      },
    });

    throw new InvoicesAndRefundInvoicesError(
      result.error || result.message || 'فشل في إرسال الطلب إلى ERP',
      502
    );
  }

  const erpInvoiceId = String(result.erpInvoiceId || '').trim();
  if (!erpInvoiceId) {
    throw new InvoicesAndRefundInvoicesError(
      'نجحت العملية في ERP لكن لم يتم إرجاع رقم فاتورة صالح.',
      502
    );
  }

  await prisma.sallaOrder.update({
    where: { id: order.id },
    data: {
      erpSyncedAt: new Date(),
      erpInvoiceId,
      erpSyncError: null,
      erpSyncAttempts: {
        increment: 1,
      },
    },
  });

  return {
    queueType: 'order',
    alreadyRecorded: false,
    erpInvoiceId,
    message: result.message || 'تم إرسال الطلب إلى ERP بنجاح.',
    orderId: order.orderId,
    orderNumber: order.orderNumber,
  };
}

async function resolveRefundOrder(input: {
  orderRecordId?: string;
  orderId?: string;
  orderNumber?: string;
  invoiceRecordId?: string;
}): Promise<{ order: SallaOrder; invoice: SallaInvoice | null }> {
  const invoice = input.invoiceRecordId
    ? await prisma.sallaInvoice.findUnique({
        where: { id: input.invoiceRecordId },
      })
    : null;

  if (input.invoiceRecordId && !invoice) {
    throw new InvoicesAndRefundInvoicesError('لم يتم العثور على فاتورة المرتجع داخل قاعدة البيانات.', 404);
  }

  let order =
    input.orderRecordId
      ? await prisma.sallaOrder.findUnique({
          where: { id: input.orderRecordId },
        })
      : null;

  if (!order && (input.orderId || input.orderNumber)) {
    order = await prisma.sallaOrder.findFirst({
      where: {
        OR: [
          input.orderId ? { orderId: input.orderId } : undefined,
          input.orderNumber ? { orderNumber: input.orderNumber } : undefined,
        ].filter(Boolean) as Prisma.SallaOrderWhereInput[],
      },
    });
  }

  if (!order && invoice && (invoice.orderId || invoice.orderNumber)) {
    order = await prisma.sallaOrder.findFirst({
      where: {
        OR: [
          invoice.orderId
            ? {
                merchantId: invoice.merchantId,
                orderId: invoice.orderId,
              }
            : undefined,
          invoice.orderNumber
            ? {
                merchantId: invoice.merchantId,
                orderNumber: invoice.orderNumber,
              }
            : undefined,
        ].filter(Boolean) as Prisma.SallaOrderWhereInput[],
      },
    });
  }

  if (!order && invoice) {
    const rawOrder = getRawOrderRecord(invoice.rawOrder);

    if (rawOrder) {
      const rawOrderId = getRawString(rawOrder.id, rawOrder.order_id, rawOrder.orderId);
      const rawOrderNumber = getRawString(
        rawOrder.reference_id,
        rawOrder.referenceId,
        rawOrder.order_number,
        rawOrder.orderNumber
      );

      await upsertSallaOrderFromPayload({
        order: {
          ...rawOrder,
          merchant_id: rawOrder.merchant_id ?? invoice.merchantId,
        },
        merchant: invoice.merchantId,
      });

      order = await prisma.sallaOrder.findFirst({
        where: {
          OR: [
            invoice.orderId
              ? {
                  merchantId: invoice.merchantId,
                  orderId: invoice.orderId,
                }
              : undefined,
            invoice.orderNumber
              ? {
                  merchantId: invoice.merchantId,
                  orderNumber: invoice.orderNumber,
                }
              : undefined,
            rawOrderId
              ? {
                  merchantId: invoice.merchantId,
                  orderId: rawOrderId,
                }
              : undefined,
            rawOrderNumber
              ? {
                  merchantId: invoice.merchantId,
                  orderNumber: rawOrderNumber,
                }
              : undefined,
          ].filter(Boolean) as Prisma.SallaOrderWhereInput[],
        },
      });
    }
  }

  if (!order) {
    throw new InvoicesAndRefundInvoicesError(
      'تعذر تحديد طلب المرتجع المرتبط بهذه الفاتورة. حدّث بيانات سلة أولاً.',
      404
    );
  }

  return { order, invoice };
}

async function syncPendingRefund(input: {
  orderRecordId?: string;
  orderId?: string;
  orderNumber?: string;
  invoiceRecordId?: string;
}): Promise<Extract<SyncInvoicesAndRefundInvoicesResult, { queueType: 'refund' }>> {
  const { order, invoice } = await resolveRefundOrder(input);
  const orderSyncRecord = await getERPRefundOrderSyncRecord(order.id);

  if (!isSupportedERPCurrency(order.currency)) {
    throw new InvoicesAndRefundInvoicesError(
      buildUnsupportedERPCurrencyMessage(order.currency),
      400
    );
  }

  if (invoice?.erpSyncedAt) {
    return {
      queueType: 'refund',
      alreadyRecorded: true,
      erpInvoiceId: '',
      message: 'تم إرسال فاتورة المرتجع هذه إلى ERP مسبقاً.',
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
    };
  }

  if (
    orderSyncRecord?.erpSyncedAt &&
    !orderSyncRecord.erpSyncError &&
    (!invoice || (!invoice.erpSyncedAt && !invoice.erpSyncError))
  ) {
    return {
      queueType: 'refund',
      alreadyRecorded: true,
      erpInvoiceId: orderSyncRecord.erpInvoiceId || '',
      message: invoice
        ? 'تم إرسال هذا المرتجع إلى ERP مسبقاً من بيانات الطلب قبل وصول فاتورة المرتجع من سلة.'
        : 'تم إرسال هذا المرتجع إلى ERP مسبقاً من بيانات الطلب.',
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      invoiceId: invoice?.invoiceId ?? null,
      invoiceNumber: invoice?.invoiceNumber ?? null,
    };
  }

  if (!hasSuccessfulERPSync(order)) {
    throw new InvoicesAndRefundInvoicesError(
      'يجب إرسال فاتورة البيع الأصلية لهذا الطلب إلى ERP أولاً قبل إرسال المرتجع.',
      409
    );
  }

  const payload = await transformOrderToERPInvoice(forceRefundOrder(order));
  const result = await postInvoiceToERP(payload);

  if (!result.success) {
    if (invoice) {
      await prisma.sallaInvoice.update({
        where: { id: invoice.id },
        data: {
          erpSyncError: result.error || result.message || 'Unknown error',
          erpSyncAttempts: {
            increment: 1,
          },
        },
      });

      await deleteERPRefundOrderSyncRecord(order.id);
    } else {
      await upsertERPRefundOrderSyncRecord({
        order,
        erpInvoiceId: null,
        erpSyncedAt: null,
        erpSyncError: result.error || result.message || 'Unknown error',
      });
    }

    throw new InvoicesAndRefundInvoicesError(
      result.error || result.message || 'فشل في إرسال المرتجع إلى ERP',
      502
    );
  }

  const erpInvoiceId = String(result.erpInvoiceId || '').trim();
  if (!erpInvoiceId) {
    throw new InvoicesAndRefundInvoicesError(
      'نجحت العملية في ERP لكن لم يتم إرجاع رقم فاتورة مرتجع صالح.',
      502
    );
  }

  const syncedAt = new Date();

  if (invoice) {
    await prisma.sallaInvoice.update({
      where: { id: invoice.id },
      data: {
        erpSyncedAt: syncedAt,
        erpSyncError: null,
        erpSyncAttempts: {
          increment: 1,
        },
      },
    });

    await deleteERPRefundOrderSyncRecord(order.id);
  } else {
    await upsertERPRefundOrderSyncRecord({
      order,
      erpInvoiceId,
      erpSyncedAt: syncedAt,
      erpSyncError: null,
    });
  }

  return {
    queueType: 'refund',
    alreadyRecorded: false,
    erpInvoiceId,
    message: result.message || 'تم إرسال المرتجع إلى ERP بنجاح.',
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    invoiceId: invoice?.invoiceId ?? null,
    invoiceNumber: invoice?.invoiceNumber ?? null,
  };
}

export async function refreshSallaInvoicesAndOrders(
  dateRange: DateRangeInput = {}
): Promise<SallaRefreshSummary> {
  const [orderStats, invoiceStats] = await Promise.all([
    syncSallaOrders({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    }),
    syncSallaInvoices({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    }),
  ]);

  return {
    ordersMerchantsProcessed: orderStats.length,
    ordersFetched: orderStats.reduce((total, stat) => total + stat.ordersFetched, 0),
    ordersStored: orderStats.reduce((total, stat) => total + stat.ordersStored, 0),
    orderErrors: orderStats.reduce((total, stat) => total + stat.errors.length, 0),
    invoicesMerchantsProcessed: invoiceStats.length,
    invoicesFetched: invoiceStats.reduce((total, stat) => total + stat.invoicesFetched, 0),
    invoicesStored: invoiceStats.reduce((total, stat) => total + stat.invoicesStored, 0),
    invoiceErrors: invoiceStats.reduce((total, stat) => total + stat.errors.length, 0),
  };
}

export async function listInvoicesAndRefundInvoicesData(
  dateRange: DateRangeInput = {}
): Promise<InvoicesAndRefundInvoicesData> {
  const [orders, refunds] = await Promise.all([
    listPendingERPOrders(dateRange),
    listPendingERPRefunds(dateRange),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    orders,
    refunds,
  };
}

export async function syncInvoicesAndRefundInvoicesItem(
  input:
    | {
        queueType: 'order';
        id?: string;
        orderId?: string;
        orderNumber?: string;
      }
    | {
        queueType: 'refund';
        orderRecordId?: string;
        orderId?: string;
        orderNumber?: string;
        invoiceRecordId?: string;
      }
): Promise<SyncInvoicesAndRefundInvoicesResult> {
  if (input.queueType === 'order') {
    return syncPendingOrder(input);
  }

  return syncPendingRefund(input);
}
