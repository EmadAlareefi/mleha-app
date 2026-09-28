/**
 * Resolves where a local shipment has to go, from a Salla order payload, and
 * builds Google Maps links a delivery agent can open straight into navigation.
 *
 * Salla carries the pin the customer dropped at checkout in two shapes:
 * - `shipments[].ship_to` → `latitude` / `longitude`
 * - `shipping.address`    → `geo_coordinates: { lat, lng }`
 * The live `/orders/{id}` response currently omits both sections, so callers on
 * the server should merge the webhook-stored order first (see
 * `order-shipping-snapshot.ts`).
 *
 * Kept free of server imports so the delivery-agent page can reuse the link
 * builders.
 */

type UnknownRecord = Record<string, any>;

export interface ShipToLocation {
  latitude: number | null;
  longitude: number | null;
  shortAddress: string | null;
  buildingNumber: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  postalCode: string | null;
  additionalNumber: string | null;
  /** Free text the customer typed (floor, apartment, landmark). */
  addressNote: string | null;
}

const GOOGLE_MAPS_SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query=';
const GOOGLE_MAPS_DIRECTIONS_BASE = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=';

const toText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (value && typeof value === 'object') {
    const record = value as UnknownRecord;
    return toText(record.name) || toText(record.label);
  }
  return null;
};

export const parseCoordinate = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Rejects missing, out-of-range and the (0,0) placeholder Salla sends when no pin was set. */
export const isUsableCoordinatePair = (lat: number | null, lng: number | null): boolean => {
  if (lat === null || lng === null) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001);
};

const readCoordinates = (record: UnknownRecord): { lat: number; lng: number } | null => {
  const geo =
    record.geo_coordinates && typeof record.geo_coordinates === 'object'
      ? record.geo_coordinates
      : record.geoCoordinates && typeof record.geoCoordinates === 'object'
        ? record.geoCoordinates
        : null;
  const lat =
    parseCoordinate(geo?.lat) ??
    parseCoordinate(geo?.latitude) ??
    parseCoordinate(record.latitude) ??
    parseCoordinate(record.lat);
  const lng =
    parseCoordinate(geo?.lng) ??
    parseCoordinate(geo?.longitude) ??
    parseCoordinate(record.longitude) ??
    parseCoordinate(record.lng);
  return isUsableCoordinatePair(lat, lng) ? { lat: lat as number, lng: lng as number } : null;
};

/** Pulls coordinates out of a pasted Google Maps URL (`@lat,lng`, `q=`, `query=`, `ll=`, `destination=`). */
export const extractCoordinatesFromMapUrl = (
  url?: string | null,
): { lat: number; lng: number } | null => {
  if (!url) return null;
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // keep the raw string
  }
  const patterns = [
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|destination|daddr)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) {
      const lat = parseCoordinate(match[1]);
      const lng = parseCoordinate(match[2]);
      if (isUsableCoordinatePair(lat, lng)) {
        return { lat: lat as number, lng: lng as number };
      }
    }
  }
  return null;
};

const collectAddressRecords = (order: UnknownRecord): UnknownRecord[] => {
  const records: unknown[] = [];
  const pushShipTo = (shipment: unknown) => {
    if (shipment && typeof shipment === 'object') {
      const entry = shipment as UnknownRecord;
      records.push(entry.ship_to ?? entry.shipTo);
    }
  };

  if (Array.isArray(order.shipments)) order.shipments.forEach(pushShipTo);
  const shipping = order.shipping && typeof order.shipping === 'object' ? order.shipping : null;
  if (shipping) {
    if (Array.isArray(shipping.shipments)) shipping.shipments.forEach(pushShipTo);
    records.push(shipping.ship_to, shipping.address);
  }
  records.push(order.ship_to, order.shipTo);

  return records.filter(
    (record): record is UnknownRecord => Boolean(record) && typeof record === 'object',
  );
};

/** Salla's `street_number` sometimes carries the building number too ("هند بنت عمرو,6629"). */
const cleanStreet = (street: string | null, buildingNumber: string | null) => {
  if (!street) return null;
  let cleaned = street.replace(/\s*[,،]\s*\d+\s*$/u, '').trim();
  if (buildingNumber && cleaned === buildingNumber) cleaned = '';
  return cleaned || null;
};

export const extractShipToLocation = (order: unknown): ShipToLocation | null => {
  if (!order || typeof order !== 'object') return null;
  const records = collectAddressRecords(order as UnknownRecord);
  if (records.length === 0) return null;

  const first = (pick: (record: UnknownRecord) => string | null) => {
    for (const record of records) {
      const value = pick(record);
      if (value) return value;
    }
    return null;
  };

  let coordinates: { lat: number; lng: number } | null = null;
  for (const record of records) {
    coordinates = readCoordinates(record);
    if (coordinates) break;
  }

  const buildingNumber = first((r) => toText(r.building_number) || toText(r.buildingNumber));
  const location: ShipToLocation = {
    latitude: coordinates?.lat ?? null,
    longitude: coordinates?.lng ?? null,
    shortAddress: first((r) => toText(r.short_address) || toText(r.shortAddress)),
    buildingNumber,
    street: cleanStreet(first((r) => toText(r.street_number) || toText(r.street)), buildingNumber),
    district: first((r) => toText(r.district) || toText(r.block)),
    city: first((r) => toText(r.city)),
    postalCode: first((r) => toText(r.postal_code) || toText(r.postalCode)),
    additionalNumber: first((r) => toText(r.additional_number) || toText(r.additionalNumber)),
    addressNote: first((r) => toText(r.address_line_two) || toText(r.addressLineTwo)),
  };

  const hasAnything = Object.values(location).some((value) => value !== null);
  return hasAnything ? location : null;
};

export const buildNavigationUrl = (lat: number, lng: number) =>
  `${GOOGLE_MAPS_DIRECTIONS_BASE}${lat},${lng}`;

/**
 * A Google-geocodable query: "<building> <street>, <district>, <city> <postal>, السعودية".
 * Names, phones, labels and the national short code are left out on purpose —
 * Google cannot resolve them and they make the whole search fail.
 */
export const buildAddressSearchQuery = (parts: {
  buildingNumber?: string | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  postalCode?: string | null;
}): string | null => {
  const streetLine = [parts.buildingNumber, parts.street].filter(Boolean).join(' ').trim();
  const cityLine = [parts.city, parts.postalCode].filter(Boolean).join(' ').trim();
  const segments = [streetLine, parts.district?.trim(), cityLine].filter(
    (segment, index, array): segment is string => Boolean(segment) && array.indexOf(segment) === index,
  );
  if (segments.length === 0) return null;
  // A city alone sends the agent to the city centre, which is worse than no link.
  if (segments.length === 1 && segments[0] === cityLine) return null;
  return `${segments.join('، ')}، السعودية`;
};

export const buildAddressSearchUrl = (query: string) =>
  `${GOOGLE_MAPS_SEARCH_BASE}${encodeURIComponent(query)}`;
