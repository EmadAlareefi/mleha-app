import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { requireShippingBoardUser } from '@/app/lib/order-prep/route-auth';
import { getShippingBoard } from '@/app/lib/shipping/board';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireShippingBoardUser();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ success: true, board: await getShippingBoard(), canManageSettings: auth.isPrepAdmin });
  } catch (error) {
    log.error('Shipping board failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل لوحة الشحن' }, { status: 500 });
  }
}
