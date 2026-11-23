import { prisma } from '@/lib/prisma';
import { getViolatingPromoOrderIds } from '@/app/lib/promo-limit-monitor';
import { getOrderCustomerPhones } from '@/app/lib/returns/customer-phone';
import { extractAppliedCouponCodes } from '@/app/lib/returns/exchange-order';
import { isInternationalOrder } from '@/lib/returns/order-country';
import { decideVerdicts, type OrderFacts, type Verdicts } from './eligibility';
import { getOrderManageSettings, isPilotAllowed, type OrderManageSettings } from './settings';

/**
 * Loads what the eligibility rules need about one order, from the local
 * mirror only (no Salla call), plus the trimmed view the customer sees.
 */

type AnyRecord = Record<string, any>;

export type PublicItem = {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  image: string | null;
  options: Array<{ name: string; value: string }>;
  /** Line total as the customer paid it. */
  total: number | null;
};

export type PublicChange = {
  id: string;
  kind: string;
  state: string;
  refundStatus: string;
  refundAmount: number | null;
  currency: string | null;
  createdAt: string;
};

/** Everything the /my-order page shows. No customer name, phone or address. */
export type PublicOrder = {
  orderNumber: string;
  statusName: string | null;
  placedAt: string | null;
  total: number | null;
  currency: string;
  paymentMethod: string | null;
  items: PublicItem[];
  changes: PublicChange[];
};

export type OrderContext = {
  orderId: string;
  rawOrder: AnyRecord;
  facts: OrderFacts;
  verdicts: Verdicts;
  settings: OrderManageSettings;
  view: PublicOrder;
};

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(typeof value === 'object' ? (value as AnyRecord).amount : value);
  return Number.isFinite(parsed) ? parsed : null;
};

const textOrNull = (value: unknown): string | null => {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

function optionLabel(option: AnyRecord): { name: string; value: string } | null {
  const name = textOrNull(option?.name);
  const raw = option?.value;
  const value =
    textOrNull(raw) ??
    textOrNull(raw?.name) ??
    (Array.isArray(raw) ? raw.map((entry) => textOrNull(entry?.name) ?? textOrNull(entry)).filter(Boolean).join('، ') || null : null);
  return name && value ? { name, value } : null;
}

/** Lines as the customer knows them, from the mirrored Salla payload. */
export function toPublicItems(rawOrder: AnyRecord, stored: Array<{ itemId: string | null; productId: string | null; sku: string | null; name: string | null; quantity: number | null }>): PublicItem[] {
  const rawItems: AnyRecord[] = Array.isArray(rawOrder?.items) ? rawOrder.items : [];
  if (rawItems.length === 0) {
    return stored.map((item, index) => ({
      id: item.itemId || `stored-${index}`,
      productId: item.productId,
      name: item.name || 'منتج',
      sku: item.sku,
      quantity: item.quantity ?? 1,
      image: null,
      options: [],
      total: null,
    }));
  }
  return rawItems.map((item, index) => ({
    id: textOrNull(item?.id) || `line-${index}`,
    productId: textOrNull(item?.product?.id) ?? textOrNull(item?.product_id),
    name: textOrNull(item?.name) ?? textOrNull(item?.product?.name) ?? 'منتج',
    sku: textOrNull(item?.sku) ?? textOrNull(item?.product?.sku),
    quantity: Number(item?.quantity) > 0 ? Number(item.quantity) : 1,
    image: textOrNull(item?.thumbnail) ?? textOrNull(item?.product?.thumbnail) ?? textOrNull(item?.product?.main_image) ?? null,
    options: (Array.isArray(item?.options) ? item.options : []).map(optionLabel).filter(Boolean) as Array<{ name: string; value: string }>,
    total: numberOrNull(item?.amounts?.total) ?? numberOrNull(item?.total),
  }));
}

/** Null when the order is not in the mirror. */
export async function loadOrderContext(merchantId: string, orderId: string): Promise<OrderContext | null> {
  const key = { merchantId, orderId };
  const [order, settings] = await Promise.all([
    prisma.sallaOrder.findUnique({
      where: { merchantId_orderId: key },
      select: {
        orderId: true,
        referenceId: true,
        orderNumber: true,
        statusSlug: true,
        statusName: true,
        statusCustomId: true,
        isPendingPayment: true,
        currency: true,
        totalAmount: true,
        discountAmount: true,
        paymentMethod: true,
        placedAt: true,
        erpSyncedAt: true,
        rawOrder: true,
        items: { select: { itemId: true, productId: true, sku: true, name: true, quantity: true } },
      },
    }),
    getOrderManageSettings(),
  ]);
  if (!order) return null;

  const [claim, shipment, task, escalation, doNotShip, exchangeOf, returnOn, changes, violators] = await Promise.all([
    prisma.orderPrepAssignment.findFirst({ where: key, select: { id: true } }),
    prisma.sallaShipment.findFirst({ where: key, select: { id: true } }),
    prisma.shippingTask.findFirst({ where: { ...key, state: { not: 'cancelled' } }, select: { id: true } }),
    prisma.orderPrepEscalation.findFirst({ where: { ...key, resolvedAt: null }, select: { id: true } }),
    prisma.orderDoNotShipFlag.findUnique({ where: { merchantId_orderId: key }, select: { id: true } }),
    prisma.returnRequest.findFirst({ where: { merchantId, exchangeOrderId: orderId }, select: { id: true } }),
    prisma.returnRequest.findFirst({ where: key, select: { id: true } }),
    prisma.customerOrderChange.findMany({
      where: key,
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, state: true, holdActive: true, refundStatus: true, refundAmount: true, currency: true, createdAt: true },
    }),
    // A failed lookup must not open the door: treat the order as blocked.
    getViolatingPromoOrderIds(merchantId).catch(() => null),
  ]);

  const rawOrder = (order.rawOrder && typeof order.rawOrder === 'object' ? order.rawOrder : {}) as AnyRecord;
  const facts: OrderFacts = {
    statusCustomId: order.statusCustomId,
    statusSlug: order.statusSlug,
    isPendingPayment: order.isPendingPayment === true,
    hasPrepClaim: Boolean(claim),
    hasShipment: Boolean(shipment),
    hasShippingTask: Boolean(task),
    hasOpenEscalation: Boolean(escalation),
    doNotShip: Boolean(doNotShip),
    promoViolator: violators ? violators.has(orderId) : true,
    isExchangeOrder: Boolean(exchangeOf),
    hasReturnRequest: Boolean(returnOn),
    changeInFlight: changes.some((change) => change.holdActive && change.state !== 'needs_staff'),
    needsStaff: changes.some((change) => change.state === 'needs_staff'),
    completedChanges: changes.filter((change) => change.state === 'completed').length,
    isInternational: isInternationalOrder(rawOrder),
    currency: order.currency,
    erpSynced: Boolean(order.erpSyncedAt),
    hasCoupon: extractAppliedCouponCodes(rawOrder).length > 0 || Number(order.discountAmount ?? 0) > 0,
    pilotAllowed: isPilotAllowed(settings, getOrderCustomerPhones(rawOrder)),
  };

  const view: PublicOrder = {
    orderNumber: order.referenceId || order.orderNumber || order.orderId,
    statusName: order.statusName,
    placedAt: order.placedAt ? order.placedAt.toISOString() : null,
    total: order.totalAmount === null ? null : Number(order.totalAmount),
    currency: order.currency || 'SAR',
    paymentMethod: order.paymentMethod,
    items: toPublicItems(rawOrder, order.items),
    changes: changes.map((change) => ({
      id: change.id,
      kind: change.kind,
      state: change.state,
      refundStatus: change.refundStatus,
      refundAmount: change.refundAmount === null ? null : Number(change.refundAmount),
      currency: change.currency,
      createdAt: change.createdAt.toISOString(),
    })),
  };

  return { orderId, rawOrder, facts, verdicts: decideVerdicts(facts, settings), settings, view };
}
