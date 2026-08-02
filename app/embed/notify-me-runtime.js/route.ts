import { NextResponse } from 'next/server';
import { NOTIFY_ME_WIDGET_SOURCE } from '@/app/embed/notify-me-widget';

export const runtime = 'nodejs';

/**
 * Full storefront widget. The small /embed/notify-me.js loader requests this
 * endpoint only after Salla declares the current page to be a single product.
 */
export async function GET() {
  return new NextResponse(NOTIFY_ME_WIDGET_SOURCE, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
