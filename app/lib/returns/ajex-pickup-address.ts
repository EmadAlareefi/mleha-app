import type { SallaOrder } from '@/app/lib/salla-api';
import { buildConsigneeAddressFromOrder } from '@/app/lib/manual-smsa/address';
import { extractShipToLocation } from '@/app/lib/local-shipping/ship-to-location';

/** Reverse pickups use the outbound recipient, never a return's warehouse ship_to. */
export function buildAjexPickupAddress(order: SallaOrder) {
  const outboundOnly = (shipments: any) => Array.isArray(shipments)
    ? shipments.filter((shipment) => !/return|refund|مرتجع/i.test(String(shipment?.type ?? '')))
    : [];
  const location = extractShipToLocation({
    ...order,
    shipments: outboundOnly(order.shipments),
    shipping: { ...order.shipping, shipments: outboundOnly((order.shipping as any)?.shipments) },
  });
  const legacy = buildConsigneeAddressFromOrder(order);
  const legacySource = (order as any).shipping_address ?? order.shipping?.pickup_address;
  const shortCode = [legacySource?.short_address, legacySource?.shortAddress, legacy.ShortCode]
    .find((value) => typeof value === 'string' && value.trim());
  const street = [location?.buildingNumber, location?.street].filter(Boolean).join(' ');
  return {
    ...legacy,
    ShortCode: location?.shortAddress || shortCode?.trim() || undefined,
    AddressLine1: street || legacy.AddressLine1,
    AddressLine2: location?.addressNote || location?.district || legacy.AddressLine2,
    City: location?.city || legacy.City,
    District: location?.district || legacy.District,
    PostalCode: location?.postalCode || legacy.PostalCode,
    Coordinates: location?.latitude != null && location.longitude != null
      ? `${location.latitude},${location.longitude}` : legacy.Coordinates,
  };
}
