import {
  buildAddressSearchQuery,
  buildAddressSearchUrl,
  buildNavigationUrl,
  extractCoordinatesFromMapUrl,
  isUsableCoordinatePair,
  parseCoordinate,
} from '@/app/lib/local-shipping/ship-to-location';

export const FINAL_STATUSES = ['delivered', 'failed', 'cancelled'];
export const ADMIN_DELIVERABLE_STATUSES = ['assigned', 'picked_up', 'in_transit'];

export interface LocalShipmentMeta {
  paymentMethod?: string | null;
  shipToArabicText?: string | null;
  shipToName?: string | null;
  shipToPhone?: string | null;
  shipToAddressLine?: string | null;
  shipToDistrict?: string | null;
  shipToCity?: string | null;
  shipToPostalCode?: string | null;
  shipToLatitude?: string | number | null;
  shipToLongitude?: string | number | null;
  shipToBuildingNumber?: string | null;
  shipToStreet?: string | null;
  shipToShortAddress?: string | null;
  shipToAddressNote?: string | null;
  mapsLink?: string | null;
  shipToLocationText?: string | null;
  shipToLocationCode?: string | null;
  hasExchangeCoupon?: boolean;
  exchangeCouponCode?: string | null;
}

export interface LocalShipment {
  id: string;
  orderNumber: string;
  trackingNumber: string;
  customerName: string;
  customerPhone: string;
  shippingCity: string;
  shippingAddress: string;
  shippingCountry?: string | null;
  shippingPostcode?: string | null;
  orderTotal: number;
  isCOD: boolean;
  status: string;
  createdAt: string;
  orderItems?: { items?: unknown[]; meta?: LocalShipmentMeta | null } | null;
}

export interface CODCollection {
  id: string;
  collectionAmount: number;
  collectedAmount?: number;
  status: string;
}

export interface ExchangeRequestInfo {
  id: string;
  status: string;
  orderNumber?: string | null;
  exchangeOrderNumber?: string | null;
}

export interface Assignment {
  id: string;
  status: string;
  assignedAt: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  notes?: string;
  failureReason?: string | null;
  shipment: LocalShipment & { codCollection?: CODCollection };
  shipmentDirection?: 'incoming' | 'outgoing';
  exchangeRequest?: ExchangeRequestInfo | null;
  deliveryOtpRequestedAt?: string | null;
  deliveryOtpExpiresAt?: string | null;
  deliveryOtpVerifiedAt?: string | null;
  deliveryOtpAttemptCount?: number | null;
}

export interface DeliveryAgentTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'agent_completed' | 'completed' | 'cancelled';
  requestType: string;
  requestedItem?: string | null;
  quantity?: number | null;
  priority?: string | null;
  details?: string | null;
  dueDate?: string | null;
  completionNotes?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string; username: string } | null;
  createdByName?: string | null;
  createdByUsername?: string | null;
  /** The delivered shipment a `return_pickup` task collects from. */
  relatedShipment?: LocalShipment | null;
}

export const RETURN_PICKUP_REQUEST_TYPE = 'return_pickup';

export const isReturnPickupTask = (task: DeliveryAgentTask) =>
  task.requestType === RETURN_PICKUP_REQUEST_TYPE && Boolean(task.relatedShipment);

export type WalletTransactionType = 'SHIPMENT_COMPLETED' | 'TASK_COMPLETED' | 'PAYOUT' | 'ADJUSTMENT';

export interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amount: number;
  notes?: string | null;
  createdAt: string;
}

export interface DeliveryAgentWalletInfo {
  balance: number;
  stats: {
    shipments: { count: number; total: number };
    tasks: { count: number; total: number };
    totalEarned: number;
    totalPaid: number;
  };
  recentTransactions: WalletTransaction[];
}

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'SAR' }).format(value);

export const formatDate = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const cleanSegment = (value?: string | null) =>
  value ? value.replace(/^\s*مدينة العميل\s*:\s*/iu, '').trim() : '';

// ---------------------------------------------------------------------------
// Returns / exchanges
// ---------------------------------------------------------------------------

export const getExchangeCouponCode = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta;
  const code = meta?.exchangeCouponCode?.trim();
  if (code) return code;
  return meta?.hasExchangeCoupon ? 'EXCHANGE' : null;
};

const hasExchangeCoupon = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta;
  if (!meta) return false;
  if (meta.hasExchangeCoupon) return true;
  return Boolean(meta.exchangeCouponCode?.trim().toUpperCase().startsWith('EX'));
};

/**
 * Anything where the agent has to bring an item back: shipments scanned as
 * incoming, and exchange orders where the original piece is collected from the
 * customer while handing over the replacement.
 */
export const isReturnAssignment = (assignment: Assignment) =>
  assignment.shipmentDirection === 'incoming' ||
  Boolean(assignment.exchangeRequest) ||
  hasExchangeCoupon(assignment.shipment);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const getCollectAmount = (assignment: Assignment) => {
  const { shipment } = assignment;
  if (!shipment.isCOD) return 0;
  return Number(shipment.codCollection?.collectionAmount ?? shipment.orderTotal) || 0;
};

// ---------------------------------------------------------------------------
// Address & maps
// ---------------------------------------------------------------------------

/** Legacy links searched the national short code (e.g. JDSD6629), which Google cannot resolve. */
const isShortCodeSearchLink = (url: string) =>
  /\/maps\/search\/\?api=1&query=[A-Z]{4}\d{4}$/i.test(url.trim());

const MAP_URL_PATTERN = /(https?:\/\/[^\s<>()"']+)/i;

const extractUrl = (value?: string | null) => {
  const match = value?.match(MAP_URL_PATTERN);
  return match?.[0]?.trim().replace(/[),.;،]+$/u, '') || null;
};

/** Older shipments only have Salla's address_line ("street, 6629, district, city, MQ, SA"). */
const streetFromAddressLine = (meta: LocalShipmentMeta) => {
  if (!meta.shipToAddressLine) return null;
  const skip = new Set([meta.shipToDistrict, meta.shipToCity].map((v) => v?.trim()).filter(Boolean));
  const parts = meta.shipToAddressLine
    .split(/[,،]/u)
    .map((part) => part.trim())
    .filter((part) => part && !/^[A-Z]{2}$/.test(part) && !skip.has(part));
  return parts.join(' ') || null;
};

export interface MapTarget {
  url: string;
  /** True when we have the customer's exact pin; false when Google has to guess from the address text. */
  precise: boolean;
}

export const getMapTarget = (shipment: LocalShipment): MapTarget | null => {
  const meta = shipment.orderItems?.meta ?? {};

  const lat = parseCoordinate(meta.shipToLatitude);
  const lng = parseCoordinate(meta.shipToLongitude);
  if (isUsableCoordinatePair(lat, lng)) {
    return { url: buildNavigationUrl(lat as number, lng as number), precise: true };
  }

  const explicitLinks = [
    meta.mapsLink,
    extractUrl(meta.shipToLocationText),
    extractUrl(meta.shipToAddressNote),
    extractUrl(meta.shipToAddressLine),
    extractUrl(shipment.shippingAddress),
  ].filter((link): link is string => Boolean(link) && !isShortCodeSearchLink(link as string));

  for (const link of explicitLinks) {
    const coordinates = extractCoordinatesFromMapUrl(link);
    if (coordinates) {
      return { url: buildNavigationUrl(coordinates.lat, coordinates.lng), precise: true };
    }
  }
  const pastedLink = explicitLinks.find((link) => /^https?:\/\//i.test(link));
  if (pastedLink) {
    return { url: pastedLink, precise: true };
  }

  const query = buildAddressSearchQuery({
    buildingNumber: meta.shipToBuildingNumber,
    street: meta.shipToStreet || streetFromAddressLine(meta),
    district: cleanSegment(meta.shipToDistrict),
    city: cleanSegment(meta.shipToCity || shipment.shippingCity),
    postalCode: meta.shipToPostalCode || shipment.shippingPostcode,
  });
  return query ? { url: buildAddressSearchUrl(query), precise: false } : null;
};

/** One short line for the card: "الصفا، جدة". */
export const getAreaLabel = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta;
  const parts = [cleanSegment(meta?.shipToDistrict), cleanSegment(meta?.shipToCity || shipment.shippingCity)]
    .filter((part, index, array) => part && array.indexOf(part) === index);
  return parts.join('، ') || 'العنوان غير متوفر';
};

/** Everything we know, for the collapsible details section. */
export const getAddressDetails = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta ?? {};
  const lines: string[] = [];
  const streetLine = [meta.shipToBuildingNumber, meta.shipToStreet].filter(Boolean).join(' ');
  if (streetLine) lines.push(streetLine);
  else if (meta.shipToAddressLine) lines.push(meta.shipToAddressLine);
  const areaLine = [meta.shipToDistrict, meta.shipToCity || shipment.shippingCity, meta.shipToPostalCode]
    .map(cleanSegment)
    .filter(Boolean)
    .join('، ');
  if (areaLine) lines.push(areaLine);
  if (meta.shipToShortAddress) lines.push(`العنوان الوطني المختصر: ${meta.shipToShortAddress}`);
  if (lines.length === 0 && shipment.shippingAddress) {
    lines.push(cleanSegment(shipment.shippingAddress));
  }
  return lines.filter((line, index, array) => array.indexOf(line) === index);
};

// ---------------------------------------------------------------------------
// Phone & WhatsApp
// ---------------------------------------------------------------------------

const digitsOnly = (phone: string) => phone.replace(/[^\d]/g, '');

const toInternationalDigits = (phone: string) => {
  let digits = digitsOnly(phone).replace(/^00+/, '');
  if (!digits) return null;
  if (digits.startsWith('966')) return digits;
  digits = digits.replace(/^0+/, '');
  // Local Saudi mobile (5XXXXXXXX)
  if (digits.length === 9 && digits.startsWith('5')) return `966${digits}`;
  return digits;
};

export const getRecipientPhone = (shipment: LocalShipment) =>
  shipment.orderItems?.meta?.shipToPhone || shipment.customerPhone || '';

export const getCallLink = (shipment: LocalShipment) => {
  const digits = toInternationalDigits(getRecipientPhone(shipment));
  return digits ? `tel:+${digits}` : null;
};

export const getWhatsAppLink = (
  shipment: LocalShipment,
  hasPreciseLocation: boolean,
  purpose: 'delivery' | 'pickup' = 'delivery'
) => {
  const digits = toInternationalDigits(getRecipientPhone(shipment));
  if (!digits) return null;

  const greeting = shipment.customerName ? ` ${shipment.customerName}` : '';
  const codLine =
    purpose === 'delivery' && shipment.isCOD
      ? `\n🔹 المبلغ المطلوب عند الاستلام: ${formatCurrency(Number(shipment.orderTotal) || 0)}`
      : '';
  const ask =
    purpose === 'pickup'
      ? hasPreciseLocation
        ? 'سأمر عليك لاستلام المرتجع، نرجو تجهيز القطع في كيسها الأصلي.'
        : 'سأمر عليك لاستلام المرتجع، نرجو تكرماً مشاركة موقعك (Location) عبر واتساب.'
      : hasPreciseLocation
        ? 'مندوب التوصيل في الطريق إليك لتسليم طلبك.'
        : 'طلبك جاهز للتوصيل، نرجو تكرماً مشاركة موقعك (Location) عبر واتساب ليتم التسليم.';
  const message = `السلام عليكم${greeting}،\nمعك مندوب مليحة 👗\n${ask}\n\n🔹 رقم الطلب: ${shipment.orderNumber}${codLine}`;

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

export const maskPhoneForDisplay = (value?: string | null) => {
  if (!value) return '';
  const digits = digitsOnly(value);
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(digits.length - 4, 2))}${digits.slice(-4)}`;
};

export const FAILURE_REASONS = [
  'العميل لا يرد',
  'العنوان غير صحيح أو غير واضح',
  'العميل طلب تأجيل التسليم',
  'العميل رفض الاستلام',
  'العميل غير موجود في الموقع',
];

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** The customer's exact pin, or a pin parsed from a pasted maps link. */
export const getShipmentPoint = (shipment: LocalShipment): GeoPoint | null => {
  const meta = shipment.orderItems?.meta ?? {};
  const lat = parseCoordinate(meta.shipToLatitude);
  const lng = parseCoordinate(meta.shipToLongitude);
  if (isUsableCoordinatePair(lat, lng)) {
    return { lat: lat as number, lng: lng as number };
  }
  return extractCoordinatesFromMapUrl(meta.mapsLink) ?? extractCoordinatesFromMapUrl(extractUrl(meta.shipToAddressNote));
};

/** Straight-line (haversine) distance; roads are usually 20–40% longer. */
export const distanceKm = (from: GeoPoint, to: GeoPoint) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const formatDistance = (km: number) =>
  km < 1 ? `${Math.max(Math.round(km * 1000 / 50) * 50, 50)} م` : `${km < 10 ? km.toFixed(1) : Math.round(km)} كم`;
