import crypto from 'crypto';

/**
 * Short-lived, per-instance cache for aggregated reports — the same
 * best-effort approach middleware.ts uses for deactivation checks; no new
 * infrastructure. Keys are SHA-256 digests of the merchant, the credential's
 * full scope set, the action and the normalised parameters, so two
 * credentials with different scopes never share an entry, and no raw value
 * (reports take no PII parameters anyway) is kept in a key.
 *
 * Lookups (orders/customers/shipments) are never cached.
 */

export const REPORT_CACHE_TTL_MS = 60_000;
const MAX_ENTRIES = 200;

interface Entry {
  expiresAt: number;
  storedAt: Date;
  value: unknown;
}

const entries = new Map<string, Entry>();

export function reportCacheKey(parts: {
  merchantId: string;
  scopes: readonly string[];
  action: string;
  params: unknown;
}): string {
  const material = JSON.stringify([
    'v1',
    parts.merchantId,
    [...parts.scopes].sort(),
    parts.action,
    parts.params,
  ]);
  return crypto.createHash('sha256').update(material).digest('hex');
}

export async function cachedReport<T>(
  key: string,
  compute: () => Promise<T>,
  options: { ttlMs?: number; now?: () => number } = {}
): Promise<{ value: T; hit: boolean; storedAt: Date }> {
  const now = options.now ?? Date.now;
  const existing = entries.get(key);
  if (existing && existing.expiresAt > now()) {
    return { value: existing.value as T, hit: true, storedAt: existing.storedAt };
  }

  const value = await compute();
  const storedAt = new Date(now());
  entries.delete(key);
  entries.set(key, { value, storedAt, expiresAt: now() + (options.ttlMs ?? REPORT_CACHE_TTL_MS) });
  // Map iteration order is insertion order, so the first key is the oldest.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return { value, hit: false, storedAt };
}

export function clearReportCache(): void {
  entries.clear();
}

export function reportCacheSize(): number {
  return entries.size;
}
