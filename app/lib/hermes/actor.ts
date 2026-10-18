import crypto from 'crypto';

/**
 * Employee context forwarded by the Hermes gateway.
 *
 * Trust boundary: these headers are AUDIT CONTEXT ONLY. They never widen or
 * narrow what a request may read — that comes solely from the credential's
 * scopes. When HERMES_GATEWAY_SIGNING_SECRET is configured and the gateway
 * signs the headers, the audit row records `actorVerified = true`; otherwise
 * the values are stored as unverified claims.
 *
 * Signature: hex HMAC-SHA256(secret, `${timestamp}.${actorId}.${channel}.${requestPath}`)
 * in `X-Hermes-Actor-Signature`, with unix seconds in `X-Hermes-Actor-Timestamp`.
 */

export const ACTOR_SIGNATURE_MAX_SKEW_SECONDS = 300;
const SAFE_VALUE = /^[A-Za-z0-9_.:@+-]{1,64}$/;
const CHANNELS = new Set(['whatsapp', 'telegram', 'dashboard', 'api']);

export interface HermesActor {
  actorId: string | null;
  channel: string | null;
  verified: boolean;
}

function safe(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return SAFE_VALUE.test(trimmed) ? trimmed : null;
}

export function signActor(
  secret: string,
  parts: { timestamp: string; actorId: string; channel: string; path: string }
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${parts.timestamp}.${parts.actorId}.${parts.channel}.${parts.path}`)
    .digest('hex');
}

export function readActor(
  headers: Headers,
  path: string,
  options: { secret?: string | null; now?: Date } = {}
): HermesActor {
  const actorId = safe(headers.get('x-hermes-actor-id'));
  const rawChannel = safe(headers.get('x-hermes-actor-channel'))?.toLowerCase() ?? null;
  const channel = rawChannel && CHANNELS.has(rawChannel) ? rawChannel : null;

  const secret = options.secret ?? process.env.HERMES_GATEWAY_SIGNING_SECRET ?? '';
  const signature = headers.get('x-hermes-actor-signature')?.trim() ?? '';
  const timestamp = headers.get('x-hermes-actor-timestamp')?.trim() ?? '';

  let verified = false;
  if (secret && actorId && channel && /^[0-9a-f]{64}$/.test(signature) && /^\d{1,12}$/.test(timestamp)) {
    const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
    if (Math.abs(now - Number(timestamp)) <= ACTOR_SIGNATURE_MAX_SKEW_SECONDS) {
      const expected = Buffer.from(signActor(secret, { timestamp, actorId, channel, path }), 'hex');
      const actual = Buffer.from(signature, 'hex');
      verified = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
  }

  return { actorId, channel, verified };
}
