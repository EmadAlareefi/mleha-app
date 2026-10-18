import crypto from 'crypto';

/**
 * Hermes service API keys.
 *
 * Format: `hrm_<keyId>_<secret>` where `keyId` is a 16-char public lookup
 * handle and `secret` is 32 random bytes in base64url. Only
 * HMAC-SHA256(pepper, secret) is persisted, so a database leak alone does not
 * yield usable keys, and verification is constant-time.
 *
 * Kept free of Prisma imports so the rules can be unit-tested directly.
 */

export const HERMES_KEY_PREFIX = 'hrm';
const KEY_ID_LENGTH = 16;
const SECRET_BYTES = 32;
const KEY_PATTERN = /^hrm_([a-z0-9]{16})_([A-Za-z0-9_-]{43})$/;
const MIN_PEPPER_LENGTH = 32;

export class HermesConfigError extends Error {}

export function getApiKeyPepper(env: NodeJS.ProcessEnv = process.env): string {
  const pepper = env.HERMES_API_KEY_PEPPER || '';
  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new HermesConfigError(
      `HERMES_API_KEY_PEPPER must be set to at least ${MIN_PEPPER_LENGTH} characters`
    );
  }
  return pepper;
}

function randomKeyId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(KEY_ID_LENGTH);
  let out = '';
  for (const byte of bytes) {
    // 252 is the largest multiple of 36 below 256; rejecting above it keeps
    // the distribution uniform.
    if (byte >= 252) return randomKeyId();
    out += alphabet[byte % alphabet.length];
  }
  return out;
}

export function hashSecret(secret: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(secret).digest('hex');
}

export interface GeneratedApiKey {
  /** Full plaintext key. Shown once; never stored or logged. */
  apiKey: string;
  keyId: string;
  secretHash: string;
}

export function generateApiKey(pepper: string): GeneratedApiKey {
  const keyId = randomKeyId();
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  return {
    apiKey: `${HERMES_KEY_PREFIX}_${keyId}_${secret}`,
    keyId,
    secretHash: hashSecret(secret, pepper),
  };
}

export function parseApiKey(value: string | null | undefined): { keyId: string; secret: string } | null {
  if (!value) return null;
  const match = KEY_PATTERN.exec(value.trim());
  if (!match) return null;
  return { keyId: match[1], secret: match[2] };
}

export function verifySecret(secret: string, expectedHash: string, pepper: string): boolean {
  const actual = Buffer.from(hashSecret(secret, pepper), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Reads `Authorization: Bearer <key>`. Keys in query strings are never accepted. */
export function readBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export interface CredentialState {
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export type CredentialRejection = 'revoked' | 'expired';

export function credentialRejection(
  credential: CredentialState,
  now: Date = new Date()
): CredentialRejection | null {
  if (credential.revokedAt) return 'revoked';
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) return 'expired';
  return null;
}
