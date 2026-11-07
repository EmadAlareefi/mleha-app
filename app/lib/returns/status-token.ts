import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed link to /returns/status/[id] so customers can follow their request
 * (and finish an exchange payment) from WhatsApp without re-entering details.
 */
function secret() {
  const value = process.env.RETURNS_STATUS_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error('RETURNS_STATUS_TOKEN_SECRET is not configured');
  return value;
}

export function signReturnStatusToken(returnRequestId: string): string {
  return createHmac('sha256', secret()).update(`return-status:${returnRequestId}`).digest('base64url').slice(0, 32);
}

export function verifyReturnStatusToken(returnRequestId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(signReturnStatusToken(returnRequestId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function returnStatusPath(returnRequestId: string): string | null {
  try {
    return `/returns/status/${returnRequestId}?t=${signReturnStatusToken(returnRequestId)}`;
  } catch {
    return null;
  }
}
