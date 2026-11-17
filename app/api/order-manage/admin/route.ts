import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { loadOrderManageBoard } from '@/app/lib/order-manage/board';
import { productionEngineDeps } from '@/app/lib/order-manage/engine-deps';
import { sanitizeOrderManageSettingsPatch, updateOrderManageSettings } from '@/app/lib/order-manage/settings';
import {
  markRefundDone,
  markRefundNotSent,
  resolveUnknownCancel,
  retryRefundViaSalla,
  type StaffResult,
} from '@/app/lib/order-manage/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET: the supervisor board for customer order changes. */
export async function GET() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json({ success: true, board: await loadOrderManageBoard() });
  } catch (error) {
    log.error('Order-manage board failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل اللوحة' }, { status: 500 });
  }
}

/**
 * POST { action, changeId } or { action: 'settings', settings }.
 * Actions: resolve_cancel, refund_done, refund_not_sent, refund_retry.
 */
export async function POST(request: Request) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    if (body.action === 'settings') {
      const patch = sanitizeOrderManageSettingsPatch((body.settings ?? {}) as Record<string, unknown>);
      const settings = await updateOrderManageSettings(patch);
      log.info('Order-manage board: settings', { patch, by: auth.actor.name });
      return NextResponse.json({ success: true, settings });
    }

    const changeId = typeof body.changeId === 'string' ? body.changeId : '';
    if (!changeId) return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });
    const deps = productionEngineDeps;
    let result: StaffResult;
    switch (body.action) {
      case 'resolve_cancel':
        result = await resolveUnknownCancel(deps, changeId, auth.actor.name);
        break;
      case 'refund_done':
        result = await markRefundDone(deps, changeId, auth.actor.name);
        break;
      case 'refund_not_sent':
        result = await markRefundNotSent(deps, changeId, auth.actor.name);
        break;
      case 'refund_retry':
        result = await retryRefundViaSalla(deps, changeId);
        break;
      default:
        return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });
    }
    log.info('Order-manage board action', { action: body.action, changeId, ok: result.ok, by: auth.actor.name });
    return NextResponse.json({ success: result.ok, message: result.message, ...(result.ok ? {} : { error: result.message }) });
  } catch (error) {
    log.error('Order-manage board action failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تنفيذ الإجراء' }, { status: 500 });
  }
}
