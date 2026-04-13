import { Prisma, type ManualSmsaShipment } from '@prisma/client';
import type { ManualSmsaShipmentRecord, ManualSmsaShipmentItem } from './types';

const isManualShipmentItem = (candidate: unknown): candidate is ManualSmsaShipmentItem => {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.trim().length === 0) {
    return false;
  }
  if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity)) {
    return false;
  }
  return true;
};

const collectManualShipmentItems = (items: unknown[]): ManualSmsaShipmentItem[] => {
  const normalized: ManualSmsaShipmentItem[] = [];
  for (const item of items) {
    if (isManualShipmentItem(item)) {
      normalized.push(item);
    }
  }
  return normalized;
};

const decimalToNumber = (
  value: Prisma.Decimal | number | null | undefined,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  try {
    return (value as Prisma.Decimal).toNumber();
  } catch {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
};

export const parseManualShipmentItems = (
  value: Prisma.JsonValue | null,
): ManualSmsaShipmentItem[] => {
  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return collectManualShipmentItems(value);
  }

  if (Array.isArray((value as any).items)) {
    return collectManualShipmentItems((value as any).items);
  }

  return [];
};

export const serializeManualSmsaShipment = (
  shipment: ManualSmsaShipment,
): ManualSmsaShipmentRecord => {
  return {
    id: shipment.id,
    merchantId: shipment.merchantId,
    orderId: shipment.orderId,
    orderNumber: shipment.orderNumber,
    status: shipment.status,
    parcels: shipment.parcels,
    declaredValue: decimalToNumber(shipment.declaredValue),
    currency: shipment.currency,
    weight: decimalToNumber(shipment.weight),
    weightUnit: shipment.weightUnit,
    contentDescription: shipment.contentDescription || null,
    codAmount: decimalToNumber(shipment.codAmount),
    smsaAwbNumber: shipment.smsaAwbNumber,
    smsaTrackingNumber: shipment.smsaTrackingNumber,
    smsaLabelDataUrl: shipment.smsaLabelDataUrl,
    customerName: shipment.customerName,
    customerPhone: shipment.customerPhone,
    customerEmail: shipment.customerEmail,
    addressLine1: shipment.addressLine1,
    addressLine2: shipment.addressLine2,
    city: shipment.city,
    country: shipment.country,
    district: shipment.district,
    postalCode: shipment.postalCode,
    shortCode: shipment.shortCode,
    shipmentItems: parseManualShipmentItems(shipment.shipmentItems),
    createdAt: shipment.createdAt.toISOString(),
    updatedAt: shipment.updatedAt.toISOString(),
    cancelledAt: shipment.cancelledAt ? shipment.cancelledAt.toISOString() : null,
    deletedAt: shipment.deletedAt ? shipment.deletedAt.toISOString() : null,
    createdByName: shipment.createdByName,
  };
};
