import { NextResponse, after } from 'next/server';
import {
  dismissSync,
  processSyncJobsNow,
  releasePackerClaims,
  requeueEscalation,
  resolveEscalation,
  retrySync,
  saveSettings,
  type BoardActionResult,
} from '@/app/lib/order-prep/board';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : null);

/** Supervisor actions on the board. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  const { actor } = auth;
  try {
    const body = await readJson(request);
    let result: BoardActionResult & { settings?: unknown };
    switch (body.action) {
      case 'release_packer': {
        const userId = id(body.userId);
        result = userId ? await releasePackerClaims(userId, actor) : { ok: false, error: 'userId مطلوب' };
        break;
      }
      case 'requeue_escalation': {
        const escalationId = id(body.escalationId);
        result = escalationId ? await requeueEscalation(escalationId, actor) : { ok: false, error: 'escalationId مطلوب' };
        break;
      }
      case 'resolve_escalation': {
        const escalationId = id(body.escalationId);
        const resolution = body.resolution === 'refunded' ? 'refunded' : 'handled';
        result = escalationId ? await resolveEscalation(escalationId, resolution, actor) : { ok: false, error: 'escalationId مطلوب' };
        break;
      }
      case 'retry_sync': {
        const jobId = id(body.jobId);
        result = jobId ? await retrySync(jobId) : { ok: false, error: 'jobId مطلوب' };
        break;
      }
      case 'dismiss_sync': {
        const jobId = id(body.jobId);
        result = jobId ? await dismissSync(jobId) : { ok: false, error: 'jobId مطلوب' };
        break;
      }
      case 'save_settings': {
        const patch = body.settings && typeof body.settings === 'object' ? (body.settings as Record<string, unknown>) : {};
        result = await saveSettings(patch);
        break;
      }
      default:
        result = { ok: false, error: 'إجراء غير معروف' };
    }
    if (result.ok && result.syncJobIds?.length) {
      const jobIds = result.syncJobIds;
      after(() => processSyncJobsNow(jobIds));
    }
    if (result.ok) log.info('Order prep board action', { action: body.action, by: actor.name });
    return NextResponse.json(result.ok ? { success: true, ...result } : { success: false, error: result.error }, {
      status: result.ok ? 200 : 400,
    });
  } catch (error) {
    log.error('Order prep board action failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تنفيذ الإجراء' }, { status: 500 });
  }
}
