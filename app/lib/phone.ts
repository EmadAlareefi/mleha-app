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
