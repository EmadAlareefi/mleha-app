type UnknownRecord = Record<string, any>;

const MESSENGER_KEYWORDS = ['مندوب', 'mandob', 'mandoub', 'mandoob', 'delivery agent', 'delivery-agent'];

const toStringValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
};

export const isMessengerCourierLabel = (value: unknown): boolean => {
  const text = toStringValue(value);
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return (
    text.includes('مندوب') ||
    MESSENGER_KEYWORDS.some((keyword) => lower.includes(keyword))
  );
};

export interface ShipToDetails {
  name: string | null;
  phone: string | null;
  city: string | null;
  district: string | null;
  region: string | null;
  addressLine: string | null;
  shortAddress: string | null;
  additionalNumber: string | null;
  postalCode: string | null;
  block: string | null;
  raw: UnknownRecord | null;
}

export interface MessengerShipmentInfo {
  courierLabel: string | null;
  source: string;
  shipTo: ShipToDetails | null;
  shipment: UnknownRecord | null;
}

const normalizeShipToDetails = (shipTo: any): ShipToDetails | null => {
  if (!shipTo || typeof shipTo !== 'object') {
    return null;
  }

  const district =
    typeof shipTo.district === 'object' && shipTo.district
      ? toStringValue(shipTo.district.name) || toStringValue(shipTo.district.label)
      : toStringValue(shipTo.district);

  const region =
    typeof shipTo.region === 'object' && shipTo.region
      ? toStringValue(shipTo.region.name) || toStringValue(shipTo.region.label)
      : toStringValue(shipTo.region);

  return {
    name: toStringValue(shipTo.name) || toStringValue(shipTo.full_name),
    phone: toStringValue(shipTo.phone) || toStringValue(shipTo.mobile),
    city: toStringValue(shipTo.city),
    district: district || null,
    region: region || null,
    addressLine:
      toStringValue(shipTo.address_line) ||
      toStringValue(shipTo.addressLine) ||
      toStringValue(shipTo.street) ||
      toStringValue(shipTo.short_address) ||
      toStringValue(shipTo.shortAddress) ||
      null,
    shortAddress: toStringValue(shipTo.short_address) || toStringValue(shipTo.shortAddress),
    additionalNumber:
      toStringValue(shipTo.additional_number) || toStringValue(shipTo.additionalNumber),
    postalCode: toStringValue(shipTo.postal_code) || toStringValue(shipTo.postalCode),
    block: toStringValue(shipTo.block),
    raw: shipTo as UnknownRecord,
  };
};

const collectShipmentsFromOrder = (orderData: any) => {
  const topLevel = Array.isArray(orderData?.shipments) ? orderData.shipments : [];
  const shippingSection = orderData?.shipping;
  const shippingShipments = Array.isArray(shippingSection?.shipments)
    ? shippingSection.shipments
    : [];

  return {
    topLevel,
    shippingShipments,
    shippingSection,
  };
};

const getCourierLabel = (shipment: any): string | null => {
  return (
    toStringValue(shipment?.courier_name) ||
    toStringValue(shipment?.courierName) ||
    toStringValue(shipment?.courier?.name) ||
    toStringValue(shipment?.company) ||
    toStringValue(shipment?.shipping_company) ||
    toStringValue(shipment?.source)
  );
};

const buildInfoFromShipment = (
  shipment: any,
  sourceLabel: string,
  preferredShipTo?: any,
): MessengerShipmentInfo | null => {
  const label = getCourierLabel(shipment);
  if (!isMessengerCourierLabel(label)) {
    return null;
  }

  const shipTo = normalizeShipToDetails(
    preferredShipTo ?? shipment?.ship_to ?? shipment?.shipTo ?? shipment?.receiver,
  );

  return {
    courierLabel: label,
    source: sourceLabel,
    shipTo,
    shipment: shipment || null,
  };
};

export const detectMessengerShipments = (orderData: any): MessengerShipmentInfo[] => {
  if (!orderData || typeof orderData !== 'object') {
    return [];
  }

  const { topLevel, shippingShipments, shippingSection } = collectShipmentsFromOrder(orderData);
  const results: MessengerShipmentInfo[] = [];

  topLevel.forEach((shipment: any, index: number) => {
    const info = buildInfoFromShipment(shipment, `shipments[${index}]`);
    if (info) {
      results.push(info);
    }
  });

  shippingShipments.forEach((shipment: any, index: number) => {
    const info = buildInfoFromShipment(
      shipment,
      `shipping.shipments[${index}]`,
      shippingSection?.ship_to,
    );
    if (info) {
      results.push(info);
    }
  });

  if (shippingSection && isMessengerCourierLabel(shippingSection?.company || shippingSection?.courier_name)) {
    results.push({
      courierLabel:
        toStringValue(shippingSection.company) ||
        toStringValue(shippingSection.courier_name) ||
        'مندوب التوصيل',
      source: 'shipping',
      shipTo: normalizeShipToDetails(shippingSection.ship_to || shippingSection.receiver),
      shipment: shippingSection,
    });
  }

  return results;
};

export const extractPrimaryShipTo = (orderData: any): ShipToDetails | null => {
  if (!orderData || typeof orderData !== 'object') {
    return null;
  }
  const messenger = detectMessengerShipments(orderData).find((entry) => entry.shipTo);
  if (messenger?.shipTo) {
    return messenger.shipTo;
  }

  const { topLevel, shippingShipments, shippingSection } = collectShipmentsFromOrder(orderData);

  const candidates = [
    ...topLevel.map((entry: any) => entry?.ship_to ?? entry?.shipTo),
    ...shippingShipments.map((entry: any) => entry?.ship_to ?? entry?.shipTo),
    shippingSection?.ship_to,
    shippingSection?.receiver,
    orderData?.delivery?.ship_to,
    orderData?.delivery?.receiver,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeShipToDetails(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

export const buildShipToArabicLabel = (shipTo: ShipToDetails | null | undefined): string | null => {
  if (!shipTo) {
    return null;
  }
  const lines: string[] = [];
  if (shipTo.name) {
    lines.push(`المستلم: ${shipTo.name}`);
  }
  if (shipTo.phone) {
    lines.push(`Phone: ${shipTo.phone}`);
  }
  const addressParts = [
    shipTo.addressLine,
    shipTo.block,
    shipTo.district,
    shipTo.city,
    shipTo.region,
  ].filter(Boolean);
  if (addressParts.length > 0) {
    lines.push(addressParts.join(' - '));
  }
  const postalParts = [
    shipTo.shortAddress ? `رمز العنوان: ${shipTo.shortAddress}` : null,
    shipTo.additionalNumber ? `رقم إضافي: ${shipTo.additionalNumber}` : null,
    shipTo.postalCode ? `الرمز البريدي: ${shipTo.postalCode}` : null,
  ].filter(Boolean);
  if (postalParts.length > 0) {
    lines.push(postalParts.join(' | '));
  }

  return lines.length > 0 ? lines.join('\n') : null;
};
