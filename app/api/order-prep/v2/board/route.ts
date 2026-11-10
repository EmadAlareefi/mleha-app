import { NextResponse } from 'next/server';
import { getBoardData } from '@/app/lib/order-prep/board';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Supervisor board data (polled every 15 s). */
export async function GET() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ success: true, board: await getBoardData() });
  } catch (error) {
    log.error('Order prep board failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل اللوحة' }, { status: 500 });
  }
}
