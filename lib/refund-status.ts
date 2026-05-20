const ARABIC_NORMALIZATION_MAP: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ة: 'ه',
  ى: 'ي',
};

const DEFINITE_REFUND_TERMS = [
  'refund',
  'return',
  'restored',
  'restoring',
  'returned',
  'مسترجع',
  'مرتجع',
  'استرجاع',
  'ارجاع',
] as const;

const CANCELLED_TERMS = ['cancelled', 'canceled', 'ملغي'] as const;

function normalizeStatusValue(value: string | null | undefined): string {
  const raw = value?.trim().toLowerCase() || '';
  if (!raw) {
    return '';
  }

  const normalizedArabic = Array.from(raw)
    .map((character) => ARABIC_NORMALIZATION_MAP[character] || character)
    .join('')
    .replace(/[\u064b-\u065f\u0670]/g, '');

  return normalizedArabic.replace(/[_\-\s]+/g, '');
}

function containsAnyTerm(value: string | null | undefined, terms: readonly string[]): boolean {
  const normalized = normalizeStatusValue(value);
  if (!normalized) {
    return false;
  }

  return terms.some((term) => normalized.includes(normalizeStatusValue(term)));
}

export function isDefiniteRefundStatus(value: string | null | undefined): boolean {
  return containsAnyTerm(value, DEFINITE_REFUND_TERMS);
}

export function isCancelledStatus(value: string | null | undefined): boolean {
  return containsAnyTerm(value, CANCELLED_TERMS);
}

export function isPotentialRefundStatus(value: string | null | undefined): boolean {
  return isDefiniteRefundStatus(value) || isCancelledStatus(value);
}
