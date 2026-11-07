import type { NextRequest } from 'next/server';

/**
 * Light per-instance limiter for public, read-only, cached catalog routes.
 * The data is the public storefront catalog, so this only stops one client
 * from hammering Salla through us; it is not a security boundary.
 */
const WINDOW_MS = 60 * 1000;
const hits = new Map<string, number[]>();

export function clientKey(request: NextRequest) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

export function isRateLimited(request: NextRequest, bucket: string, max: number): boolean {
  const key = `${bucket}:${clientKey(request)}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((at) => now - at < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return recent.length > max;
}
