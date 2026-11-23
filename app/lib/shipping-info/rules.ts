/**
 * Shipping-info completeness for international orders: what the order has,
 * what is missing, and the Salla update built from the customer's answers.
 * Pure functions only, so they can be unit-tested against real payload shapes.
 */

type AnyRecord = Record<string, any>;

export type MissingField = 'name' | 'district' | 'street';

export type ShippingInfo = {
  name: string;
  district: string;
  street: string;
  buildingNumber: string;
  postalCode: string;
  addressLine2: string;
  city: string;
  country: string;
  countryCode: string;
};

export type ShippingInfoSubmission = {
  firstName: string;
  middleName: string;
  lastName: string;
  district: string;
  street: string;
  buildingNumber: string;
  postalCode: string;
  addressLine2: string;
};

const INVALID_VALUES = new Set(['', '-', '--', '—', '.', 'غير متوفر', 'غير محدد', 'n/a', 'na', 'null', 'undefined', 'none']);

const asRecord = (value: unknown): AnyRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;

/** Trimmed text with collapsed spaces; placeholders such as "-" count as empty. */
export function cleanText(value: unknown, maxLength = 120): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const record = value as AnyRecord;
    return cleanText(record.name ?? record.value ?? record.label ?? '', maxLength);
  }
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (INVALID_VALUES.has(text.toLowerCase())) return '';
  return text.slice(0, maxLength);
}

/** Words that count toward a full name; one-letter initials do not. */
export function nameParts(name: string): string[] {
  return cleanText(name)
    .split(' ')
    .filter((part) => part.replace(/[^\p{L}]/gu, '').length >= 2);
}

export const hasFullName = (name: string): boolean => nameParts(name).length >= 3;

const orderOf = (raw: unknown): AnyRecord => {
  const root = asRecord(raw) ?? {};
  return asRecord(root.order) ?? root;
};

/** The ship-to block Salla puts on the order (`shipping.address`), and the shipment one, which carries ids. */
function shipToSources(raw: unknown): { address: AnyRecord; shipment: AnyRecord; receiver: AnyRecord } {
  const order = orderOf(raw);
  const shipping = asRecord(order.shipping) ?? {};
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return {
    address: asRecord(shipping.address) ?? asRecord(shipping.ship_to) ?? {},
    shipment: asRecord(asRecord(shipments[0])?.ship_to) ?? {},
    receiver: asRecord(shipping.receiver) ?? {},
  };
}

const first = (...values: unknown[]): string => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
};

export function extractShippingInfo(raw: unknown): ShippingInfo {
  const order = orderOf(raw);
  const customer = asRecord(order.customer) ?? {};
  const { address, shipment, receiver } = shipToSources(raw);
  const customerName = first(customer.full_name, [customer.first_name, customer.last_name].filter(Boolean).join(' '));
  return {
    name: first(receiver.name, shipment.name, customerName),
    district: first(address.block, shipment.block, address.district, shipment.district),
    street: first(address.street_number, shipment.street_number),
    buildingNumber: first(address.building_number, shipment.building_number),
    postalCode: first(address.postal_code, shipment.postal_code),
    addressLine2: first(shipment.address_line_two),
    city: first(address.city, shipment.city),
    country: first(shipment.country, address.country),
    countryCode: first(address.country_code, shipment.country_code, address.country).toUpperCase().slice(0, 3),
  };
}

export function findMissingFields(info: Pick<ShippingInfo, 'name' | 'district' | 'street'>): MissingField[] {
  const missing: MissingField[] = [];
  if (!hasFullName(info.name)) missing.push('name');
  if (!cleanText(info.district)) missing.push('district');
  if (!cleanText(info.street)) missing.push('street');
  return missing;
}

/** Splits a stored name into the three form fields (everything in the middle goes to the middle name). */
export function splitName(name: string): { firstName: string; middleName: string; lastName: string } {
  const parts = cleanText(name).split(' ').filter(Boolean);
  if (parts.length === 0) return { firstName: '', middleName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };
  return { firstName: parts[0], middleName: parts.slice(1, -1).join(' '), lastName: parts[parts.length - 1] };
}

export type SubmissionError = 'first_name' | 'middle_name' | 'last_name' | 'district' | 'street';

/** Cleans what the customer sent; returns the field errors when it is still incomplete. */
export function parseSubmission(
  input: Record<string, unknown>,
): { ok: true; value: ShippingInfoSubmission } | { ok: false; errors: SubmissionError[] } {
  const value: ShippingInfoSubmission = {
    firstName: cleanText(input.firstName, 40),
    middleName: cleanText(input.middleName, 60),
    lastName: cleanText(input.lastName, 40),
    district: cleanText(input.district, 100),
    street: cleanText(input.street, 120),
    buildingNumber: cleanText(input.buildingNumber, 30),
    postalCode: cleanText(input.postalCode, 20),
    addressLine2: cleanText(input.addressLine2, 150),
  };
  const errors: SubmissionError[] = [];
  if (nameParts(value.firstName).length === 0) errors.push('first_name');
  if (nameParts(value.middleName).length === 0) errors.push('middle_name');
  if (nameParts(value.lastName).length === 0) errors.push('last_name');
  if (!value.district) errors.push('district');
  if (!value.street) errors.push('street');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

export const fullNameOf = (s: ShippingInfoSubmission): string =>
  [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

const toInt = (value: unknown): number | undefined => {
  const candidate = asRecord(value) ? (value as AnyRecord).id : value;
  const parsed = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

/**
 * Body for `PUT /orders/{id}`. Salla treats ship_to as a whole object, so the
 * current address is rebuilt from the stored order and the customer's answers
 * are laid over it. Country/city/district are Salla ids, never free text.
 */
export function buildOrderUpdatePayload(raw: unknown, submission: ShippingInfoSubmission): AnyRecord {
  const { address, shipment, receiver } = shipToSources(raw);
  const current = extractShippingInfo(raw);
  const name = fullNameOf(submission);

  const postalCode = submission.postalCode || current.postalCode;
  const buildingNumber = submission.buildingNumber || current.buildingNumber;
  // Salla's ship_to has no second address line, so it goes into address_line.
  const addressLine = [submission.street, submission.addressLine2, submission.district, current.city, current.countryCode]
    .filter(Boolean)
    .join(', ');

  const geo = asRecord(address.geo_coordinates);
  const lat = Number(geo?.lat ?? shipment.latitude);
  const lng = Number(geo?.lng ?? shipment.longitude);

  const shipTo: AnyRecord = {
    country: toInt(shipment.country_id),
    city: toInt(shipment.city_id),
    district: toInt(shipment.district),
    block: submission.district,
    street_number: submission.street,
    address_line: addressLine,
    postal_code: postalCode,
    short_address: cleanText(address.short_address ?? shipment.short_address),
    building_number: buildingNumber,
    additional_number: cleanText(address.additional_number ?? shipment.additional_number),
    ...(Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { geo_coordinates: { lat, lng } } : {}),
  };
  for (const key of Object.keys(shipTo)) if (shipTo[key] === undefined) delete shipTo[key];

  const receiverBody: AnyRecord = { name };
  const phone = cleanText(receiver.phone ?? shipment.phone, 30);
  if (phone) receiverBody.phone = phone;
  const email = cleanText(receiver.email ?? shipment.email, 120);
  if (email) receiverBody.email = email;
  if (current.countryCode) receiverBody.country_code = current.countryCode;
  receiverBody.notify = false;

  return { ship_to: shipTo, receiver: receiverBody };
}

/** What the form is prefilled with. */
export function initialFormValues(raw: unknown): ShippingInfoSubmission {
  const info = extractShippingInfo(raw);
  return {
    ...splitName(info.name),
    district: info.district,
    street: info.street,
    buildingNumber: info.buildingNumber,
    postalCode: info.postalCode,
    addressLine2: info.addressLine2,
  };
}

const ARABIC_COUNTRIES = new Set(['SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO', 'EG', 'IQ', 'LB', 'SY', 'YE', 'PS', 'LY', 'TN', 'DZ', 'MA', 'SD']);

/** The page opens in Arabic for Arab countries, in English elsewhere. */
export const defaultLanguageFor = (countryCode: string): 'ar' | 'en' =>
  ARABIC_COUNTRIES.has(countryCode.toUpperCase()) ? 'ar' : 'en';
