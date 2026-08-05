import { NextResponse } from 'next/server';
import { PRODUCT_REVIEWS_WIDGET_LOADER_SOURCE } from '@/app/embed/product-reviews-widget';

export const runtime = 'nodejs';

/**
 * Salla custom-code snippet:
 * <script src="https://<app-domain>/embed/product-reviews.js"
 *         data-api="https://<app-domain>" async></script>
 */
export async function GET() {
  return new NextResponse(PRODUCT_REVIEWS_WIDGET_LOADER_SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
