import { Prisma, OrderPrepAssignment } from '@prisma/client';
import { log } from '@/app/lib/logger';
import { updateSallaOrder, type SallaShipToUpdate } from '@/app/lib/salla-api';

/**
 * What is left of the first-generation prep service: the international postal
 * code fix (still used by the Salla sync) and the held-order sort order.
 */

/** preparing first, then waiting, then assigned; oldest first within each — as the prep page picks. */
export function sortByPrepPriority<T extends { status: string; assignedAt: Date | string }>(records: T[]): T[] {
  const rank = (status: string) => (status === 'preparing' ? 0 : status === 'waiting' ? 1 : 2);
  return [...records].sort(
    (a, b) => rank(a.status) - rank(b.status) || new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime()
  );
}

const DEFAULT_POSTAL_CODE = '000000';
const SAUDI_COUNTRY_CODES = new Set(['SA', 'SAU', 'KSA']);
const SAUDI_COUNTRY_NAMES = new Set([
  'SAUDIARABIA',
  'SAUDI',
  'SAUDI ARABIA',
  'السعودية',
]);

export async function ensureInternationalPostalCode(
  assignment: OrderPrepAssignment,
): Promise<Prisma.JsonValue | null> {
  if (!assignment.merchantId || !assignment.orderId) {
    return null;
  }

  const rawOrderData = assignment.orderData as Prisma.JsonValue;
  if (typeof rawOrderData !== 'object' || rawOrderData === null) {
    return null;
  }

  const orderData = rawOrderData as Record<string, any>;
  const shipping = toRecord(orderData.shipping);
  if (!shipping) {
    return null;
  }
  const shipTo = toRecord(shipping.ship_to ?? shipping.shipTo ?? shipping.receiver);
  if (!shipTo) {
    return null;
  }

  const fallbackAddress = toRecord(orderData.shipping_address);
  if (!isInternationalShipment(shipping, shipTo, fallbackAddress)) {
    return null;
  }

  const postalValue =
    getStringValue(shipTo.postal_code ?? shipTo.postalCode) ??
    getStringValue(fallbackAddress?.postal_code ?? fallbackAddress?.zip_code);

  if (!needsPostalPatch(postalValue)) {
    return null;
  }

  const normalizedPostal = normalizePostalCode(postalValue);
  const shipToPayload = buildShipToUpdatePayload({
    shipTo,
    fallbackAddress,
    postal: normalizedPostal,
  });

  if (!shipToPayload) {
    log.warn('Unable to build ship_to payload for postal patch', {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
    });
    return null;
  }

  const branchId = getNumericId(shipping.branch_id ?? shipping.branch?.id);
  const courierId = getNumericId(
    shipping.courier_id ?? shipping.courier?.id ?? shipping.courierId,
  );
  const payload = {
    delivery_method: getStringValue(shipping.delivery_method) ?? 'shipping',
    branch_id: branchId ?? undefined,
    courier_id: courierId ?? undefined,
    ship_to: shipToPayload,
  };

  const response = await updateSallaOrder(assignment.merchantId, assignment.orderId, payload);
  if (!response || response.success === false) {
    log.warn('Failed to update Salla order postal code', {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      message: response?.message,
    });
    return null;
  }

  log.info('Patched international shipping postal code', {
    assignmentId: assignment.id,
    orderId: assignment.orderId,
    postalCode: normalizedPostal,
  });

  return cloneOrderDataWithPostal(orderData, normalizedPostal);
}

function toRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, any>;
}

function getStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function getNumericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && value) {
    return getNumericId((value as Record<string, unknown>).id ?? (value as Record<string, unknown>).value);
  }
  return null;
}

function needsPostalPatch(postal: string | null): boolean {
  if (!postal) {
    return true;
  }
  const digits = postal.replace(/\D/g, '');
  return digits.length < 6;
}

function normalizePostalCode(postal: string | null): string {
  const digits = postal ? postal.replace(/\D/g, '') : '';
  if (!digits) {
    return DEFAULT_POSTAL_CODE;
  }
  if (digits.length >= 6) {
    return digits;
  }
  return digits.padEnd(6, '0');
}

function buildShipToUpdatePayload(options: {
  shipTo: Record<string, any>;
  fallbackAddress: Record<string, any> | null;
  postal: string;
}): SallaShipToUpdate | null {
  const { shipTo, fallbackAddress, postal } = options;
  const countryId = getNumericId(shipTo.country ?? shipTo.country_id);
  const cityId = getNumericId(shipTo.city ?? shipTo.city_id);
  const districtId = getNumericId(shipTo.district ?? shipTo.district_id);
  const block =
    getStringValue(shipTo.block) ??
    getStringValue(shipTo.district_name) ??
    getStringValue(fallbackAddress?.district);
  const streetNumber =
    getStringValue(shipTo.street_number ?? shipTo.street) ??
    getStringValue(fallbackAddress?.street_number) ??
    '0';
  const addressLine =
    getStringValue(shipTo.address_line ?? shipTo.address) ??
    getStringValue(fallbackAddress?.street_address ?? fallbackAddress?.address);

  if (!countryId || !cityId || !districtId || !block || !addressLine) {
    return null;
  }

  const payload: SallaShipToUpdate = {
    country: countryId,
    city: cityId,
    district: districtId,
    block,
    street_number: streetNumber,
    address_line: addressLine,
    postal_code: postal,
  };

  const shortAddress = getStringValue(shipTo.short_address ?? shipTo.shortAddress);
  if (shortAddress) {
    payload.short_address = shortAddress;
  }
  const buildingNumber =
    getStringValue(shipTo.building_number ?? shipTo.buildingNumber) ??
    getStringValue(fallbackAddress?.building_number);
  if (buildingNumber) {
    payload.building_number = buildingNumber;
  }
  const additionalNumber =
    getStringValue(shipTo.additional_number ?? shipTo.additionalNumber) ??
    getStringValue(fallbackAddress?.additional_number);
  if (additionalNumber) {
    payload.additional_number = additionalNumber;
  }
  const formattedAddress =
    getStringValue(shipTo.address) ??
    getStringValue(fallbackAddress?.address) ??
    getStringValue(fallbackAddress?.street_address);
  if (formattedAddress) {
    payload.address = formattedAddress;
  }

  const geo = getGeoCoordinates(
    shipTo.geo_coordinates ?? shipTo.geoCoordinates ?? fallbackAddress?.geo_coordinates,
  );
  if (geo) {
    payload.geo_coordinates = geo;
  }

  return payload;
}

function getGeoCoordinates(value: unknown): { lat: number; lng: number } | undefined {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return getGeoCoordinates(parsed);
    } catch {
      return undefined;
    }
  }
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  const lat = Number(record.lat ?? record.latitude);
  const lng = Number(record.lng ?? record.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return undefined;
  }
  return { lat, lng };
}

function isInternationalShipment(
  shipping: Record<string, any>,
  shipTo: Record<string, any>,
  fallbackAddress: Record<string, any> | null,
): boolean {
  if (typeof shipping.is_international === 'boolean') {
    return shipping.is_international;
  }

  const countryCandidates = [
    getStringValue(shipTo.country_code ?? shipTo.countryCode),
    getStringValue(fallbackAddress?.country_code),
  ];
  if (
    countryCandidates
      .map((value) => normalizeCountryValue(value))
      .some((value) => value && SAUDI_COUNTRY_CODES.has(value))
  ) {
    return false;
  }

  const countryNames = [
    getStringValue(shipTo.country_name ?? shipTo.countryName),
    getStringValue(fallbackAddress?.country),
  ];
  if (
    countryNames
      .map((value) => normalizeCountryValue(value))
      .some((value) => value && SAUDI_COUNTRY_NAMES.has(value))
  ) {
    return false;
  }

  return true;
}

function normalizeCountryValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/\s+/g, '').toUpperCase();
}

function cloneOrderDataWithPostal(
  orderData: Record<string, any>,
  postal: string,
): Prisma.JsonValue {
  const cloned = JSON.parse(JSON.stringify(orderData));
  if (cloned?.shipping?.ship_to) {
    cloned.shipping.ship_to.postal_code = postal;
  }
  if (cloned?.shipping?.receiver) {
    cloned.shipping.receiver.postal_code = postal;
  }
  if (cloned?.shipping_address) {
    cloned.shipping_address.postal_code = postal;
  }
  return cloned;
}
