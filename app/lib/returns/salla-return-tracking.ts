type AnyRecord = Record<string, unknown>;

const TRACKING_KEYS = new Set([
  'tracking_number',
  'trackingNumber',
  'tracking_no',
  'trackingNo',
  'awb_number',
  'awbNumber',
  'awb',
  'waybill',
  'waybill_number',
  'waybillNumber',
  'consignment_number',
  'consignmentNumber',
  'barcode',
]);

const TRACKING_LINK_KEYS = new Set([
  'tracking_link',
  'trackingLink',
  'tracking_url',
  'trackingUrl',
  'tracking_page',
  'trackingPage',
  'tracking_web_url',
  'trackingWebUrl',
]);

const normalizeTrackingValue = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return null;
  }

  const normalized = value.toString().trim();
  return normalized || null;
};

const normalizeExcludedValues = (values: unknown[]) =>
  new Set(
    values
      .map(normalizeTrackingValue)
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => {
        const compact = value.replace(/\s+/g, '');
        return compact && compact !== value ? [value, compact] : [value];
      })
  );

const extractTrackingFromLink = (value: unknown) => {
  const link = normalizeTrackingValue(value);
  if (!link) {
    return null;
  }

  try {
    const url = new URL(link);
    for (const key of ['tracking_number', 'trackingNumber', 'tracking_no', 'awb_number', 'awb']) {
      const trackingNumber = normalizeTrackingValue(url.searchParams.get(key));
      if (trackingNumber) {
        return trackingNumber;
      }
    }

    return normalizeTrackingValue(url.pathname.split('/').filter(Boolean).pop());
  } catch {
    return null;
  }
};

const isUsableTrackingValue = (value: string, excludedValues: Set<string>) => {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 5) {
    return false;
  }

  return !excludedValues.has(value) && !excludedValues.has(compact);
};

const collectTrackingValues = (
  source: unknown,
  excludedValues: Set<string>,
  depth = 0
): string[] => {
  if (!source || depth > 8) {
    return [];
  }

  if (Array.isArray(source)) {
    return source.flatMap((item) => collectTrackingValues(item, excludedValues, depth + 1));
  }

  if (typeof source !== 'object') {
    return [];
  }

  const values: string[] = [];
  for (const [key, value] of Object.entries(source as AnyRecord)) {
    if (TRACKING_KEYS.has(key)) {
      const trackingNumber = normalizeTrackingValue(value);
      if (trackingNumber && isUsableTrackingValue(trackingNumber, excludedValues)) {
        values.push(trackingNumber);
      }
    }

    if (TRACKING_LINK_KEYS.has(key)) {
      const trackingNumber = extractTrackingFromLink(value);
      if (trackingNumber && isUsableTrackingValue(trackingNumber, excludedValues)) {
        values.push(trackingNumber);
      }
    }

    values.push(...collectTrackingValues(value, excludedValues, depth + 1));
  }

  return values;
};

export const extractGeneratedReturnTrackingNumber = (
  payload: unknown,
  excludedValues: unknown[] = []
) => {
  const excluded = normalizeExcludedValues(excludedValues);
  const candidates = collectTrackingValues(payload, excluded);
  return candidates[0] ?? null;
};

export const extractGeneratedReturnTrackingNumbers = (
  payload: unknown,
  excludedValues: unknown[] = []
) => {
  const excluded = normalizeExcludedValues(excludedValues);
  return Array.from(new Set(collectTrackingValues(payload, excluded)));
};
