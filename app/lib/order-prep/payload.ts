import { detectInternationalOrder } from '@/app/lib/order-destination';
import { getShippingAddressSummary, getShippingCompanyName } from '@/app/lib/shipping-company';
import {
  COLOR_KEYS,
  SIZE_KEYS,
  extractAttributeValue,
  getItemImage,
  getItemQuantity,
  getItemSku,
  getStringValue,
  isPlainObject,
  normalizeItemOptions,
  resolveItemArray,
} from './item-attributes';
import type { PrepItem, PrepOrder } from './types';

type AnyRecord = Record<string, any>;

export type LocationRecord = {
  sku: string;
  productId: string | null;
  location: string;
  notes: string | null;
};

export type StoredItem = {
  sku: string | null;
  name: string | null;
  quantity: number;
  productId: string | null;
};

const MIN_PREFIX_LENGTH = 4;

/**
 * Shelf location for an item: exact SKU (case-insensitive), else the longest
 * location SKU the item SKU starts with (location rows are kept per parent
 * SKU), else the product id.
 */
export function matchLocation(
  sku: string | null,
  productId: string | null,
  locations: LocationRecord[],
): LocationRecord | null {
  const itemSku = sku?.trim().toUpperCase() || '';
  if (itemSku) {
    const exact = locations.find((location) => location.sku.trim().toUpperCase() === itemSku);
    if (exact) return exact;
    let best: LocationRecord | null = null;
    for (const location of locations) {
      const locationSku = location.sku.trim().toUpperCase();
      if (
        locationSku.length >= MIN_PREFIX_LENGTH &&
        itemSku.startsWith(locationSku) &&
        (!best || locationSku.length > best.sku.trim().length)
      ) {
        best = location;
      }
    }
    if (best) return best;
  }
  if (productId) {
    return locations.find((location) => location.productId === productId) ?? null;
  }
  return null;
}

/**
 * Sort key for shelf locations like "E5-3" or "AB1-4": letters, then each
 * number numerically, so E5-3 < E5-10 < E12-1. Items with no location go last.
 */
export function naturalLocationKey(location: string | null): Array<string | number> {
  if (!location || !location.trim()) return ['￿'];
  return (location.trim().toUpperCase().match(/[A-Z]+|\d+|[^\sA-Z\d]+/g) ?? [location]).map((part) =>
    /^\d+$/.test(part) ? Number.parseInt(part, 10) : part,
  );
}

export function compareLocations(a: string | null, b: string | null): number {
  const left = naturalLocationKey(a);
  const right = naturalLocationKey(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'number') return l - r;
    return String(l) < String(r) ? -1 : 1;
  }
  return 0;
}

function toTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tag) => (typeof tag === 'string' ? tag : getStringValue(tag?.name ?? tag?.value ?? tag)))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function giftMessage(rawGift: unknown): string | null {
  if (!rawGift) return null;
  if (typeof rawGift === 'string') return rawGift.trim() || null;
  if (isPlainObject(rawGift)) {
    const text = rawGift.message ?? rawGift.text ?? rawGift.note ?? rawGift.notes ?? rawGift.card_message;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  }
  return null;
}

function hasGift(rawGift: unknown): boolean {
  if (!rawGift) return false;
  if (rawGift === true) return true;
  if (typeof rawGift === 'string') return rawGift.trim().length > 0;
  if (Array.isArray(rawGift)) return rawGift.length > 0;
  if (isPlainObject(rawGift)) {
    if (rawGift.is_gift === false || rawGift.enabled === false) return false;
    if (rawGift.is_gift === true) return true;
    // Salla sends { text, image, deliver_at, expiry_date }; an empty one is no gift.
    return [rawGift.text, rawGift.message, rawGift.image, rawGift.card_message].some(
      (value) => (typeof value === 'string' && value.trim().length > 0) || (isPlainObject(value) && Object.keys(value).length > 0),
    );
  }
  return false;
}

export type BuildPrepOrderInput = {
  orderId: string;
  orderNumber: string | null;
  placedAt: Date | null;
  rawOrder: unknown;
  /** Webhook-synced items, used when the payload carries none. */
  storedItems?: StoredItem[];
  locations: LocationRecord[];
  giftFlagged?: boolean;
  highPriority?: boolean;
  promoProductIds?: Set<string>;
};

/** The packer's view of one order, from the stored Salla payload. */
export function buildPrepOrder(input: BuildPrepOrderInput): PrepOrder {
  const raw = isPlainObject(input.rawOrder) ? input.rawOrder : {};
  const rawItems = resolveItemArray(raw.items ?? raw);
  const promoIds = input.promoProductIds ?? new Set<string>();

  const items: PrepItem[] =
    rawItems.length > 0
      ? rawItems.map((item, index) => {
          const sku = getItemSku(item);
          const productId =
            item?.product?.id !== undefined && item?.product?.id !== null
              ? String(item.product.id)
              : item?.product_id !== undefined && item?.product_id !== null
                ? String(item.product_id)
                : null;
          const location = matchLocation(sku, productId, input.locations);
          return {
            index,
            key: item?.id !== undefined && item?.id !== null ? String(item.id) : `i${index}`,
            name: getStringValue(item?.name ?? item?.product?.name).trim() || 'منتج بدون اسم',
            sku,
            quantity: getItemQuantity(item),
            imageUrl: getItemImage(item),
            size: extractAttributeValue(item, SIZE_KEYS),
            color: extractAttributeValue(item, COLOR_KEYS),
            options: normalizeItemOptions(item),
            location: location?.location?.trim() || null,
            locationNote: location?.notes?.trim() || null,
            productId,
          };
        })
      : (input.storedItems ?? []).map((item, index) => {
          const location = matchLocation(item.sku, item.productId, input.locations);
          return {
            index,
            key: `s${index}`,
            name: item.name?.trim() || 'منتج بدون اسم',
            sku: item.sku,
            quantity: item.quantity > 0 ? item.quantity : 1,
            imageUrl: null,
            size: null,
            color: null,
            options: [],
            location: location?.location?.trim() || null,
            locationNote: location?.notes?.trim() || null,
            productId: item.productId,
          };
        });

  // Walk order: shelf by shelf. A stable sort keeps Salla's order for ties.
  const sortedItems = [...items].sort((a, b) => compareLocations(a.location, b.location));

  const destination = detectInternationalOrder(raw);
  const address = getShippingAddressSummary(raw);
  const giftFromPayload = hasGift(raw.gift);
  const isPromo = sortedItems.some((item) => item.productId !== null && promoIds.has(item.productId));

  return {
    orderId: input.orderId,
    orderNumber: input.orderNumber || String(raw.reference_id ?? raw.id ?? input.orderId),
    placedAt: input.placedAt ? input.placedAt.toISOString() : null,
    isInternational: destination.isInternational,
    country: destination.country || null,
    city: address.city ?? null,
    shippingCompany: getShippingCompanyName(raw),
    tags: toTagList(raw.tags),
    gift:
      giftFromPayload || input.giftFlagged
        ? { flagged: Boolean(input.giftFlagged), message: giftMessage(raw.gift) }
        : null,
    highPriority: Boolean(input.highPriority),
    isPromo,
    items: sortedItems,
    totalUnits: sortedItems.reduce((sum, item) => sum + item.quantity, 0),
  };
}

/**
 * The part of the Salla payload kept on the claim (OrderPrepAssignment.orderData).
 * Older readers look for `items`, `shipping`, `status`, `reference_id`; the full
 * payload stays in SallaOrder.rawOrder.
 */
export function trimOrderData(rawOrder: unknown): AnyRecord {
  const raw = isPlainObject(rawOrder) ? rawOrder : {};
  const keep = ['id', 'reference_id', 'date', 'status', 'items', 'shipping', 'shipments', 'tags', 'gift', 'receiver', 'customer', 'payment_method', 'cod'];
  const trimmed: AnyRecord = {};
  for (const key of keep) {
    if (raw[key] !== undefined) trimmed[key] = raw[key];
  }
  if (isPlainObject(trimmed.customer)) {
    // Only what the destination check needs; no contact details.
    const { country, city } = trimmed.customer as AnyRecord;
    trimmed.customer = { country, city };
  }
  return trimmed;
}
