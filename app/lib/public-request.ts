import crypto from 'crypto';
import { NextRequest } from 'next/server';

/**
 * Primitives shared by the handful of endpoints this app exposes without a
 * session. Extracted so every public route hashes and reads the client IP the
 * same way — see `app/api/public/availability-requests/route.ts` and
 * `app/api/orders/lookup/route.ts`.
 */

/**
 * Salted SHA-256 of the client IP. Stored instead of the address itself: rate
 * limiting only needs to recognise a repeat caller, not identify them.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET || 'mleha-notify';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export function getClientIp(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null
  );
}
