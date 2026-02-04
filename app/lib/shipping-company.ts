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

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' ? (value as UnknownRecord) : null;

const normalizeValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim().replace(/\s+/g, ' ');
    if (!text) {
      return null;
    }
    const normalized = text.toLowerCase();
    if (INVALID_VALUES.has(normalized)) {
      return null;
    }
    return text;
  }

  if (typeof value === 'object') {
    const obj = value as UnknownRecord;
    return (
      normalizeValue(obj.name) ||
      normalizeValue(obj.label) ||
      normalizeValue(obj.title) ||
      normalizeValue(obj.value)
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
