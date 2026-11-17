import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, hashIp } from '@/app/lib/public-request';
import { SESSION_COOKIE, isSameOrigin } from './access';
import { getOrderSession, type OrderSession } from './access-service';

/** Shared plumbing for the public /api/public/order-manage routes. */

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status });
  // One customer's order must never sit in a CDN or the Next data cache.
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

export const UNAVAILABLE = { error: 'هذه الخدمة غير متاحة حالياً.', code: 'unavailable' };
export const SIGNED_OUT = { error: 'انتهت الجلسة. يرجى التحقق من الطلب مرة أخرى.', code: 'signed_out' };
export const TOO_MANY = { error: 'تم استقبال عدة محاولات، يرجى المحاولة لاحقاً.', code: 'rate_limited' };

export function requestIpHash(request: NextRequest): string | null {
  return hashIp(getClientIp(request));
}

/** Null when the request did not come from one of our own pages. */
export function rejectForeignOrigin(request: NextRequest): NextResponse | null {
  if (isSameOrigin(request.headers.get('origin'), request.url)) return null;
  return jsonNoStore({ error: 'طلب غير مسموح.', code: 'forbidden' }, 403);
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function sessionFromRequest(request: NextRequest): Promise<OrderSession | null> {
  return getOrderSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
