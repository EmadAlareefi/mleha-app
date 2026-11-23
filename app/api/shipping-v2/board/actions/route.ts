import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { requireShippingBoardUser } from '@/app/lib/order-prep/route-auth';
import { readJson } from '@/app/lib/order-prep/route-responses';
import { closeShippingTask, retryAllFailedShippingTasks, retryShippingTask } from '@/app/lib/shipping/board';
import { sanitizeShippingSettingsPatch, updateShippingSettings } from '@/app/lib/shipping/settings';
import { invalidateStuckOrders } from '@/app/lib/stuck-orders/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { action: 'retry' | 'close', taskId }, { action: 'retry_all' } or { action: 'settings', settings }. */
export async function POST(request: Request) {
  const auth = await requireShippingBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const body = await readJson(request);
    const taskId = typeof body.taskId === 'string' ? body.taskId : '';
    switch (body.action) {
      case 'retry': {
        if (!taskId) break;
        const result = await retryShippingTask(taskId);
        log.info('Shipping board: retry', { taskId, by: auth.actor.name });
        return NextResponse.json({ success: result.ok, message: result.message });
      }
      case 'retry_all': {
        const result = await retryAllFailedShippingTasks();
        log.info('Shipping board: retry all failed', { message: result.message, by: auth.actor.name });
        return NextResponse.json({ success: true, message: result.message });
      }
      case 'close': {
        if (!taskId) break;
        const result = await closeShippingTask(taskId);
        log.info('Shipping board: close', { taskId, by: auth.actor.name });
        return NextResponse.json({ success: true, message: result.message });
      }
      case 'settings': {
        if (!auth.isPrepAdmin) {
          return NextResponse.json({ success: false, error: 'تغيير إعدادات الشحن لمشرفي التحضير فقط' }, { status: 403 });
        }
        const patch = sanitizeShippingSettingsPatch((body.settings ?? {}) as Record<string, unknown>);
        const settings = await updateShippingSettings(patch);
        log.info('Shipping board: settings', { patch, by: auth.actor.name });
        return NextResponse.json({ success: true, settings });
      }
    }
    return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });
  } catch (error) {
    log.error('Shipping board action failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تنفيذ الإجراء' }, { status: 500 });
  } finally {
    // The action may have moved an order: the stuck list must not serve the old state.
    invalidateStuckOrders();
  }
}
