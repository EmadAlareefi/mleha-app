import { NextResponse } from 'next/server';
import { areExchangeOrdersEnabled } from '@/app/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/returns/exchange/config
 * Public: whether an exchange can become a replacement order, or is coupon only.
 */
export async function GET() {
  return NextResponse.json({ exchangeOrdersEnabled: await areExchangeOrdersEnabled() });
}
