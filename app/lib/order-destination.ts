import { getShippingAddressSummary } from '@/app/lib/shipping-company';

type UnknownRecord = Record<string, unknown>;

const SAUDI_COUNTRY_VALUES = new Set([
  'SA',
  'SAU',
  'KSA',
  'SAUDI',
  'SAUDIARABIA',
  'KINGDOMOFSAUDIARABIA',
  'السعودية',
  'المملكةالعربيةالسعودية',
]);

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : null;

const getStringValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const record = value as UnknownRecord;
    return getStringValue(record.value) || getStringValue(record.code) || getStringValue(record.name) || getStringValue(record.label);
  }
  return '';
};

const normalizeCountry = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

export const isSaudiCountry = (value: unknown): boolean => {
  const text = getStringValue(value);
  if (!text) {
    return false;
  }
  return SAUDI_COUNTRY_VALUES.has(normalizeCountry(text));
};

const collectCountryCandidates = (source: unknown): string[] => {
  const record = asRecord(source);
  if (!record) {
    return [];
  }

  return [
    record.country_code,
    record.countryCode,
    record.country_name,
    record.countryName,
    record.country,
  ]
    .map(getStringValue)
    .filter(Boolean);
};

const collectShipmentCountries = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((shipment) => {
    const record = asRecord(shipment);
    return [
      ...collectCountryCandidates(record),
      ...collectCountryCandidates(record?.ship_to),
      ...collectCountryCandidates(record?.shipTo),
      ...collectCountryCandidates(record?.receiver),
      ...collectCountryCandidates(record?.destination),
    ];
  });
};

const hasExplicitInternationalFlag = (source: unknown): boolean => {
  const record = asRecord(source);
  return record?.is_international === true || record?.isInternational === true;
};

export const detectInternationalOrder = (
  orderData: unknown,
): { isInternational: boolean; country: string } => {
  const root = asRecord(orderData);
  if (!root) {
    return { isInternational: false, country: '' };
  }

  const nestedOrder = asRecord(root.order);
  const shipping = asRecord(root.shipping);
  const delivery = asRecord(root.delivery);
  const nestedShipping = asRecord(nestedOrder?.shipping);
  const nestedDelivery = asRecord(nestedOrder?.delivery);
  const shippingShipment = asRecord(shipping?.shipment);
  const nestedShippingShipment = asRecord(nestedShipping?.shipment);
  const addressSummary = getShippingAddressSummary(orderData);

  const explicitInternational = [
    root,
    nestedOrder,
    shipping,
    delivery,
    nestedShipping,
    nestedDelivery,
    shippingShipment,
    nestedShippingShipment,
  ].some(hasExplicitInternationalFlag);

  const countryCandidates = [
    ...collectShipmentCountries(root.shipments),
    ...collectShipmentCountries(shipping?.shipments),
    ...collectShipmentCountries(delivery?.shipments),
    ...collectShipmentCountries(nestedOrder?.shipments),
    ...collectShipmentCountries(nestedShipping?.shipments),
    ...collectShipmentCountries(nestedDelivery?.shipments),
    ...collectCountryCandidates(shipping?.ship_to),
    ...collectCountryCandidates(shipping?.shipTo),
    ...collectCountryCandidates(shipping?.receiver),
    ...collectCountryCandidates(shipping?.destination),
    ...collectCountryCandidates(shippingShipment?.ship_to),
    ...collectCountryCandidates(shippingShipment?.shipTo),
    ...collectCountryCandidates(shippingShipment?.receiver),
    ...collectCountryCandidates(delivery?.ship_to),
    ...collectCountryCandidates(delivery?.shipTo),
    ...collectCountryCandidates(delivery?.receiver),
    ...collectCountryCandidates(root.ship_to),
    ...collectCountryCandidates(root.shipTo),
    ...collectCountryCandidates(root.receiver),
    ...collectCountryCandidates(root.shipping_address),
    ...collectCountryCandidates(root.shippingAddress),
    ...collectCountryCandidates(root.shipping_address_details),
    ...collectCountryCandidates(root.customer),
    ...collectCountryCandidates(root.billing_address),
    ...collectCountryCandidates(root.billingAddress),
    ...collectCountryCandidates(nestedShipping?.ship_to),
    ...collectCountryCandidates(nestedShipping?.shipTo),
    ...collectCountryCandidates(nestedShipping?.receiver),
    ...collectCountryCandidates(nestedShippingShipment?.ship_to),
    ...collectCountryCandidates(nestedShippingShipment?.shipTo),
    ...collectCountryCandidates(nestedShippingShipment?.receiver),
    ...collectCountryCandidates(nestedDelivery?.ship_to),
    ...collectCountryCandidates(nestedDelivery?.shipTo),
    ...collectCountryCandidates(nestedDelivery?.receiver),
    ...collectCountryCandidates(nestedOrder?.ship_to),
    ...collectCountryCandidates(nestedOrder?.shipTo),
    ...collectCountryCandidates(nestedOrder?.receiver),
    ...collectCountryCandidates(nestedOrder?.shipping_address),
    ...collectCountryCandidates(nestedOrder?.shippingAddress),
    addressSummary.country || '',
  ].filter(Boolean);

  const country = countryCandidates.find(Boolean) || '';
  if (explicitInternational) {
    return {
      isInternational: true,
      country: country && !isSaudiCountry(country) ? country : 'International',
    };
  }

  if (country) {
    return {
      isInternational: !isSaudiCountry(country),
      country,
    };
  }

  return { isInternational: false, country: '' };
};
