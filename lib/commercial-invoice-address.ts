const ADDRESS_LINE_KEYS = [
  'address',
  'address_1',
  'address1',
  'address_2',
  'address2',
  'address_line',
  'addressLine',
  'address_line_two',
  'addressLineTwo',
  'street',
  'street_1',
  'street1',
  'street_2',
  'street2',
  'street_number',
  'streetNumber',
  'district',
  'neighborhood',
  'area',
  'block',
  'building',
  'building_number',
  'buildingNumber',
  'additional_number',
  'additionalNumber',
  'short_address',
  'shortAddress',
  'apartment',
  'landmark',
  'directions',
  'description',
  'notes',
] as const;

const CITY_FIELD_KEYS = ['city', 'city_name', 'cityName', 'region', 'state', 'province', 'governorate'] as const;
const COUNTRY_FIELD_KEYS = ['country', 'country_name', 'countryName'] as const;
const POSTAL_FIELD_KEYS = ['postal_code', 'postalCode', 'zip', 'zip_code', 'zipcode', 'postcode'] as const;
const NAME_FIELD_KEYS = ['name', 'recipient', 'recipient_name', 'receiver_name', 'full_name', 'fullName'] as const;
const PHONE_CODE_KEYS = ['mobile_code', 'phone_code', 'dial_code'] as const;
const PHONE_NUMBER_KEYS = ['mobile', 'phone', 'telephone', 'tel', 'contact', 'contact_number'] as const;

type UnknownRecord = Record<string, unknown>;

export interface CommercialInvoiceConsignee {
  name: string;
  address: string;
  city: string;
  country: string;
  postalCode: string;
  phone: string;
  email: string;
}

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null;

const normalizeText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim().replace(/\s+/g, ' ');
  }
  if (typeof value === 'object') {
    const obj = value as UnknownRecord;
    return normalizeText(obj.value) || normalizeText(obj.name) || normalizeText(obj.label) || normalizeText(obj.title);
  }
  return '';
};

const getFirstValue = (records: Array<UnknownRecord | null>, keys: readonly string[]) => {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = normalizeText(record[key]);
      if (value) return value;
    }
  }
  return '';
};

const collectAddressParts = (records: Array<UnknownRecord | null>) => {
  const parts: string[] = [];
  for (const record of records) {
    if (!record) continue;
    for (const key of ADDRESS_LINE_KEYS) {
      const value = normalizeText(record[key]);
      const normalizedValue = value.toLowerCase();
      const alreadyIncluded = parts.some((part) => part.toLowerCase().includes(normalizedValue));
      if (value && !alreadyIncluded) {
        parts.push(value);
      }
    }
  }
  return parts;
};

const buildFullName = (record: UnknownRecord | null) => {
  if (!record) return '';
  const explicitName = getFirstValue([record], NAME_FIELD_KEYS);
  if (explicitName) return explicitName;
  return [normalizeText(record.first_name), normalizeText(record.last_name)].filter(Boolean).join(' ').trim();
};

const buildPhone = (records: Array<UnknownRecord | null>) => {
  for (const record of records) {
    if (!record) continue;
    const phoneNumber = getFirstValue([record], PHONE_NUMBER_KEYS);
    if (!phoneNumber) continue;
    const phoneCode = getFirstValue([record], PHONE_CODE_KEYS);
    return [phoneCode, phoneNumber].filter(Boolean).join('').trim();
  }
  return '';
};

const getShipmentDestinationRecords = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((shipment) => {
    const record = asRecord(shipment);
    return [
      asRecord(record?.ship_to),
      asRecord(record?.shipTo),
      asRecord(record?.receiver),
      asRecord(record?.destination),
    ];
  });
};

const getPrimaryDestinationRecords = (orderData: UnknownRecord) => {
  const shipping = asRecord(orderData.shipping);
  const delivery = asRecord(orderData.delivery);
  const shipment = asRecord(shipping?.shipment);
  const nestedOrder = asRecord(orderData.order);
  const nestedShipping = asRecord(nestedOrder?.shipping);
  const nestedDelivery = asRecord(nestedOrder?.delivery);
  const nestedShipment = asRecord(nestedShipping?.shipment);

  return [
    ...getShipmentDestinationRecords(orderData.shipments),
    ...getShipmentDestinationRecords(shipping?.shipments),
    ...getShipmentDestinationRecords(delivery?.shipments),
    ...getShipmentDestinationRecords(nestedOrder?.shipments),
    ...getShipmentDestinationRecords(nestedShipping?.shipments),
    ...getShipmentDestinationRecords(nestedDelivery?.shipments),
    asRecord(shipping?.ship_to),
    asRecord(shipping?.shipTo),
    asRecord(shipping?.receiver),
    asRecord(shipping?.destination),
    asRecord(shipment?.ship_to),
    asRecord(shipment?.shipTo),
    asRecord(shipment?.receiver),
    asRecord(shipping?.address),
    asRecord(shipping?.shipping_address),
    asRecord(shipping?.shippingAddress),
    asRecord(delivery?.ship_to),
    asRecord(delivery?.shipTo),
    asRecord(delivery?.receiver),
    asRecord(delivery?.address),
    asRecord(orderData.ship_to),
    asRecord(orderData.shipTo),
    asRecord(orderData.receiver),
    asRecord(orderData.delivery_address),
    asRecord(orderData.deliveryAddress),
    asRecord(nestedShipping?.ship_to),
    asRecord(nestedShipping?.shipTo),
    asRecord(nestedShipping?.receiver),
    asRecord(nestedShipment?.ship_to),
    asRecord(nestedShipment?.shipTo),
    asRecord(nestedShipment?.receiver),
    asRecord(nestedShipping?.address),
    asRecord(nestedDelivery?.ship_to),
    asRecord(nestedDelivery?.shipTo),
    asRecord(nestedDelivery?.receiver),
    asRecord(nestedDelivery?.address),
    asRecord(nestedOrder?.ship_to),
    asRecord(nestedOrder?.shipTo),
    asRecord(nestedOrder?.receiver),
  ];
};

const getLegacyShippingRecords = (orderData: UnknownRecord) => {
  const shipping = asRecord(orderData.shipping);
  const delivery = asRecord(orderData.delivery);
  const nestedOrder = asRecord(orderData.order);
  const nestedShipping = asRecord(nestedOrder?.shipping);

  return [
    asRecord(shipping?.shipping_address),
    asRecord(shipping?.shippingAddress),
    asRecord(delivery?.shipping_address),
    asRecord(delivery?.shippingAddress),
    asRecord(orderData.shipping_address),
    asRecord(orderData.shippingAddress),
    asRecord(orderData.shipping_address_details),
    asRecord(nestedShipping?.shipping_address),
    asRecord(nestedShipping?.shippingAddress),
    asRecord(nestedOrder?.shipping_address),
    asRecord(nestedOrder?.shippingAddress),
  ];
};

export const resolveCommercialInvoiceConsignee = (orderData: unknown): CommercialInvoiceConsignee => {
  const root = asRecord(orderData) || {};
  const nestedOrder = asRecord(root.order);
  const customer = asRecord(root.customer) || asRecord(nestedOrder?.customer);
  const billingAddress = asRecord(root.billing_address) || asRecord(root.billingAddress) || asRecord(nestedOrder?.billing_address);
  const customerAddress = asRecord(root.customer_address) || asRecord(root.customerAddress);
  const primaryDestinationRecords = getPrimaryDestinationRecords(root);
  const legacyShippingRecords = getLegacyShippingRecords(root);
  const fallbackRecords = [customerAddress, customer, billingAddress];
  const allRecords = [...primaryDestinationRecords, ...legacyShippingRecords, ...fallbackRecords];

  const primaryAddressParts = collectAddressParts(primaryDestinationRecords);
  const legacyAddressParts = collectAddressParts(legacyShippingRecords);
  const fallbackAddressParts = collectAddressParts(fallbackRecords);
  const addressParts =
    primaryAddressParts.length > 0
      ? primaryAddressParts
      : legacyAddressParts.length > 0
        ? legacyAddressParts
        : fallbackAddressParts;

  const destinationName = [...primaryDestinationRecords, ...legacyShippingRecords].map(buildFullName).find(Boolean) || '';
  const customerName = buildFullName(customer);
  const phone = buildPhone(allRecords);

  return {
    name: destinationName || customerName,
    address: addressParts.join(', '),
    city: getFirstValue(allRecords, CITY_FIELD_KEYS),
    country: getFirstValue(allRecords, COUNTRY_FIELD_KEYS),
    postalCode: getFirstValue(allRecords, POSTAL_FIELD_KEYS),
    phone,
    email: normalizeText(customer?.email),
  };
};
