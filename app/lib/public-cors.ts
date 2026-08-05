import { NextRequest, NextResponse } from 'next/server';

/**
 * CORS handling for the small number of endpoints the mleha.com storefront calls
 * directly from a customer's browser. Everything else in this app is same-origin
 * and must not go through here.
 */

const DEFAULT_ALLOWED_ORIGINS = ['https://mleha.com', 'https://www.mleha.com'];

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

export function getAllowedOrigins(): string[] {
  const configured = (process.env.NOTIFY_WIDGET_ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter((origin) => origin.length > 0);

  const origins = new Set(
    (configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS).map(normalizeOrigin)
  );

  // Local development convenience: only ever added outside production.
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return Array.from(origins);
}

/**
 * Returns the request's Origin when it is allowlisted, otherwise null.
 * A missing Origin header also yields null — the widget always sends one, so a
 * request without it is not the widget.
 */
export function resolveAllowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (!origin) {
    return null;
  }
  return getAllowedOrigins().includes(normalizeOrigin(origin)) ? origin : null;
}

export function corsHeaders(
  origin: string | null,
  allowedMethods = 'POST, OPTIONS'
): Record<string, string> {
  const headers: Record<string, string> = {
    // Always vary on Origin: the response body is shared but these headers are not,
    // and a cache that ignores this would hand one store's headers to another origin.
    Vary: 'Origin',
  };

  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = allowedMethods;
    headers['Access-Control-Allow-Headers'] = 'content-type';
    headers['Access-Control-Max-Age'] = '86400';
  }

  return headers;
}

export function corsJson(
  body: unknown,
  init: { status?: number; origin: string | null; allowedMethods?: string }
): NextResponse {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: corsHeaders(init.origin, init.allowedMethods),
  });
}

/** Standard preflight response for an allowlisted public endpoint. */
export function corsPreflight(
  request: NextRequest,
  allowedMethods = 'POST, OPTIONS'
): NextResponse {
  const origin = resolveAllowedOrigin(request);
  return new NextResponse(null, {
    status: origin ? 204 : 403,
    headers: corsHeaders(origin, allowedMethods),
  });
}
