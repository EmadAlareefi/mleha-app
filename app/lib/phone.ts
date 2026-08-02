function normalizeNumerals(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

// Normalize KSA numbers → E.164 (+966xxxxxxxxx)
export function normalizeKSA(msisdn?: string | number | null): string {
  const raw = msisdn == null ? "" : normalizeNumerals(String(msisdn));
  let p = raw.replace(/\D/g, "");
  if (!p) return p;
  if (p.startsWith("00966")) p = p.replace(/^00966/, "966");
  if (p.startsWith("00")) p = p.replace(/^00/, "");
  if (p.startsWith("966")) return "+" + p;
  if (p.length === 10 && p.startsWith("05")) return "+966" + p.substring(1);
  return "+" + p;
}

/**
 * Normalize a phone number using the separate dialing code supplied by Salla.
 *
 * Salla may return international customers as, for example,
 * `{ mobile_code: "+965", mobile: "051234567" }`. Passing only `mobile` to
 * `normalizeKSA` would incorrectly turn a number beginning with 05 into a
 * Saudi +966 number. An explicit country code therefore takes precedence over
 * the Saudi fallback, while already-qualified +/00 numbers remain unchanged.
 */
export function normalizePhoneWithDialCode(
  msisdn?: string | number | null,
  dialCode?: string | number | null
): string {
  const raw = msisdn == null ? "" : normalizeNumerals(String(msisdn)).trim();
  if (!raw) return "";

  const rawDigits = raw.replace(/\D/g, "");
  if (!rawDigits) return "";

  if (raw.startsWith("+") || rawDigits.startsWith("00")) {
    return normalizeE164Phone(raw);
  }

  const codeDigits =
    dialCode == null
      ? ""
      : normalizeNumerals(String(dialCode)).replace(/\D/g, "").replace(/^00/, "");

  // Ignore ISO country values such as "SA"; only numeric calling codes can be
  // safely combined with a local number.
  if (!/^[1-9]\d{0,3}$/.test(codeDigits)) {
    return normalizeE164Phone(raw);
  }

  const includesDialCode =
    rawDigits.startsWith(codeDigits) && rawDigits.length >= codeDigits.length + 7;
  const international = includesDialCode
    ? rawDigits
    : `${codeDigits}${rawDigits.replace(/^0+/, "")}`;

  return normalizeE164Phone(`+${international}`);
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
