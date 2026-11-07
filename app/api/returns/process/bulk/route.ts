import { NextRequest, NextResponse } from 'next/server';
import { buildProcessPreview, processReturnRequest } from '@/app/lib/returns/process-return';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;
const MAX_BULK = 20;
/**
 * Stop starting new requests after this long, so the one in flight can still
 * finish inside maxDuration (a request can take ~2 min when Salla is slow).
 * A function killed mid-request would leave it locked in `processing`.
 */
const START_BUDGET_MS = 150_000;

/**
 * POST /api/returns/process/bulk { returnRequestIds: string[] }
 * Processes ready requests one after another. Requests whose preview has
 * warnings are skipped so a person looks at them individually.
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.returnRequestIds)
    ? Array.from(new Set<string>(body.returnRequestIds.filter((id: unknown) => typeof id === 'string')))
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'لم يتم تحديد أي طلب' }, { status: 400 });
  if (ids.length > MAX_BULK) {
    return NextResponse.json({ error: `الحد الأقصى ${MAX_BULK} طلب في كل مرة` }, { status: 400 });
  }

  const actor = staffActorName(auth.session);
  const startedAt = Date.now();
  const results: Array<{ id: string; outcome: 'completed' | 'needs_attention' | 'skipped' | 'failed'; message?: string }> = [];
  for (const id of ids) {
    if (Date.now() - startedAt > START_BUDGET_MS) {
      results.push({ id, outcome: 'skipped', message: 'انتهى وقت الدفعة، أعيدي تشغيلها للطلبات المتبقية' });
      continue;
    }
    const preview = await buildProcessPreview(id).catch(() => null);
    if (!preview || preview.stage !== 'ready') {
      results.push({ id, outcome: 'skipped', message: preview?.notReadyReason || 'غير جاهز' });
      continue;
    }
    if (preview.warnings.length > 0) {
      results.push({ id, outcome: 'skipped', message: preview.warnings.join(' • ') });
      continue;
    }
    const result = await processReturnRequest(id, { actor });
    results.push({
      id,
      outcome: !result.ok ? 'failed' : result.completed ? 'completed' : 'needs_attention',
      message: result.error || result.blockers.join(' • ') || undefined,
    });
  }

  return NextResponse.json({ success: true, results });
}
