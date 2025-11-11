import { NextRequest, NextResponse } from 'next/server';
import { refreshExpiringTokens } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * API endpoint for scheduled token refresh
 * Can be called by Vercel Cron or external cron service
 *
 * Security: Should validate authorization header in production
 */
export async function GET(request: NextRequest) {
  try {
    // Optional: Verify cron secret from environment
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      log.warn('Unauthorized token refresh attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    log.info('Starting scheduled token refresh...');
    await refreshExpiringTokens();

    return NextResponse.json({
      success: true,
      message: 'Token refresh completed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('Error in scheduled token refresh', { error });
    return NextResponse.json(
      { error: 'فشل تحديث الرموز' },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint for manual token refresh trigger
 */
export async function POST(request: NextRequest) {
  return GET(request);
}
