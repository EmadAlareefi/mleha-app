/**
 * Scopes for the read-only Hermes assistant API. Authorization is decided
 * only from the scopes stored on the authenticated credential — never from
 * request fields, headers forwarded by the gateway, or instructions given to
 * the model.
 *
 * Scopes do not imply one another: a manager credential that should also do
 * support lookups is issued with both scopes explicitly.
 */
export const HERMES_SCOPES = {
  SUPPORT_READ: 'hermes:support:read',
  MANAGER_REPORTS: 'hermes:manager:reports',
  MANAGER_PII: 'hermes:manager:pii',
  SALLA_READ: 'hermes:salla:read',
  SALLA_WRITE: 'hermes:salla:write',
} as const;

export type HermesScope = (typeof HERMES_SCOPES)[keyof typeof HERMES_SCOPES];

export const ALL_HERMES_SCOPES: readonly HermesScope[] = Object.values(HERMES_SCOPES);

export function isHermesScope(value: unknown): value is HermesScope {
  return typeof value === 'string' && (ALL_HERMES_SCOPES as readonly string[]).includes(value);
}

/** Keeps only recognised scopes, de-duplicated and sorted for stable cache keys. */
export function normalizeScopes(values: readonly unknown[] | null | undefined): HermesScope[] {
  const scopes = new Set<HermesScope>();
  for (const value of values ?? []) {
    if (isHermesScope(value)) scopes.add(value);
  }
  return Array.from(scopes).sort();
}

export function hasScope(scopes: readonly string[], scope: HermesScope): boolean {
  return scopes.includes(scope);
}

/** True when PII may be returned unmasked to this credential. */
export function canSeeFullPii(scopes: readonly string[]): boolean {
  return hasScope(scopes, HERMES_SCOPES.MANAGER_PII);
}
