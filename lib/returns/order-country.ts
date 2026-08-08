/**
 * Decides whether a Salla order shipped outside Saudi Arabia, which makes it
 * ineligible for return or exchange.
 *
 * Lives here rather than in the returns page because the public
 * `/api/orders/lookup` response no longer carries addresses or customer
 * details: the check now runs server-side against the full Salla order and is
 * handed to the browser as a single boolean.
 */

const SAUDI_COUNTRY_CODES = new Set(['SA', 'SAU', 'KSA']);

const SAUDI_COUNTRY_KEYWORDS_EN = [
  'saudi',
  'saudi arabia',
  'kingdom of saudi arabia',
  'ksa',
];

const SAUDI_COUNTRY_KEYWORDS_AR = [
  'السعودية',
  'السعوديه',
  'المملكة العربية السعودية',
  'المملكه العربيه السعوديه',
];

const COUNTRY_FIELD_KEYS = [
  'country',
  'country_code',
  'countryCode',
  'country_en',
  'country_ar',
  'countryArabic',
  'countryEnglish',
  'country_name',
  'countryName',
  'countryNameEn',
  'countryNameAr',
];

const normalizeCountryString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const str = String(value).trim();
  return str || undefined;
};

const isSaudiCountryValue = (value: unknown): boolean => {
  const str = normalizeCountryString(value);
  if (!str) {
    return false;
  }

  const lettersOnly = str.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (lettersOnly && SAUDI_COUNTRY_CODES.has(lettersOnly)) {
    return true;
  }

  const lower = str.toLowerCase();
  if (SAUDI_COUNTRY_KEYWORDS_EN.some(keyword => lower.includes(keyword))) {
    return true;
  }

  const arabicOnly = str.replace(/[^ء-ي]/g, '');
  if (arabicOnly && SAUDI_COUNTRY_KEYWORDS_AR.some(keyword => arabicOnly.includes(keyword.replace(/\s+/g, '')))) {
    return true;
  }

  return false;
};

const collectCountryCandidates = (source: unknown): string[] => {
  if (!source || typeof source !== 'object') {
    return [];
  }
  const candidates: string[] = [];
  for (const key of COUNTRY_FIELD_KEYS) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      candidates.push(value);
    }
  }
  return candidates;
};

export const isInternationalOrder = (order: any): boolean => {
  if (!order || typeof order !== 'object') {
    return false;
  }

  const addressCandidates: string[] = [
    ...collectCountryCandidates(order.shipping_address),
    ...collectCountryCandidates(order.shipping?.pickup_address),
    ...collectCountryCandidates(order.shipping),
    ...collectCountryCandidates(order.billing_address),
  ];

  const fallbackCandidates: string[] = [];
  if (order.customer && typeof order.customer === 'object') {
    fallbackCandidates.push(
      order.customer.country,
      order.customer.country_en,
      order.customer.country_ar,
    );
  }

  const candidateValues = addressCandidates.length > 0 ? addressCandidates : fallbackCandidates;

  for (const candidate of candidateValues) {
    if (!candidate) {
      continue;
    }

    if (isSaudiCountryValue(candidate)) {
      return false;
    }

    const normalized = normalizeCountryString(candidate);
    if (normalized) {
      return true;
    }
  }

  return false;
};
