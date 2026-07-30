// Normalize KSA numbers → E.164 (+966xxxxxxxxx)
export function normalizeKSA(msisdn?: string | number | null): string {
  const raw = msisdn == null ? "" : String(msisdn);
  let p = raw.replace(/\D/g, "");
  if (!p) return p;
  if (p.startsWith("00966")) p = p.replace(/^00966/, "966");
  if (p.startsWith("00")) p = p.replace(/^00/, "");
  if (p.startsWith("966")) return "+" + p;
  if (p.length === 10 && p.startsWith("05")) return "+966" + p.substring(1);
  return "+" + p;
}

/**
 * Normalize customer-entered phone numbers to a plausible E.164 value.
 *
 * Saudi mobiles are validated strictly. Other international numbers are kept
 * because the store ships abroad, but must still be 8-15 digits and cannot
 * start with zero after the leading plus.
 */
export function normalizeE164Phone(msisdn?: string | number | null): string {
  const raw = msisdn == null ? "" : String(msisdn).trim();
  const digitsOnly = raw.replace(/\D/g, "");
  let candidate = raw;

  if (!raw.startsWith("+") && /^5\d{8}$/.test(digitsOnly)) {
    candidate = `966${digitsOnly}`;
  }

  const normalized = normalizeKSA(candidate);
  if (!normalized.startsWith("+")) {
    return "";
  }

  const digits = normalized.slice(1);
  if (digits.startsWith("966")) {
    return /^9665\d{8}$/.test(digits) ? normalized : "";
  }

  return /^[1-9]\d{7,14}$/.test(digits) ? normalized : "";
}
