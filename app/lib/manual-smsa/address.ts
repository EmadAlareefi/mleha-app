import type { ShipmentAddress } from '@/app/lib/smsa-api';
import type { SallaOrder } from '@/app/lib/salla-api';

const ensureAddressLine = (value: unknown, fallbackLabel: string): string => {
  const fallback = `${fallbackLabel} address`.trim();
  if (typeof value === 'string' && value.trim().length >= 5) {
    return value.trim().slice(0, 180);
  }
  return fallback.length >= 5 ? fallback.slice(0, 180) : 'Shipping address';
};

const formatCoordinates = (address: Record<string, any>): string | undefined => {
  if (!address) return undefined;

  if (typeof address.coordinates === 'string' && address.coordinates.trim()) {
    return address.coordinates.trim();
  }

  const lat = address.latitude ?? address.lat;
  const lng = address.longitude ?? address.lng ?? address.long;

  if (lat && lng) {
    return `${lat},${lng}`;
  }

  return undefined;
};

export const buildConsigneeAddressFromOrder = (order: SallaOrder): ShipmentAddress => {
  const shippingAddress = (order as any).shipping_address ?? {};
  const pickupAddress = order.shipping?.pickup_address ?? {};

  const addressSource =
    Object.keys(shippingAddress).length > 0 ? shippingAddress : pickupAddress;

  const rawCity =
    addressSource.city ??
    addressSource.city_en ??
    addressSource.city_ar ??
    addressSource.region ??
    order.customer?.city ??
    'Riyadh';

  return {
    ContactName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim() ||
      order.customer?.name ||
      order.customer?.full_name ||
      'Salla Customer',
    ContactPhoneNumber: String(
      addressSource.phone ??
        addressSource.mobile ??
        (order.customer?.mobile || '0000000000'),
    ).trim(),
    ContactPhoneNumber2: addressSource.alternate_phone ?? addressSource.phone2 ?? undefined,
    AddressLine1: ensureAddressLine(
      addressSource.address ??
        addressSource.street_address ??
        addressSource.address_line1 ??
        addressSource.address_line_1 ??
        addressSource.street ??
        addressSource.description,
      rawCity,
    ),
    AddressLine2:
      addressSource.address_line2 ??
      addressSource.district ??
      addressSource.neighborhood ??
      addressSource.area ??
      undefined,
    City: rawCity || 'Riyadh',
    Country: addressSource.country ?? addressSource.country_code ?? 'SA',
    District: addressSource.district ?? addressSource.area ?? undefined,
    PostalCode: addressSource.postal_code ?? addressSource.zip_code ?? undefined,
    ShortCode: addressSource.shortcode ?? addressSource.short_code ?? undefined,
    Coordinates: formatCoordinates(addressSource),
  } as ShipmentAddress;
};

const resolveEnv = (key: string, fallback?: string): string | undefined => {
  const value = process.env[key];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return fallback;
};

export const buildMerchantShipperAddress = (
  overrides?: Partial<ShipmentAddress> | null,
): ShipmentAddress => {
  const contactName =
    overrides?.ContactName ||
    resolveEnv('SMSA_MERCHANT_NAME') ||
    resolveEnv('NEXT_PUBLIC_MERCHANT_NAME') ||
    'Warehouse';
  const contactPhone =
    overrides?.ContactPhoneNumber ||
    resolveEnv('SMSA_MERCHANT_PHONE') ||
    resolveEnv('NEXT_PUBLIC_MERCHANT_PHONE') ||
    '0500000000';
  const city =
    overrides?.City ||
    resolveEnv('SMSA_MERCHANT_CITY') ||
    resolveEnv('NEXT_PUBLIC_MERCHANT_CITY') ||
    'Riyadh';
  const addressLine1 =
    overrides?.AddressLine1 ||
    resolveEnv('SMSA_MERCHANT_ADDRESS') ||
    resolveEnv('NEXT_PUBLIC_MERCHANT_ADDRESS') ||
    `${city} warehouse`;

  return {
    ContactName: contactName,
    ContactPhoneNumber: contactPhone,
    AddressLine1: ensureAddressLine(addressLine1, city),
    AddressLine2: overrides?.AddressLine2 || city,
    City: city,
    Country:
      overrides?.Country ||
      resolveEnv('SMSA_MERCHANT_COUNTRY') ||
      'SA',
    District: overrides?.District || resolveEnv('SMSA_MERCHANT_DISTRICT'),
    PostalCode: overrides?.PostalCode || resolveEnv('SMSA_MERCHANT_POSTAL_CODE'),
    Coordinates: overrides?.Coordinates || resolveEnv('SMSA_MERCHANT_COORDINATES'),
    ShortCode: overrides?.ShortCode || resolveEnv('SMSA_MERCHANT_SHORT_CODE'),
  };
};
