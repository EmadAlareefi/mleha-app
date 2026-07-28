import { NextResponse } from 'next/server';
import { NOTIFY_ME_WIDGET_SOURCE } from '@/app/embed/notify-me-widget';

export const runtime = 'nodejs';

/**
 * Serves the storefront "notify me when available" widget.
 *
 * Paste this into Salla Dashboard -> Settings -> Custom Code (product pages):
 *
 *   <script src="https://<app-domain>/embed/notify-me.js"
 *           data-api="https://<app-domain>" defer></script>
 *
 * The script itself is public and contains no secrets, so it is served to any
 * origin; the endpoint it posts to is what enforces the origin allowlist.
 */
export async function GET() {
  return new NextResponse(NOTIFY_ME_WIDGET_SOURCE, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
