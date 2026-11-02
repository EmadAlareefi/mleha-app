import { NextResponse } from 'next/server';
import { PROMO_LIMIT_WIDGET_SOURCE } from '@/app/embed/promo-limit-widget';

export const runtime = 'nodejs';

export async function GET() {
  return new NextResponse(PROMO_LIMIT_WIDGET_SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
