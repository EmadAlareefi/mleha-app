import { resolveAjexSaudiLocation } from '@/lib/ajex/locations';
import { normalizePhoneWithDialCode } from '@/app/lib/phone';
import type { AjexAddress, AjexCreateOrderRequest } from '@/app/lib/ajex-api';

/**
 * Builds the AJEX order that sends a customer's return from their address back
 * to the warehouse. Pure so the address mapping can be tested without AJEX or
 * Salla.
 */

type AnyRecord = Record<string, any>;

export const DEFAULT_AJEX_RETURN_PRODUCT_CODE = 'AJEX RPU';
const DEFAULT_ITEM_WEIGHT_KG = 0.5;
const REFERENCE_MAX_LENGTH = 40;

export interface AjexReturnItemInput {
  productName: string;
  productSku?: string;
  variantName?: string;
  quantity: number;
  price: number;
}

export interface AjexWarehouseAddress {
  name: string;
  phone: string;
  city: string;
  district?: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode?: string;
  shortAddress?: string;
  latitude?: number;
  longitude?: number;
  email?: string;
}

export interface BuildAjexReturnOrderInput {
  order: AnyRecord;
  items: AjexReturnItemInput[];
  warehouse: AjexWarehouseAddress;
  referenceNumber: string;
  currency: string;
  productCode?: string;
  itemWeightKg?: number;
}

export type BuildAjexReturnOrderResult =
  | { ok: true; request: Omit<AjexCreateOrderRequest, 'customerAccount'> }
  | { ok: false; error: string };

const text = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value && typeof value === 'object') {
    const record = value as AnyRecord;
    return text(record.name) ?? text(record.name_en) ?? text(record.name_ar) ?? text(record.label);
  }
  return undefined;
};

const toNumber = (value: unknown): number | undefined => {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined;
};

const record = (value: unknown): AnyRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

/** `RET-<order>-<suffix>`, unique per attempt so a re-issue is not rejected as a duplicate. */
export function buildAjexReturnReference(orderNumber: string, now = Date.now()): string {
  const suffix = now.toString(36).toUpperCase();
  const order = orderNumber.replace(/[^A-Za-z0-9]/g, '');
  const maxOrderLength = REFERENCE_MAX_LENGTH - 'RET--'.length - suffix.length;
  return `RET-${order.slice(-maxOrderLength)}-${suffix}`;
}

function parseCoordinates(source: AnyRecord): { latitude?: number; longitude?: number } {
  const geo = record(source.geo_coordinates ?? source.geoCoordinates ?? source.coordinates);
  const latitude = toNumber(geo.lat ?? geo.latitude ?? source.latitude ?? source.lat);
  const longitude = toNumber(geo.lng ?? geo.longitude ?? source.longitude ?? source.lng);
  if (latitude === undefined || longitude === undefined || (latitude === 0 && longitude === 0)) {
    return {};
  }
  return { latitude, longitude };
}

/**
 * Maps a city/district pair to AJEX's master list. A full match is sent as
 * `CUSTOMER_MAPPINGS` with codes; anything short of that goes as `FREE_TEXT`
 * with the original wording, so AJEX can still route it.
 */
export function mapSaudiAddressFields(
  city: string | undefined,
  district: string | undefined,
  region: string | undefined,
): Pick<AjexAddress, 'city' | 'cityCode' | 'region' | 'district' | 'districtCode' | 'addressType'> {
  const resolved = resolveAjexSaudiLocation(city, district);

  if (resolved?.districtCode) {
    return {
      city: resolved.city,
      cityCode: resolved.cityCode,
      region: resolved.region,
      district: resolved.district!,
      districtCode: resolved.districtCode,
      addressType: 'CUSTOMER_MAPPINGS',
    };
  }

  const cityName = resolved?.city ?? city ?? '';
  return {
    city: cityName,
    ...(resolved ? { cityCode: resolved.cityCode } : {}),
    region: resolved?.region ?? region ?? cityName,
    district: district || cityName,
    addressType: 'FREE_TEXT',
  };
}

/** The customer's delivery address on the Salla order becomes the pickup address. */
export function buildCustomerPickupAddress(order: AnyRecord): AjexAddress | { error: string } {
  const shipping = record(order.shipping);
  const shipTo = record(
    shipping.ship_to ?? shipping.shipTo ?? shipping.address ?? order.shipping_address ?? order.ship_to,
  );
  const receiver = record(shipping.receiver);
  const customer = record(order.customer);

  const name =
    text(receiver.name) ||
    text(shipTo.name) ||
    `${text(customer.first_name) ?? ''} ${text(customer.last_name) ?? ''}`.trim() ||
    text(customer.name) ||
    'Customer';

  const dialCode =
    receiver.phone_code ??
    receiver.mobile_code ??
    shipTo.mobile_code ??
    shipTo.phone_code ??
    customer.mobile_code ??
    customer.phone_code;
  const phone = normalizePhoneWithDialCode(
    text(receiver.phone) ?? text(receiver.mobile) ?? text(shipTo.phone) ?? text(customer.mobile) ?? text(customer.phone),
    dialCode,
  );
  if (!phone) {
    return { error: 'رقم جوال العميل غير متوفر في الطلب' };
  }

  const city = text(shipTo.city) ?? text(customer.city);
  if (!city) {
    return { error: 'مدينة العميل غير متوفرة في الطلب' };
  }
  const district = text(shipTo.district) ?? text(shipTo.block) ?? text(shipTo.neighborhood);
  const region = text(shipTo.region) ?? text(shipTo.state);

  const shortAddress = text(shipTo.short_address) ?? text(shipTo.shortAddress);
  const streetParts = [
    text(shipTo.building_number),
    text(shipTo.street_number) ?? text(shipTo.street),
    text(shipTo.block),
  ].filter(Boolean);
  const addressLine1 =
    text(shipTo.address_line) ??
    text(shipTo.shipping_address) ??
    text(shipTo.address) ??
    text(shipTo.street_address) ??
    (streetParts.length > 0 ? streetParts.join(', ') : undefined) ??
    shortAddress ??
    [district, city].filter(Boolean).join(', ');

  const email = text(receiver.email) ?? text(customer.email);

  return {
    name: name.slice(0, 200),
    phone,
    country: 'Saudi Arabia',
    countryCode: 'SA',
    ...mapSaudiAddressFields(city, district, region),
    postalCode: text(shipTo.postal_code) ?? text(shipTo.postalCode),
    addressLine1: addressLine1.slice(0, 512),
    ...(shortAddress ? { shortAddress } : {}),
    ...(email && email.includes('@') ? { email } : {}),
    ...parseCoordinates(shipTo),
  };
}

export function buildWarehouseDeliveryAddress(warehouse: AjexWarehouseAddress): AjexAddress {
  return {
    name: warehouse.name.slice(0, 200),
    phone: normalizePhoneWithDialCode(warehouse.phone) || warehouse.phone,
    country: 'Saudi Arabia',
    countryCode: 'SA',
    ...mapSaudiAddressFields(warehouse.city, warehouse.district, undefined),
    postalCode: warehouse.postalCode,
    addressLine1: warehouse.addressLine1.slice(0, 512),
    ...(warehouse.addressLine2 ? { addressLine2: warehouse.addressLine2.slice(0, 512) } : {}),
    ...(warehouse.shortAddress ? { shortAddress: warehouse.shortAddress } : {}),
    ...(warehouse.email ? { email: warehouse.email } : {}),
    ...(warehouse.latitude !== undefined && warehouse.longitude !== undefined
      ? { latitude: warehouse.latitude, longitude: warehouse.longitude }
      : {}),
  };
}

export function buildAjexReturnOrder(input: BuildAjexReturnOrderInput): BuildAjexReturnOrderResult {
  if (input.items.length === 0) {
    return { ok: false, error: 'لا توجد منتجات في شحنة الإرجاع' };
  }

  const pickupAddress = buildCustomerPickupAddress(input.order);
  if ('error' in pickupAddress) {
    return { ok: false, error: pickupAddress.error };
  }

  const itemWeight = input.itemWeightKg && input.itemWeightKg > 0 ? input.itemWeightKg : DEFAULT_ITEM_WEIGHT_KG;
  const totalQuantity = input.items.reduce((sum, item) => sum + item.quantity, 0);
  const declaredValue = round(input.items.reduce((sum, item) => sum + item.price * item.quantity, 0));

  return {
    ok: true,
    request: {
      referenceNumber: input.referenceNumber.slice(0, REFERENCE_MAX_LENGTH),
      productCode: input.productCode || DEFAULT_AJEX_RETURN_PRODUCT_CODE,
      contentType: 'NON_DOCUMENT',
      pickupMethod: 'COURIER_PICKUP',
      declaredValue,
      declaredValueCurrency: input.currency,
      // Returns are never collected on: the refund is settled by the store.
      cod: false,
      codAmount: 0,
      incoterms: 'DDP',
      insured: false,
      labelFormat: 'PDF',
      pickupAddress,
      deliveryAddress: buildWarehouseDeliveryAddress(input.warehouse),
      packages: [
        {
          sequence: 1,
          weight: round(Math.max(totalQuantity * itemWeight, 0.1), 3),
          weightUnit: 'KG',
        },
      ],
      items: input.items.map((item) => ({
        description: [item.productName, item.variantName].filter(Boolean).join(' - ').slice(0, 250) || 'Item',
        quantity: item.quantity,
        unitPrice: round(item.price),
        currency: input.currency,
        ...(item.productSku ? { sku: item.productSku } : {}),
        packageSequence: 1,
      })),
    },
  };
}

/**
 * The warehouse the return is delivered to. `AJEX_RETURN_WAREHOUSE_*` wins, with
 * the existing `NEXT_PUBLIC_MERCHANT_*` returns settings as a fallback. Read on
 * the server only — the request body is public and must not steer where
 * returned goods are delivered.
 */
export function getAjexReturnWarehouse(): AjexWarehouseAddress | null {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = process.env[key]?.trim();
      if (value) return value;
    }
    return undefined;
  };

  const name = pick('AJEX_RETURN_WAREHOUSE_NAME', 'NEXT_PUBLIC_MERCHANT_NAME');
  const phone = pick('AJEX_RETURN_WAREHOUSE_PHONE', 'NEXT_PUBLIC_MERCHANT_PHONE');
  const city = pick('AJEX_RETURN_WAREHOUSE_CITY', 'NEXT_PUBLIC_MERCHANT_CITY');
  const addressLine1 = pick('AJEX_RETURN_WAREHOUSE_ADDRESS', 'NEXT_PUBLIC_MERCHANT_ADDRESS');
  if (!name || !phone || !city || !addressLine1) return null;

  const [lat, lng] = (pick('AJEX_RETURN_WAREHOUSE_COORDINATES') || '')
    .split(',')
    .map((part) => toNumber(part.trim()));

  return {
    name,
    phone,
    city,
    addressLine1,
    district: pick('AJEX_RETURN_WAREHOUSE_DISTRICT'),
    addressLine2: pick('AJEX_RETURN_WAREHOUSE_ADDRESS_LINE2'),
    postalCode: pick('AJEX_RETURN_WAREHOUSE_POSTAL_CODE'),
    shortAddress: pick('AJEX_RETURN_WAREHOUSE_SHORT_ADDRESS'),
    email: pick('AJEX_RETURN_WAREHOUSE_EMAIL'),
    ...(lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : {}),
  };
}
