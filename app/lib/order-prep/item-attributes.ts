/**
 * Reading line items, size, colour and options out of Salla order payloads.
 * Moved from the old prep page (app/order-prep/legacy/OrderPrepClient.tsx) so
 * the server builds the packer's view once, and so it can be tested.
 */

type AnyRecord = Record<string, any>;

export const isPlainObject = (value: unknown): value is AnyRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A display string for Salla's mixed value shapes ({ name }, { label }, { value }, scalars). */
export function getStringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as AnyRecord;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.label === 'string') return obj.label;
    if (obj.value !== undefined) return getStringValue(obj.value);
    return '';
  }
  return '';
}

const isLikelyLineItem = (value: unknown): boolean => {
  if (!isPlainObject(value)) return false;
  const hasName = typeof value.name === 'string' || typeof value.title === 'string';
  const hasSku =
    typeof value.sku === 'string' ||
    typeof (value.product as AnyRecord | undefined)?.sku === 'string' ||
    typeof value.code === 'string';
  const rawQuantity = value.quantity ?? value.qty;
  const quantity =
    typeof rawQuantity === 'number'
      ? rawQuantity
      : typeof rawQuantity === 'string'
        ? Number.parseFloat(rawQuantity)
        : null;
  const hasQuantity = typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0;
  const hasProduct =
    isPlainObject(value.product) ||
    isPlainObject(value.variant) ||
    Array.isArray(value.options) ||
    Array.isArray(value.images);
  return (hasQuantity && (hasName || hasSku || hasProduct)) || (hasName && hasSku);
};

const DIRECT_ARRAY_KEYS = [
  'items',
  'data',
  'order_items',
  'orderItems',
  'line_items',
  'lineItems',
  'line_items_data',
  'orderLines',
  'order_lines',
  'products',
];
const NESTED_KEYS = [
  'order',
  'orderData',
  'order_data',
  'payload',
  'result',
  'results',
  'record',
  'records',
  'response',
  'cart',
  'content',
  'value',
];

/** The line-item array of an order payload, wherever Salla put it. */
export function resolveItemArray(source: unknown, depth = 0): AnyRecord[] {
  if (source === null || source === undefined || depth > 8) return [];
  if (Array.isArray(source)) return source as AnyRecord[];
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return resolveItemArray(JSON.parse(trimmed), depth + 1);
      } catch {
        return [];
      }
    }
    return [];
  }
  if (!isPlainObject(source)) return [];

  for (const key of DIRECT_ARRAY_KEYS) {
    const value = source[key];
    if (Array.isArray(value) && value.length > 0) return value as AnyRecord[];
  }
  for (const key of [...DIRECT_ARRAY_KEYS, ...NESTED_KEYS]) {
    const value: unknown = source[key];
    if (!value || value === source) continue;
    const resolved = resolveItemArray(value, depth + 1);
    if (resolved.length > 0) return resolved;
  }
  const flattened: AnyRecord[] = [];
  Object.values(source).forEach((value) => {
    if (Array.isArray(value) && value.length > 0) {
      value.forEach((entry) => {
        if (isLikelyLineItem(entry)) flattened.push(entry as AnyRecord);
      });
    } else if (isPlainObject(value) && isLikelyLineItem(value)) {
      flattened.push(value);
    }
  });
  return flattened;
}

export function collectItemOptions(item: AnyRecord): AnyRecord[] {
  const sources = [item?.options, item?.variant?.options, item?.product?.options, item?.details?.options];
  for (const source of sources) {
    if (Array.isArray(source) && source.length > 0) return source as AnyRecord[];
  }
  return [];
}

/** Options as plain { name, value } pairs, skipping empty ones. */
export function normalizeItemOptions(item: AnyRecord): Array<{ name: string; value: string }> {
  return collectItemOptions(item)
    .map((option) => ({
      name: getStringValue(option?.name ?? option?.label ?? option?.title).trim(),
      value: getStringValue(option?.value ?? option?.values ?? option?.option_value).trim(),
    }))
    .filter((option) => option.name || option.value);
}

export function getItemImage(item: AnyRecord): string | null {
  const candidates = [
    item?.product_thumbnail,
    item?.images?.[0]?.url,
    item?.images?.[0]?.src,
    item?.images?.[0]?.image,
    item?.product?.thumbnail,
    item?.product?.image,
    item?.product?.main_image,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function getItemSku(item: AnyRecord): string | null {
  const candidates = [item?.sku, item?.code, item?.product?.sku, item?.product?.code, item?.variant?.sku, item?.variant?.code];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number') return String(candidate);
  }
  return null;
}

export function getItemQuantity(item: AnyRecord): number {
  const raw = item?.quantity ?? item?.qty;
  const quantity = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
}

export const SIZE_KEYS = ['size', 'size_name', 'المقاس', 'variant_size'];
export const COLOR_KEYS = ['color', 'color_name', 'colour', 'اللون'];

/** Size or colour from wherever a Salla item carries it (fields, options, variant name). */
export function extractAttributeValue(item: AnyRecord, attributeNames: string[]): string | null {
  const normalizedKeys = attributeNames.map((name) => name.toLowerCase());
  const includesSize = normalizedKeys.some((key) => key.includes('size') || key.includes('مقاس'));
  const includesColor = normalizedKeys.some((key) => key.includes('color') || key.includes('لون'));
  const matchesKey = (key?: string | null) => {
    if (!key) return false;
    const normalized = key.toLowerCase();
    return normalizedKeys.some((target) => normalized === target || normalized.includes(target));
  };
  const normalizeValue = (value: any): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'object') return value?.name || value?.value || value?.label || null;
    return null;
  };
  const directLookup = (source: any): string | null => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    for (const key of Object.keys(source)) {
      if (matchesKey(key)) {
        const result = normalizeValue(source[key]);
        if (result) return result;
      }
    }
    return null;
  };
  const searchArray = (arr: any): string | null => {
    if (!Array.isArray(arr)) return null;
    for (const entry of arr) {
      const key =
        entry?.name ?? entry?.label ?? entry?.title ?? entry?.key ?? entry?.option ?? entry?.option_name ?? entry?.optionName ?? entry?.id ?? '';
      if (matchesKey(key?.toString())) {
        const result = normalizeValue(entry?.value ?? entry?.name ?? entry?.label);
        if (result) return result;
      }
    }
    return null;
  };

  for (const source of [item, item?.product, item?.details, item?.variant]) {
    const result = directLookup(source);
    if (result) return result;
  }
  const arraySources = [
    item?.options,
    item?.attributes,
    item?.variant?.options,
    item?.variant?.attributes,
    item?.variant?.values,
    item?.product?.options,
    item?.details?.options,
  ];
  for (const arr of arraySources) {
    const result = searchArray(arr);
    if (result) return result;
  }
  const variantName = item?.variant?.name || item?.variant?.value || item?.variant?.label || null;
  if (typeof variantName === 'string' && variantName.trim()) {
    const parts = variantName.split(/[/\-|،]/).map((part: string) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      if (includesColor) return parts[0];
      if (includesSize) return parts[parts.length - 1];
    } else if (parts.length === 1 && (includesColor || includesSize)) {
      return parts[0];
    }
  }
  return null;
}
