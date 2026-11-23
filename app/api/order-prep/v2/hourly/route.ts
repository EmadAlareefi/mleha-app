import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { getHourlyThroughput } from '@/app/lib/order-prep/hourly';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Today's placed / packed / printed per Riyadh hour, with yesterday for comparison. */
export async function GET() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ success: true, hourly: await getHourlyThroughput() });
  } catch (error) {
    log.error('Hourly throughput failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل الإنتاجية بالساعة' }, { status: 500 });
  }
}
