/**
 * Public carrier tracking page for a tracking number. Shared by the order
 * search page and the Hermes integration API so both link to the same place.
 * Falls back to a web search when the courier is not recognised.
 */
export function buildTrackingUrl(
  trackingNumber?: string | null,
  courierName?: string | null,
  labelUrl?: string | null
) {
  if (!trackingNumber) return null;
  const courier = (courierName || '').toLowerCase();
  const label = (labelUrl || '').toLowerCase();

  if (
    courier.includes('smsa') ||
    courier.includes('سمسا') ||
    label.includes('smsa') ||
    label.includes('سمسا')
  ) {
    const encoded = encodeURIComponent(trackingNumber);
    return {
      type: 'smsa',
      url: `https://www.smsaexpress.com/sa/ar/trackingdetails?tracknumbers%5B0%5D=${encoded}`,
    };
  }
  if (courier.includes('aramex')) {
    return {
      type: 'aramex',
      url: `https://www.aramex.com/track/shipments/${trackingNumber}`,
    };
  }
  if (
    courier.includes('ajex') ||
    courier.includes('aj-ex') ||
    courier.includes('أيجكس') ||
    courier.includes('ايجكس') ||
    label.includes('ajex') ||
    label.includes('aj-ex') ||
    label.includes('أيجكس') ||
    label.includes('ايجكس')
  ) {
    const encoded = encodeURIComponent(trackingNumber);
    return {
      type: 'ajex',
      url: `https://aj-ex.com/ar/shipment-status/${encoded}`,
    };
  }
  if (courier.includes('dhl')) {
    return {
      type: 'dhl',
      url: `https://www.dhl.com/global-en/home/tracking/tracking-express.html?AWB=${trackingNumber}&brand=DHL`,
    };
  }
  if (courier.includes('fedex')) {
    return {
      type: 'fedex',
      url: `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`,
    };
  }
  if (courier.includes('ups')) {
    return {
      type: 'ups',
      url: `https://www.ups.com/track?track=yes&trackNums=${trackingNumber}`,
    };
  }

  const encodedQuery = encodeURIComponent(`${trackingNumber} tracking`);
  return {
    type: 'generic',
    url: `https://www.google.com/search?q=${encodedQuery}`,
  };
}
