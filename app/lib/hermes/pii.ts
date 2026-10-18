/**
 * PII presentation and log redaction for the Hermes API.
 *
 * Support credentials see contact details masked; they already hold the full
 * value when they searched by it, so masking costs them nothing while keeping
 * conversation transcripts (WhatsApp/Telegram) free of complete identifiers.
 */

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) return '***';
  const prefix = trimmed.startsWith('+') ? `+${digits.slice(0, 3)}` : digits.slice(0, 2);
  return `${prefix}${'*'.repeat(Math.max(digits.length - (prefix.replace('+', '').length + 2), 3))}${digits.slice(-2)}`;
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.trim().split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${visible}***@${domain}`;
}

export function presentPhone(phone: string | null | undefined, fullPii: boolean): string | null {
  if (!phone) return null;
  return fullPii ? phone : maskPhone(phone);
}

export function presentEmail(email: string | null | undefined, fullPii: boolean): string | null {
  if (!email) return null;
  return fullPii ? email : maskEmail(email);
}

const SENSITIVE_KEY = /(authorization|api[-_]?key|secret|token|password|pepper|cookie|phone|mobile|email|address|name)/i;

/**
 * Deep-copies `value` replacing sensitive keys and PII-shaped strings, for
 * structured logs. Used on anything derived from a request before logging.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[truncated]';
  if (typeof value === 'string') {
    return value
      .replace(/hrm_[a-z0-9]{16}_[A-Za-z0-9_-]{20,}/g, 'hrm_[redacted]')
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
      .replace(/\+?\d[\d\s-]{7,}\d/g, '[number]');
  }
  if (Array.isArray(value)) return value.map((entry) => redactForLog(entry, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactForLog(value.message, depth + 1) };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactForLog(entry, depth + 1);
    }
    return out;
  }
  return value;
}
