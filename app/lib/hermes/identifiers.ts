import crypto from 'crypto';
import { getApiKeyPepper } from './credentials';

/**
 * Opaque customer references. Salla customer ids are sequential, so the
 * summary endpoint takes a signed handle (`cus_<id>_<sig>`) instead of a bare
 * id: a guessed or incremented reference fails the signature and is answered
 * like any unknown record. The signature binds the merchant, so a reference
 * minted for one tenant is useless in another.
 */

const SIGNATURE_LENGTH = 22;
const REF_PATTERN = /^cus_(\d{1,20})_([A-Za-z0-9_-]{22})$/;

function sign(merchantId: string, customerId: string, pepper: string): string {
  return crypto
    .createHmac('sha256', pepper)
    .update(`hermes-customer-ref:${merchantId}:${customerId}`)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

export function customerRef(merchantId: string, customerId: string | null, pepper = getApiKeyPepper()): string | null {
  if (!customerId || !/^\d{1,20}$/.test(customerId)) return null;
  return `cus_${customerId}_${sign(merchantId, customerId, pepper)}`;
}

export function resolveCustomerRef(merchantId: string, ref: string, pepper = getApiKeyPepper()): string | null {
  const match = REF_PATTERN.exec(ref.trim());
  if (!match) return null;
  const expected = Buffer.from(sign(merchantId, match[1], pepper));
  const actual = Buffer.from(match[2]);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) ? match[1] : null;
}

/** All stored spellings a phone may have (webhooks store E.164, list sync stores Salla's raw value). */
export function phoneLookupVariants(e164: string): string[] {
  const digits = e164.replace(/\D/g, '');
  const variants = new Set<string>([e164, digits]);
  if (digits.startsWith('966') && digits.length === 12) {
    const local = digits.slice(3);
    variants.add(local);
    variants.add(`0${local}`);
  } else {
    // International numbers stored without their dialling code collide with
    // other countries' numbers; candidates are re-verified against the
    // order's own dialling code before being returned.
    for (const codeLength of [1, 2, 3]) {
      const local = digits.slice(codeLength);
      if (local.length >= 7) {
        variants.add(local);
        variants.add(`0${local}`);
      }
    }
  }
  return Array.from(variants);
}

export function emailLookupVariants(email: string): string[] {
  return Array.from(new Set([email, email.toLowerCase()]));
}

export function trackingVariants(trackingNumber: string): string[] {
  return Array.from(new Set([trackingNumber, trackingNumber.toUpperCase()]));
}
