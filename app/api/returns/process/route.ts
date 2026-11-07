import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { buildProcessPreview, processReturnRequest } from '@/app/lib/returns/process-return';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** GET /api/returns/process?returnRequestId=… — what one-click processing will do. */
export async function GET(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const id = request.nextUrl.searchParams.get('returnRequestId');
  if (!id) return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });

  try {
    const preview = await buildProcessPreview(id);
    if (!preview) return NextResponse.json({ error: 'طلب الإرجاع غير موجود' }, { status: 404 });
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    log.error('Failed to build return processing preview', { id, error });
    return NextResponse.json({ error: 'تعذر تجهيز ملخص المعالجة' }, { status: 500 });
  }
}

/** POST /api/returns/process — approve & process: restock, refund, coupon, close. */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.returnRequestId === 'string' ? body.returnRequestId : '';
  if (!id) return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });

  const result = await processReturnRequest(id, {
    actor: staffActorName(auth.session),
    ignoreExistingRefunds: body?.ignoreExistingRefunds === true,
    confirmUnknownRestocks: body?.confirmUnknownRestocks === true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, blockers: result.blockers }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ success: true, completed: result.completed, blockers: result.blockers });
}
