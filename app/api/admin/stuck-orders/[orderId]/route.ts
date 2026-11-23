import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { loadOrderJourney } from '@/app/lib/stuck-orders/load';
import { parseThreshold } from '@/app/lib/stuck-orders/threshold';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → the order's diagnosis and full warehouse timeline. */
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const { orderId } = await params;
    const thresholdHours = parseThreshold(new URL(request.url).searchParams.get('threshold'));
    const journey = await loadOrderJourney(orderId.slice(0, 64), thresholdHours);
    if (!journey) return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    return NextResponse.json({ success: true, journey });
  } catch (error) {
    log.error('Stuck order journey failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل مسار الطلب' }, { status: 500 });
  }
}
