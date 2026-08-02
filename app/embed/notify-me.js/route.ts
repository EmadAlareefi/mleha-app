import { NextResponse } from 'next/server';
import { NOTIFY_ME_WIDGET_LOADER_SOURCE } from '@/app/embed/notify-me-widget';

export const runtime = 'nodejs';

/**
 * Serves the storefront "notify me when available" widget.
 *
 * Paste this into Salla Dashboard -> Settings -> Custom Code and scope it to
 * the single-product/details page only:
 *
 *   <script src="https://<app-domain>/embed/notify-me.js"
 *           data-api="https://<app-domain>" async></script>
 *
 * The script itself is public and contains no secrets, so it is served to any
 * origin; the endpoint it posts to is what enforces the origin allowlist.
 */
export async function GET() {
  return new NextResponse(NOTIFY_ME_WIDGET_LOADER_SOURCE, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // Always revalidate so storefront tabs do not keep an older widget after
      // a selection bug has been fixed. Conditional requests still make this
      // inexpensive when the source has not changed.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
