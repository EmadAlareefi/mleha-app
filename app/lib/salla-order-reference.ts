/**
 * Validation and verification for Salla order reference numbers (the
 * customer-facing "رقم الطلب").
 *
 * This module exists because Salla's `GET /orders?reference_id=` filter is
 * typed as an integer: when it is handed a value it cannot parse, it drops the
 * filter and answers with the store's *unfiltered* order list, newest first.
 * Any caller that trusts `data[0]` therefore hands out the store's most recent
 * order for an arbitrary input string. The fix is to never trust the upstream
 * filter and to re-check the match locally, which is what
 * `findOrderMatchingReference` is for.
 *
 * Kept deliberately free of imports so the rules can be unit-tested without
 * pulling in Prisma or the Salla OAuth client. The reference-key spread below
 * mirrors `extractReferenceId`/`extractOrderNumber` in `./salla-orders.ts`,
 * which cannot be reused here because that module reaches for the database.
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Zero-width joiners, bidi marks and the BOM. Customers paste order numbers out
 * of WhatsApp and email, which is where these ride along. Built from code points
 * rather than written literally so the class stays visible to whoever reads this.
 */
const INVISIBLE_CODE_POINTS = [
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff,
];

/** Longest reference we will forward upstream. Salla references are ~10 digits. */
const MAX_REFERENCE_LENGTH = 20;

/**
 * Folds Arabic-Indic and Persian digits to ASCII and strips invisible
 * characters. Digit folding mirrors `normalizeNumerals` in `./phone.ts`.
 */
function foldToAsciiDigits(value: string): string {
  let out = '';

  for (const char of value) {
    const code = char.codePointAt(0)!;

    if (INVISIBLE_CODE_POINTS.includes(code)) {
      continue;
    }
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
      continue;
    }
    if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
      continue;
    }
    out += char;
  }

  return out;
}

/**
 * Normalizes a user-supplied order reference, or returns null when the value
 * cannot be one.
 *
 * Accepts the shapes customers actually type — Arabic-Indic digits, a leading
 * `#`, spaces or dashes as separators — and rejects everything else. Leading
 * zeros are preserved: they are part of the identifier, not formatting.
 */
export function normalizeOrderReference(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return null;
  }

  const cleaned = foldToAsciiDigits(String(input))
    .trim()
    .replace(/^#/, '')
    .replace(/[\s\-_.]/g, '');

  if (!/^\d+$/.test(cleaned) || cleaned.length > MAX_REFERENCE_LENGTH) {
    return null;
  }

  return cleaned;
}

const REFERENCE_KEYS = [
  'reference_id',
  'referenceId',
  'reference',
  'order_number',
  'orderNumber',
] as const;

/**
 * Every reference a Salla order answers to, normalized. Deliberately excludes
 * the internal `id`: this is a lookup by customer-facing number, and matching
 * on `id` would widen it to Salla's internal identifier space.
 */
function collectOrderReferences(order: unknown): string[] {
  if (!order || typeof order !== 'object') {
    return [];
  }

  const record = order as Record<string, unknown>;
  const references: string[] = [];

  for (const key of REFERENCE_KEYS) {
    const normalized = normalizeOrderReference(record[key] as string | number);
    if (normalized) {
      references.push(normalized);
    }
  }

  return references;
}

/**
 * True when `order` genuinely carries the reference that was asked for.
 *
 * `wanted` is normalized here as well, so callers may pass raw input.
 */
export function orderMatchesReference(order: unknown, wanted: unknown): boolean {
  const target = normalizeOrderReference(wanted);
  if (!target) {
    return false;
  }
  return collectOrderReferences(order).includes(target);
}

/**
 * Picks the order carrying `wanted` out of a Salla search response.
 *
 * Scans the whole array rather than taking `data[0]`, and returns null when
 * nothing matches — so a response that ignored the upstream filter yields a
 * miss instead of an unrelated customer's order.
 */
export function findOrderMatchingReference<T>(
  orders: readonly T[] | null | undefined,
  wanted: unknown
): T | null {
  const target = normalizeOrderReference(wanted);
  if (!target || !Array.isArray(orders)) {
    return null;
  }

  return orders.find((order) => orderMatchesReference(order, target)) ?? null;
}
