import { NextRequest, NextResponse } from 'next/server';

import { processDueCustomerJourneyNotifications } from '@/app/lib/customer-journey-notifications';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await processDueCustomerJourneyNotifications(50);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    log.error('Customer journey worker failed', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json({ success: false, error: 'Worker failed' }, { status: 500 });
  }
}
