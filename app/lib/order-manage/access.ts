import crypto from 'crypto';

/**
 * Sign-in for /my-order: order number + the order's mobile, then a one-time
 * code sent to that mobile, then a short session. Pure helpers only; the
 * database and messaging live in access-service.ts.
 *
 * Deliberately stricter than the delivery OTP it resembles: codes are stored
 * as an HMAC (a leaked table cannot be brute-forced offline), attempts are
 * capped, and the comparison is constant-time.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_GAP_MS = 60_000;
export const SESSION_TTL_MS = 30 * 60_000;
export const SESSION_COOKIE = 'mleha_order_session';

/** Sends allowed per order and per caller. */
export const SEND_LIMITS = { perOrderPerHour: 3, perOrderPerDay: 6, perIpPerHour: 10 } as const;

export type AccessChannel = 'whatsapp' | 'sms';

function secret(env: Record<string, string | undefined>): string {
  const value = env.ORDER_MANAGE_SECRET || env.NEXTAUTH_SECRET;
  // Never fall back to a constant: codes hashed with a known key are guessable.
  if (!value) throw new Error('ORDER_MANAGE_SECRET or NEXTAUTH_SECRET must be set');
  return value;
}

export function generateCode(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

/** Latin digits only, so a code typed with an Arabic keyboard still matches. */
export function normalizeCode(input: unknown): string {
  if (typeof input !== 'string' && typeof input !== 'number') return '';
  return String(input)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
}

/** Bound to the access row, so a code is only good for the request that issued it. */
export function hashCode(code: string, accessId: string, env: Record<string, string | undefined> = process.env): string {
  return crypto.createHmac('sha256', secret(env)).update(`order-manage-code:${accessId}:${code}`).digest('hex');
}

export function codeMatches(
  code: string,
  accessId: string,
  storedHash: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const candidate = Buffer.from(hashCode(code, accessId, env), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Only the hash is stored; the token itself lives in the customer's cookie. */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export type CodeRow = { attempts: number; codeExpiresAt: Date; verifiedAt: Date | null; revokedAt: Date | null };

/** Whether a stored code may still be tried, before its value is even looked at. */
export function codeRowUsable(row: CodeRow, now: Date): boolean {
  return !row.verifiedAt && !row.revokedAt && row.codeExpiresAt.getTime() > now.getTime() && row.attempts < CODE_MAX_ATTEMPTS;
}

export type SessionRow = { verifiedAt: Date | null; revokedAt: Date | null; sessionExpiresAt: Date | null };

export function sessionRowValid(row: SessionRow, now: Date): boolean {
  return Boolean(row.verifiedAt) && !row.revokedAt && Boolean(row.sessionExpiresAt) && row.sessionExpiresAt!.getTime() > now.getTime();
}

export type SendCounts = { orderLastHour: number; orderLastDay: number; ipLastHour: number; msSinceLastSend: number | null };

export type SendDecision = { allowed: true } | { allowed: false; reason: 'wait' | 'limit'; retryAfterSeconds: number };

/** Throttle for sending codes: one a minute, a few an hour per order, a few more per caller. */
export function decideSend(counts: SendCounts): SendDecision {
  if (counts.msSinceLastSend !== null && counts.msSinceLastSend < CODE_RESEND_GAP_MS) {
    return { allowed: false, reason: 'wait', retryAfterSeconds: Math.ceil((CODE_RESEND_GAP_MS - counts.msSinceLastSend) / 1000) };
  }
  if (
    counts.orderLastHour >= SEND_LIMITS.perOrderPerHour ||
    counts.orderLastDay >= SEND_LIMITS.perOrderPerDay ||
    counts.ipLastHour >= SEND_LIMITS.perIpPerHour
  ) {
    return { allowed: false, reason: 'limit', retryAfterSeconds: 3600 };
  }
  return { allowed: true };
}

/**
 * State-changing requests must come from our own pages. Browsers always send
 * `Origin` on a cross-site POST, so a missing or foreign one is refused.
 */
export function isSameOrigin(originHeader: string | null, requestUrl: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!originHeader) return false;
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(requestUrl).origin);
  } catch {
    // An unparseable request URL allows nothing.
  }
  for (const base of [env.NEXTAUTH_URL, env.NEXT_PUBLIC_APP_URL]) {
    if (!base) continue;
    try {
      allowed.add(new URL(base).origin);
    } catch {
      // Ignore a malformed base URL.
    }
  }
  return allowed.has(originHeader);
}
