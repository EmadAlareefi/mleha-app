type GenericRecord = Record<string, any>;

const COLOR_KEYS = [
  'color',
  'colour',
  'color_name',
  'colour_name',
  'product_color',
  'item_color',
  'color_en',
  'color_ar',
  'لون',
  'اللون',
];

const SIZE_KEYS = [
  'size',
  'size_name',
  'product_size',
  'variant_size',
  'size_en',
  'size_ar',
  'مقاس',
  'المقاس',
  'قياس',
];

const normalizeValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : null;
  }
  if (typeof value === 'object') {
    const record = value as GenericRecord;
    return (
      normalizeValue(record.value) ||
      normalizeValue(record.name) ||
      normalizeValue(record.label) ||
      null
    );
  }
  return null;
};

const matchesKeyFactory = (attributeNames: string[]) => {
  const normalized = attributeNames
    .map((name) => name?.toLowerCase?.())
    .filter(Boolean) as string[];
  return (key?: string | null) => {
    if (!key) return false;
    const normalizedKey = key.toLowerCase();
    return normalized.some(
      (target) => normalizedKey === target || normalizedKey.includes(target),
    );
  };
};

const searchObject = (
  source: unknown,
  matchesKey: (key?: string | null) => boolean,
): string | null => {
  if (!source || typeof source !== 'object') {
    return null;
  }
  for (const key of Object.keys(source as GenericRecord)) {
    if (matchesKey(key)) {
      const value = normalizeValue((source as GenericRecord)[key]);
      if (value) {
        return value;
      }
    }
  }
  return null;
};

const searchArray = (
  entries: unknown,
  matchesKey: (key?: string | null) => boolean,
): string | null => {
  if (!Array.isArray(entries)) {
    return null;
  }

  for (const entry of entries) {
    if (!entry) continue;
    const record = entry as GenericRecord;
    const key =
      record?.name ??
      record?.label ??
      record?.title ??
      record?.key ??
      record?.option ??
      record?.option_name ??
      record?.optionName ??
      record?.id ??
      '';
    if (matchesKey(key?.toString())) {
      const value =
        normalizeValue(record?.value) ||
        normalizeValue(record?.name) ||
        normalizeValue(record?.label);
      if (value) {
        return value;
      }
    }
  }

  return null;
};

function extractFromVariantName(
  item: GenericRecord,
  includesColor: boolean,
  includesSize: boolean,
): string | null {
  const variantName =
    item?.variant?.name ||
    item?.variant?.value ||
    item?.variant?.label ||
    item?.variantName ||
    item?.variant_name ||
    null;

  if (!variantName || typeof variantName !== 'string') {
    return null;
  }

  const parts = variantName
    .split(/[\/\-|،]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    if (includesColor) {
      return parts[0];
    }
    if (includesSize) {
      return parts[parts.length - 1];
    }
  } else if (parts.length === 1) {
    if (includesColor || includesSize) {
      return parts[0];
    }
  }

  return null;
}

export function extractItemAttribute(
  item: unknown,
  attributeNames: string[],
): string | null {
  if (!item) {
    return null;
  }

  const normalizedKeys = attributeNames
    .map((name) => name?.toLowerCase?.())
    .filter(Boolean) as string[];
  const includesSize = normalizedKeys.some(
    (key) => key.includes('size') || key.includes('مقاس') || key.includes('قياس'),
  );
  const includesColor = normalizedKeys.some(
    (key) => key.includes('color') || key.includes('لون'),
  );
  const matchesKey = matchesKeyFactory(attributeNames);
  const record = item as GenericRecord;

  const objectSources = [
    record,
    record?.product,
    record?.details,
    record?.variant,
    record?.metadata,
    record?.attributes,
  ];

  for (const source of objectSources) {
    const result = searchObject(source, matchesKey);
    if (result) {
      return result;
    }
  }

  const arraySources = [
    record?.options,
    record?.attributes,
    record?.variant?.options,
    record?.variant?.attributes,
    record?.variant?.values,
    record?.product?.options,
    record?.details?.options,
    record?.metadata?.options,
  ];

  for (const entries of arraySources) {
    const result = searchArray(entries, matchesKey);
    if (result) {
      return result;
    }
  }

  return extractFromVariantName(record, includesColor, includesSize);
}

export const getItemColor = (
  item: unknown,
  extraKeys: string[] = [],
): string | null =>
  extractItemAttribute(item, [...COLOR_KEYS, ...extraKeys.map((key) => key.toLowerCase())]);

export const getItemSize = (
  item: unknown,
  extraKeys: string[] = [],
): string | null =>
  extractItemAttribute(item, [...SIZE_KEYS, ...extraKeys.map((key) => key.toLowerCase())]);

export const getItemAttributes = (item: unknown): { color?: string; size?: string } => {
  const color = getItemColor(item) || undefined;
  const size = getItemSize(item) || undefined;
  return { color, size };
};
