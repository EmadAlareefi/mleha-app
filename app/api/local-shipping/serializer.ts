import type { LocalShipment } from '@prisma/client';

interface NormalizedOrderItems {
  items: any[];
  collectionAmount?: number;
  paymentMethod?: string | null;
}

const normalizeOrderItems = (raw: any): NormalizedOrderItems => {
  if (Array.isArray(raw)) {
    return { items: raw };
  }

  if (raw && typeof raw === 'object') {
    const maybeItems = Array.isArray(raw.items) ? raw.items : [];
    const meta = raw.meta || {};
    const collectionAmountValue =
      typeof meta.collectionAmount === 'number'
        ? meta.collectionAmount
        : Number(meta.collectionAmount ?? 0);

    return {
      items: maybeItems,
      collectionAmount: Number.isFinite(collectionAmountValue) ? collectionAmountValue : undefined,
      paymentMethod: typeof meta.paymentMethod === 'string' ? meta.paymentMethod : undefined,
    };
  }

  return { items: [] };
};

export const serializeLocalShipment = (shipment: LocalShipment, fallback?: { collectionAmount?: number; paymentMethod?: string | null }) => {
  const normalized = normalizeOrderItems(shipment.orderItems);

  const collectionAmount =
    normalized.collectionAmount ?? fallback?.collectionAmount ?? 0;
  const paymentMethod = normalized.paymentMethod ?? fallback?.paymentMethod ?? null;

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
  };
};

export const buildOrderItemsPayload = (items: any[], meta: { collectionAmount: number; paymentMethod: string }) => ({
  items,
  meta,
});
