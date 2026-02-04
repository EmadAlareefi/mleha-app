const INVALID_VALUES = new Set([
  '',
  '-',
  '--',
  '—',
  'غير متوفر',
  'غير محدد',
  'n/a',
  'na',
  'null',
  'undefined',
]);

const SHIPMENT_FIELD_KEYS = [
  'courier_name',
  'courierName',
  'courier',
  'carrier_name',
  'carrier',
  'company',
  'company_name',
  'provider',
  'provider_name',
  'service',
  'service_name',
  'serviceName',
  'shipping_company',
  'shippingCompany',
  'fulfillmentCompany',
  'delivery_company',
  'logistics_company',
] as const;

const GENERIC_FIELD_KEYS = ['name', 'label', 'title'] as const;

const ADDRESS_LINE_KEYS = [
  'address',
  'address_1',
  'address1',
  'address_2',
  'address2',
  'street',
  'street_1',
  'street1',
  'street_2',
  'street2',
  'avenue',
  'district',
  'neighborhood',
  'town',
  'area',
  'block',
  'building',
  'apartment',
  'landmark',
  'directions',
  'description',
  'notes',
] as const;

const CITY_FIELD_KEYS = ['city', 'city_name', 'cityName', 'region', 'state', 'province', 'governorate'] as const;
const COUNTRY_FIELD_KEYS = ['country', 'country_name', 'countryName'] as const;
const POSTAL_FIELD_KEYS = ['postal_code', 'postalCode', 'zip', 'zip_code', 'zipcode', 'postcode'] as const;

const NAME_FIELD_KEYS = [
  'name',
  'recipient',
  'recipient_name',
  'receiver',
  'receiver_name',
  'full_name',
  'fullName',
  'customer_name',
] as const;

const PHONE_CODE_KEYS = ['mobile_code', 'phone_code', 'country_code', 'dial_code'] as const;
const PHONE_NUMBER_KEYS = ['mobile', 'phone', 'telephone', 'tel', 'contact', 'contact_number'] as const;

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' ? (value as UnknownRecord) : null;

const sanitizeText = (value: string): string | null => {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return null;
  }
  return INVALID_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
};

const normalizeValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return sanitizeText(String(value));
  }

  if (typeof value === 'object') {
    const obj = value as UnknownRecord;
    return (
      normalizeValue(obj.value) ||
      normalizeValue(obj.name) ||
      normalizeValue(obj.label) ||
      normalizeValue(obj.title)
    );
  }

  return null;
};

const collectFromSource = (
  source: unknown,
  collector: unknown[],
  options: { includeGeneric?: boolean } = {},
) => {
  if (!source || typeof source !== 'object') {
    return;
  }
  const record = source as UnknownRecord;
  SHIPMENT_FIELD_KEYS.forEach((key) => {
    collector.push(record[key]);
  });
  collector.push(record.courier, record.carrier, record.company, record.provider);

  if (options.includeGeneric) {
    GENERIC_FIELD_KEYS.forEach((key) => {
      collector.push(record[key]);
    });
  }
};

const collectFromShipments = (value: unknown, collector: unknown[]) => {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((shipment) => collectFromSource(shipment, collector, { includeGeneric: true }));
};

const pickFromRecord = (record: UnknownRecord | null, keys: readonly string[]) => {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = normalizeValue(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

const collectAddressParts = (record: UnknownRecord | null) => {
  if (!record) {
    return [];
  }
  const parts: string[] = [];
  ADDRESS_LINE_KEYS.forEach((key) => {
    const value = normalizeValue(record[key]);
    if (value && !parts.includes(value)) {
      parts.push(value);
    }
  });
  return parts;
};

const firstNonEmptyRecord = (sources: unknown[]): UnknownRecord | null => {
  for (const source of sources) {
    const record = asRecord(source);
    if (record && Object.keys(record).length > 0) {
      return record;
    }
  }
  return null;
};

/**
 * Attempts to extract the shipping company or courier name from raw order data.
 */
export const getShippingCompanyName = (orderData: unknown): string | null => {
  if (!orderData || typeof orderData !== 'object') {
    return null;
  }

  const collector: unknown[] = [];
  const root = orderData as UnknownRecord;
  const nestedOrder = asRecord(root.order);

  const rootDelivery = asRecord(root.delivery);
  const rootShipping = asRecord(root.shipping);
  const rootShippingShipment = asRecord(rootShipping?.shipment);
  const rootShippingMethod = asRecord(root.shipping_method) || asRecord(root.shippingMethod);
  const rootFulfillment = asRecord(root.fulfillment);

  collectFromSource(rootDelivery, collector, { includeGeneric: true });
  collectFromSource(rootShipping, collector, { includeGeneric: true });
  collectFromSource(rootShippingShipment, collector, { includeGeneric: true });
  collectFromSource(rootShippingMethod, collector, { includeGeneric: true });
  collectFromSource(rootFulfillment, collector, { includeGeneric: true });

  if (nestedOrder) {
    const nestedDelivery = asRecord(nestedOrder.delivery);
    const nestedShipping = asRecord(nestedOrder.shipping);
    const nestedShippingShipment = asRecord(nestedShipping?.shipment);
    const nestedShippingMethod =
      asRecord(nestedOrder.shipping_method) || asRecord(nestedOrder.shippingMethod);
    const nestedFulfillment = asRecord(nestedOrder.fulfillment);

    collectFromSource(nestedDelivery, collector, { includeGeneric: true });
    collectFromSource(nestedShipping, collector, { includeGeneric: true });
    collectFromSource(nestedShippingShipment, collector, { includeGeneric: true });
    collectFromSource(nestedShippingMethod, collector, { includeGeneric: true });
    collectFromSource(nestedFulfillment, collector, { includeGeneric: true });
  }

  collector.push(
    root.fulfillmentCompany,
    root.shippingCompany,
    root.shipping_company,
    root.delivery_company,
    nestedOrder?.fulfillmentCompany,
    nestedOrder?.shippingCompany,
  );

  collectFromShipments(root.shipments, collector);
  collectFromShipments(rootShipping?.shipments, collector);
  collectFromShipments(rootDelivery?.shipments, collector);

  if (nestedOrder) {
    const nestedShipping = asRecord(nestedOrder.shipping);
    const nestedDelivery = asRecord(nestedOrder.delivery);
    collectFromShipments(nestedOrder.shipments, collector);
    collectFromShipments(nestedShipping?.shipments, collector);
    collectFromShipments(nestedDelivery?.shipments, collector);
  }

  const seen = new Set<string>();
  for (const candidate of collector) {
    const normalized = normalizeValue(candidate);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    return normalized;
  }

  return null;
};

export interface ShippingAddressSummary {
  name: string | null;
  phone: string | null;
  addressLine: string | null;
  locationLabel: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
}

const EMPTY_ADDRESS_SUMMARY: ShippingAddressSummary = {
  name: null,
  phone: null,
  addressLine: null,
  locationLabel: null,
  city: null,
  country: null,
  postalCode: null,
};

export const getShippingAddressSummary = (orderData: unknown): ShippingAddressSummary => {
  if (!orderData || typeof orderData !== 'object') {
    return EMPTY_ADDRESS_SUMMARY;
  }

  const root = orderData as UnknownRecord;
  const nestedOrder = asRecord(root.order);
  const rootDelivery = asRecord(root.delivery);
  const rootShipping = asRecord(root.shipping);

  const candidateSources = [
    root.shipping_address,
    root.shippingAddress,
    root.shipping_address_details,
    rootShipping?.address,
    rootShipping?.shipping_address,
    rootShipping?.shippingAddress,
    rootShipping?.receiver,
    rootShipping?.destination,
    rootDelivery?.address,
    rootDelivery?.shipping_address,
    rootDelivery?.shippingAddress,
    rootDelivery?.receiver,
    root.delivery_address,
    root.deliveryAddress,
    root.customer,
    root.customer_address,
    root.customerAddress,
    root.address,
    root.billing_address,
    root.billingAddress,
    nestedOrder?.shipping_address,
    nestedOrder?.shippingAddress,
    nestedOrder?.shipping?.address,
    nestedOrder?.shipping?.shipping_address,
    nestedOrder?.shipping?.receiver,
    nestedOrder?.delivery?.address,
    nestedOrder?.delivery?.receiver,
    nestedOrder?.customer,
    nestedOrder?.customer_address,
    nestedOrder?.customerAddress,
  ];

  const addressRecord = firstNonEmptyRecord(candidateSources);
  const customerRecord =
    asRecord(root.customer) ||
    asRecord(rootDelivery?.receiver) ||
    asRecord(rootShipping?.receiver) ||
    asRecord(nestedOrder?.customer) ||
    null;

  const name =
    pickFromRecord(addressRecord, NAME_FIELD_KEYS) ||
    pickFromRecord(customerRecord, NAME_FIELD_KEYS);

  const phoneCode =
    pickFromRecord(addressRecord, PHONE_CODE_KEYS) || pickFromRecord(customerRecord, PHONE_CODE_KEYS);
  const phoneNumber =
    pickFromRecord(addressRecord, PHONE_NUMBER_KEYS) ||
    pickFromRecord(customerRecord, PHONE_NUMBER_KEYS);
  const phoneParts = [phoneCode, phoneNumber].filter(Boolean) as string[];
  const phone = phoneParts.length > 0 ? phoneParts.join(' ').trim() : null;

  const addressLineParts = collectAddressParts(addressRecord);
  const addressLine = addressLineParts.length > 0 ? addressLineParts.join('، ') : null;

  const city =
    pickFromRecord(addressRecord, CITY_FIELD_KEYS) ||
    pickFromRecord(customerRecord, CITY_FIELD_KEYS) ||
    pickFromRecord(rootDelivery, CITY_FIELD_KEYS) ||
    pickFromRecord(rootShipping, CITY_FIELD_KEYS);

  const country =
    pickFromRecord(addressRecord, COUNTRY_FIELD_KEYS) ||
    pickFromRecord(customerRecord, COUNTRY_FIELD_KEYS) ||
    pickFromRecord(rootDelivery, COUNTRY_FIELD_KEYS) ||
    pickFromRecord(rootShipping, COUNTRY_FIELD_KEYS);

  const postalCode =
    pickFromRecord(addressRecord, POSTAL_FIELD_KEYS) ||
    pickFromRecord(customerRecord, POSTAL_FIELD_KEYS);

  const locationLabelParts = [city, country].filter(Boolean) as string[];
  const locationLabel = locationLabelParts.length > 0 ? locationLabelParts.join('، ') : null;

  return {
    name,
    phone,
    addressLine,
    locationLabel,
    city,
    country,
    postalCode,
  };
};
