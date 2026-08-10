import { NextRequest, NextResponse } from 'next/server';
import { resolvePublishedNotifyMeScript } from '@/app/lib/notify-me-script';

export const runtime = 'nodejs';

/**
 * Full storefront widget. The small /embed/notify-me.js loader requests this
 * endpoint only after Salla declares the current page to be a single product.
 */
export async function GET(request: NextRequest) {
  const script = await resolvePublishedNotifyMeScript();
  const etag = `"notify-me-${script.checksum}"`;
  const headers = {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'X-Notify-Me-Version': String(script.version),
  };

  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return new NextResponse(script.source, {
    status: 200,
    headers,
  });
}
