import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders, corsPreflight, resolveAllowedOrigin } from '@/app/lib/public-cors';
import { getOrderManageSettings } from '@/app/lib/order-manage/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/order-manage/config
 *
 * Tells the /my-order page and the storefront button whether the feature is
 * on. Carries nothing but that one flag.
 */
export async function OPTIONS(request: NextRequest) {
  return corsPreflight(request, 'GET, OPTIONS');
}

export async function GET(request: NextRequest) {
  const settings = await getOrderManageSettings();
  const response = NextResponse.json(
    { enabled: settings.enabled },
    { headers: corsHeaders(resolveAllowedOrigin(request), 'GET, OPTIONS') },
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
