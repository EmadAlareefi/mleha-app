// Phone normalization for outbound messaging (WhatsApp/SMS) and lookups.
//
// These helpers return "" whenever a number can't be confidently resolved
// to E.164. Callers must treat "" as "no phone" and skip sending — guessing
// a country code is how order notifications end up on strangers' phones.

// E.164 national-significant digits: 8–15 digits, no leading zero.
const E164_DIGITS = /^[1-9]\d{7,14}$/;

export function isE164(value?: string | null): boolean {
  return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value);
}

// Normalize KSA numbers → E.164 (+9665xxxxxxxx)
export function normalizeKSA(msisdn?: string | number | null): string {
  const raw = msisdn == null ? "" : String(msisdn);
  let p = raw.replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("966")) {
    // Tolerate a stray 0 kept after the country code (9660512345678)
    const rest = p.slice(3).replace(/^0/, "");
    const full = "966" + rest;
    return rest.length <= 10 && E164_DIGITS.test(full) ? "+" + full : "";
  }
  if (p.length === 10 && p.startsWith("05")) return "+966" + p.slice(1);
  // Salla often sends the mobile as a bare number, dropping the leading 0
  if (p.length === 9 && p.startsWith("5")) return "+966" + p;
  // Long enough to already carry its own country code (e.g. 9715xxxxxxxx)
  if (p.length >= 11 && E164_DIGITS.test(p)) return "+" + p;
  return "";
}

// Salla webhooks split a customer's phone into a national `mobile` (often a
// bare number, so the leading 0 is lost) and a `mobile_code` dial code.
// Combine them when the dial code is present; otherwise fall back to the
// KSA heuristics above.
export function normalizeCustomerPhone(
  mobile?: string | number | null,
  dialCode?: string | number | null
): string {
  const national = (mobile == null ? "" : String(mobile)).replace(/\D/g, "");
  if (!national) return "";
  const code = (dialCode == null ? "" : String(dialCode))
    .replace(/\D/g, "")
    .replace(/^0+/, "");
  if (code) {
    const local = national.replace(/^0+/, "");
    // Some payloads repeat the dial code inside the number itself
    const full =
      local.startsWith(code) && local.length >= code.length + 7
        ? local
        : code + local;
    return E164_DIGITS.test(full) ? "+" + full : "";
  }
  return normalizeKSA(national);
}
