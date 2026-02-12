import type { LocalShipment, Prisma } from '@prisma/client';

export interface LocalShipmentMeta {
  collectionAmount?: number;
  paymentMethod?: string | null;
  labelPrinted?: boolean;
  labelPrintedAt?: string | null;
  printCount?: number;
  printJobId?: string | null;
  labelPrintedBy?: string | null;
  labelPrintedByName?: string | null;
}

export interface NormalizedOrderItems {
  items: any[];
  meta: LocalShipmentMeta;
}

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const sanitizeMeta = (meta: LocalShipmentMeta): Prisma.JsonObject => {
  const payload: Prisma.JsonObject = {};

  if (typeof meta.collectionAmount === 'number' && Number.isFinite(meta.collectionAmount)) {
    payload.collectionAmount = meta.collectionAmount;
  }
  if (typeof meta.paymentMethod === 'string') {
    payload.paymentMethod = meta.paymentMethod;
  }
  if (typeof meta.labelPrinted === 'boolean') {
    payload.labelPrinted = meta.labelPrinted;
  }
  if (typeof meta.labelPrintedAt === 'string') {
    payload.labelPrintedAt = meta.labelPrintedAt;
  }
  if (typeof meta.printCount === 'number' && Number.isFinite(meta.printCount)) {
    payload.printCount = meta.printCount;
  }
  if (typeof meta.printJobId === 'string') {
    payload.printJobId = meta.printJobId;
  }
  if (typeof meta.labelPrintedBy === 'string') {
    payload.labelPrintedBy = meta.labelPrintedBy;
  }
  if (typeof meta.labelPrintedByName === 'string') {
    payload.labelPrintedByName = meta.labelPrintedByName;
  }

  return payload;
};

export const normalizeOrderItems = (raw: any): NormalizedOrderItems => {
  if (Array.isArray(raw)) {
    return { items: raw, meta: {} };
  }

  if (raw && typeof raw === 'object') {
    const maybeItems = Array.isArray(raw.items) ? raw.items : [];
    const meta = raw.meta || {};
    const collectionAmountValue = toNumber(meta.collectionAmount);
    const printCountValue = toNumber(meta.printCount);

    return {
      items: maybeItems,
      meta: {
        collectionAmount: collectionAmountValue,
        paymentMethod: typeof meta.paymentMethod === 'string' ? meta.paymentMethod : undefined,
        labelPrinted: typeof meta.labelPrinted === 'boolean' ? meta.labelPrinted : undefined,
        labelPrintedAt: typeof meta.labelPrintedAt === 'string' ? meta.labelPrintedAt : undefined,
        printCount: typeof printCountValue === 'number' ? printCountValue : undefined,
        printJobId: typeof meta.printJobId === 'string' ? meta.printJobId : undefined,
        labelPrintedBy: typeof meta.labelPrintedBy === 'string' ? meta.labelPrintedBy : undefined,
        labelPrintedByName:
          typeof meta.labelPrintedByName === 'string' ? meta.labelPrintedByName : undefined,
      },
    };
  }

  return { items: [], meta: {} };
};

const safeIsoString = (value?: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

export const getLocalShipmentLabelUrl = (shipmentId: string) =>
  `/api/local-shipping/label?shipmentId=${encodeURIComponent(shipmentId)}`;

export const serializeLocalShipment = (
  shipment: LocalShipment,
  fallback?: { collectionAmount?: number; paymentMethod?: string | null },
) => {
  const normalized = normalizeOrderItems(shipment.orderItems);
  const meta = normalized.meta;

  const collectionAmount =
    (typeof meta.collectionAmount === 'number' && Number.isFinite(meta.collectionAmount)
      ? meta.collectionAmount
      : undefined) ??
    fallback?.collectionAmount ??
    0;

  const paymentMethod = meta.paymentMethod ?? fallback?.paymentMethod ?? null;
  const labelPrinted = Boolean(meta.labelPrinted);
  const labelPrintedAt = safeIsoString(meta.labelPrintedAt);
  const printCount =
    typeof meta.printCount === 'number' && Number.isFinite(meta.printCount) ? meta.printCount : 0;

  return {
    id: shipment.id,
    trackingNumber: shipment.trackingNumber,
    orderNumber: shipment.orderNumber,
    customerName: shipment.customerName,
    customerPhone: shipment.customerPhone,
    shippingAddress: shipment.shippingAddress,
    shippingCity: shipment.shippingCity,
    shippingPostcode: shipment.shippingPostcode,
    orderTotal: Number(shipment.orderTotal),
    itemsCount: shipment.itemsCount,
    orderItems: normalized.items,
    createdAt: shipment.createdAt,
    collectionAmount,
    paymentMethod,
    labelPrinted,
    labelPrintedAt,
    printCount,
    labelUrl: getLocalShipmentLabelUrl(shipment.id),
    labelPrintedBy: meta.labelPrintedBy ?? null,
    labelPrintedByName: meta.labelPrintedByName ?? null,
    printJobId: meta.printJobId ?? null,
  };
};

export const buildOrderItemsPayload = (
  items: unknown[],
  meta: LocalShipmentMeta = {},
): Prisma.JsonObject => ({
  items: items as Prisma.JsonArray,
  meta: sanitizeMeta(meta),
});
