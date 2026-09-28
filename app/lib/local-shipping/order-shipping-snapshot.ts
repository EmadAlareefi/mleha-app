import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { buildOrderItemsPayload, normalizeOrderItems } from './serializer';
import {
  extractShipToLocation,
  isUsableCoordinatePair,
  parseCoordinate,
  type ShipToLocation,
} from './ship-to-location';

type UnknownRecord = Record<string, any>;

const hasShippingSections = (order: UnknownRecord) =>
  Boolean(order.shipping) || (Array.isArray(order.shipments) && order.shipments.length > 0);

/**
 * The live Salla `/orders/{id}` response no longer includes `shipping` or
 * `shipments` for this app's token, so the customer's address and map pin are
 * missing. The order webhook payload stored in `SallaOrder.rawOrder` still has
 * them; merge those sections back in when the live order lacks them.
 */
export async function withStoredShippingSnapshot<T>(merchantId: string, order: T): Promise<T> {
  const record = order as unknown as UnknownRecord | null;
  if (!record || typeof record !== 'object' || hasShippingSections(record) || !record.id) {
    return order;
  }

  try {
    const stored = await prisma.sallaOrder.findUnique({
      where: { merchantId_orderId: { merchantId, orderId: String(record.id) } },
      select: { rawOrder: true },
    });
    const raw = stored?.rawOrder as UnknownRecord | null | undefined;
    if (!raw || typeof raw !== 'object') {
      return order;
    }
    return {
      ...record,
      shipping: record.shipping ?? raw.shipping ?? null,
      shipments: record.shipments ?? raw.shipments ?? null,
    } as T;
  } catch (error) {
    log.warn('Failed to load stored Salla shipping snapshot', {
      merchantId,
      orderId: record.id,
      error: error instanceof Error ? error.message : error,
    });
    return order;
  }
}

const locationKey = (merchantId: string, orderId: string) => `${merchantId}:${orderId}`;

/** Batch lookup of ship-to locations from stored webhook orders, keyed by `merchantId:orderId`. */
export async function loadStoredShipToLocations(
  refs: Array<{ merchantId: string; orderId: string }>,
): Promise<Map<string, ShipToLocation>> {
  const result = new Map<string, ShipToLocation>();
  const unique = Array.from(
    new Map(refs.filter((ref) => ref.merchantId && ref.orderId).map((ref) => [locationKey(ref.merchantId, ref.orderId), ref])).values(),
  );
  if (unique.length === 0) return result;

  const stored = await prisma.sallaOrder.findMany({
    where: { OR: unique.map((ref) => ({ merchantId: ref.merchantId, orderId: ref.orderId })) },
    select: { merchantId: true, orderId: true, rawOrder: true },
  });
  for (const row of stored) {
    const location = extractShipToLocation(row.rawOrder);
    if (location) {
      result.set(locationKey(row.merchantId, row.orderId), location);
    }
  }
  return result;
}

const hasStoredPin = (orderItems: unknown) => {
  const meta = normalizeOrderItems(orderItems).meta;
  return isUsableCoordinatePair(parseCoordinate(meta.shipToLatitude), parseCoordinate(meta.shipToLongitude));
};

const withLocationMeta = (orderItems: unknown, location: ShipToLocation) => {
  const normalized = normalizeOrderItems(orderItems);
  const meta = normalized.meta;
  return buildOrderItemsPayload(normalized.items, {
    ...meta,
    shipToLatitude: location.latitude ?? meta.shipToLatitude,
    shipToLongitude: location.longitude ?? meta.shipToLongitude,
    shipToBuildingNumber: meta.shipToBuildingNumber ?? location.buildingNumber,
    shipToStreet: meta.shipToStreet ?? location.street,
    shipToDistrict: meta.shipToDistrict ?? location.district,
    shipToCity: meta.shipToCity ?? location.city,
    shipToPostalCode: meta.shipToPostalCode ?? location.postalCode,
    shipToShortAddress: meta.shipToShortAddress ?? location.shortAddress,
    shipToAddressNote: meta.shipToAddressNote ?? location.addressNote,
  });
};

/**
 * Shipments created before coordinates were captured still need a map pin.
 * Returns replacement `orderItems` (keyed by shipment id) filled from the
 * stored Salla webhook order. Read-only; failures just yield no replacements.
 */
export async function fillMissingPins(
  shipments: Array<{ id: string; merchantId: string; orderId: string; orderItems: unknown }>,
): Promise<Map<string, ReturnType<typeof buildOrderItemsPayload>>> {
  const replacements = new Map<string, ReturnType<typeof buildOrderItemsPayload>>();
  const missing = shipments.filter(
    (shipment) => shipment.merchantId && shipment.orderId && !hasStoredPin(shipment.orderItems),
  );
  if (missing.length === 0) return replacements;

  try {
    const locations = await loadStoredShipToLocations(missing);
    for (const shipment of missing) {
      const location = locations.get(locationKey(shipment.merchantId, shipment.orderId));
      if (location) {
        replacements.set(shipment.id, withLocationMeta(shipment.orderItems, location));
      }
    }
  } catch (error) {
    log.warn('Failed to load stored ship-to locations', {
      error: error instanceof Error ? error.message : error,
    });
  }
  return replacements;
}
