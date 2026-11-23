import { NextResponse, after } from 'next/server';
import { log } from '@/app/lib/logger';
import {
  dismissSync,
  processSyncJobsNow,
  requeueEscalation,
  resolveEscalation,
  retrySync,
} from '@/app/lib/order-prep/board';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { closeShippingTask, retryShippingTask } from '@/app/lib/shipping/board';
import type { StuckAction } from '@/app/lib/stuck-orders/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Outcome = { ok: boolean; message: string; syncJobIds?: string[] };

/** POST { action, targetId } — the same supervisor actions as the prep and shipping boards. */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  const { actor } = auth;
  try {
    const body = await readJson(request);
    const action = body.action as StuckAction;
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim().slice(0, 64) : '';
    if (!targetId) return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });

    let outcome: Outcome;
    switch (action) {
      case 'requeue_escalation': {
        const result = await requeueEscalation(targetId, actor);
        outcome = result.ok ? { ok: true, message: 'أُعيد الطلب للتجهيز', syncJobIds: result.syncJobIds } : { ok: false, message: result.error };
        break;
      }
      case 'resolve_escalation': {
        const result = await resolveEscalation(targetId, 'handled', actor);
        outcome = result.ok ? { ok: true, message: 'أُغلق الإيقاف' } : { ok: false, message: result.error };
        break;
      }
      case 'retry_sync': {
        const result = await retrySync(targetId);
        outcome = result.ok ? { ok: true, message: 'تم تحديث سلة' } : { ok: false, message: result.error };
        break;
      }
      case 'dismiss_sync': {
        await dismissSync(targetId);
        outcome = { ok: true, message: 'تم تجاهل التحديث' };
        break;
      }
      case 'retry_task': {
        const result = await retryShippingTask(targetId);
        outcome = { ok: result.ok, message: result.message };
        break;
      }
      case 'close_task': {
        const result = await closeShippingTask(targetId);
        outcome = { ok: true, message: result.message };
        break;
      }
      default:
        return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });
    }

    if (outcome.ok && outcome.syncJobIds?.length) {
      const jobIds = outcome.syncJobIds;
      after(() => processSyncJobsNow(jobIds));
    }
    log.info('Stuck orders action', { action, targetId, ok: outcome.ok, by: actor.name });
    return NextResponse.json(
      outcome.ok ? { success: true, message: outcome.message } : { success: false, error: outcome.message },
      { status: outcome.ok ? 200 : 400 },
    );
  } catch (error) {
    log.error('Stuck orders action failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تنفيذ الإجراء' }, { status: 500 });
  }
}
