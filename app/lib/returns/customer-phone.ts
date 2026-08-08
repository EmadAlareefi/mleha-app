import crypto from 'crypto';
import { normalizeE164Phone, normalizePhoneWithDialCode } from '@/app/lib/phone';

/**
 * Checks that whoever is asking about an order actually owns it, by matching a
 * mobile number they supply against the order's customer.
 *
 * The public returns flow has no session, and order numbers are sequential, so
 * without this anyone can walk the range and read order contents. This is the
 * proof-of-ownership step; the per-IP budget in `/api/orders/lookup` only slows
 * a caller down.
 */

/**
 * Salla splits international numbers into a dial code and a local part, e.g.
 * `{ mobile_code: '+965', mobile: '051234567' }`. The same fallback chain is
 * used when the return request records the customer's phone.
 */
function getDialCode(customer: Record<string, any>): string | number | null | undefined {
  return (
    customer.mobile_code ??
    customer.mobileCode ??
    customer.phone_code ??
    customer.phoneCode ??
    customer.dial_code ??
    customer.dialCode ??
    customer.country_code ??
    customer.countryCode
  );
}

/**
 * Every normalized form the order's customer answers to.
 *
 * Both the dial-code-aware and the plain reading of each number are included:
 * `normalizePhoneWithDialCode` is correct for international customers, while
 * the plain `normalizeE164Phone` covers orders whose local number is already
 * fully qualified but whose dial code is missing or nonsense. Being generous
 * here costs nothing — the caller still has to know the number — whereas a
 * missed match locks a real customer out of the returns flow.
 */
export function getOrderCustomerPhones(order: unknown): string[] {
  const customer = (order as Record<string, any>)?.customer;
  if (!customer || typeof customer !== 'object') {
    return [];
  }

  const dialCode = getDialCode(customer);
  const candidates: string[] = [];

  for (const raw of [customer.mobile, customer.phone]) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      continue;
    }
    candidates.push(normalizePhoneWithDialCode(raw, dialCode));
    candidates.push(normalizeE164Phone(raw));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

/** Normalized readings of what the customer typed into the returns form. */
function normalizeSuppliedPhone(input: unknown): string[] {
  if (input === null || input === undefined) {
    return [];
  }

  const raw = String(input).trim();
  if (!raw) {
    return [];
  }

  return Array.from(new Set([normalizeE164Phone(raw)].filter(Boolean)));
}

/** Constant-time string comparison over fixed-length digests. */
function secureEquals(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

/**
 * True when `input` is one of the order customer's numbers.
 *
 * Fails closed: an order carrying no usable phone can never be matched, so a
 * customer in that situation is sent to support rather than waved through.
 */
export function orderBelongsToPhone(order: unknown, input: unknown): boolean {
  const supplied = normalizeSuppliedPhone(input);
  if (supplied.length === 0) {
    return false;
  }

  const known = getOrderCustomerPhones(order);
  if (known.length === 0) {
    return false;
  }

  // Every combination is compared so the work does not depend on where the
  // match falls.
  let matched = false;
  for (const candidate of supplied) {
    for (const value of known) {
      if (secureEquals(candidate, value)) {
        matched = true;
      }
    }
  }

  return matched;
}

/** True unless `RETURNS_REQUIRE_PHONE` is explicitly set to "false". */
export function isPhoneProofRequired(): boolean {
  return process.env.RETURNS_REQUIRE_PHONE !== 'false';
}
