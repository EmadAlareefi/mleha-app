export function sanitizeAffiliateName(value?: string | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = typeof value === 'string' ? value.trim() : String(value).trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeAffiliateName(value?: string | null): string | null {
  const sanitized = sanitizeAffiliateName(value);
  return sanitized ? sanitized.toLowerCase() : null;
}
