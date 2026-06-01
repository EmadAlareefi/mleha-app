type AnyRecord = Record<string, any>;

function normalizeTrackingCandidate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return null;
  }

  const normalized = value.toString().trim();
  return normalized || null;
}

function extractTrackingNumberFromLink(value: unknown): string | null {
  const link = normalizeTrackingCandidate(value);
  if (!link) return null;

  try {
    const url = new URL(link);
    for (const key of ['tracking_number', 'trackingNumber', 'tracking_no', 'awb_number', 'awb']) {
      const trackingNumber = normalizeTrackingCandidate(url.searchParams.get(key));
      if (trackingNumber) return trackingNumber;
    }

    const pathCandidate = normalizeTrackingCandidate(url.pathname.split('/').filter(Boolean).pop());
    if (pathCandidate) return pathCandidate;
  } catch {
    return null;
  }

  return null;
}

function getTrackingCandidates(shipment: AnyRecord | null | undefined): unknown[] {
  if (!shipment) return [];

  return [
    shipment.tracking_number,
    shipment.trackingNumber,
    shipment.shipping_number,
    shipment.tracking_no,
    shipment.awb_number,
    shipment.awbNumber,
    shipment.awb,
  ];
}

function getTrackingLinkCandidates(shipment: AnyRecord | null | undefined): unknown[] {
  if (!shipment) return [];

  return [
    shipment.tracking_link,
    shipment.trackingLink,
    shipment.tracking_url,
    shipment.trackingUrl,
  ];
}

export function extractSallaTrackingNumber(order: AnyRecord | null | undefined): string | null {
  if (!order) return null;

  const shipping = order.shipping || {};
  const delivery = order.delivery || {};
  const directShipment = order.shipment || {};
  const shippingShipment = shipping.shipment || {};
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];

  const explicitCandidates = [
    ...getTrackingCandidates(shippingShipment),
    ...getTrackingCandidates(directShipment),
    ...shipments.flatMap(getTrackingCandidates),
    ...getTrackingCandidates(shipping),
    ...getTrackingCandidates(delivery),
    order.tracking_number,
    order.trackingNumber,
  ];

  for (const candidate of explicitCandidates) {
    const trackingNumber = normalizeTrackingCandidate(candidate);
    if (trackingNumber) return trackingNumber;
  }

  const trackingLinks = [
    ...getTrackingLinkCandidates(shippingShipment),
    ...getTrackingLinkCandidates(directShipment),
    ...shipments.flatMap(getTrackingLinkCandidates),
    ...getTrackingLinkCandidates(shipping),
    ...getTrackingLinkCandidates(delivery),
    order.tracking_link,
  ];

  for (const link of trackingLinks) {
    const trackingNumber = extractTrackingNumberFromLink(link);
    if (trackingNumber) return trackingNumber;
  }

  for (const candidate of [shippingShipment.id, directShipment.id]) {
    const trackingNumber = normalizeTrackingCandidate(candidate);
    if (trackingNumber) return trackingNumber;
  }

  return null;
}
