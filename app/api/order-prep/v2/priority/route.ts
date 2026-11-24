import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { MERCHANT_ID } from '@/app/lib/shipping/tasks';
import { invalidateStuckOrders } from '@/app/lib/stuck-orders/cache';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_REASON = 'تم تحديده من مركز قيادة المستودع';

/**
 * «طلب مميز»: the prep queue serves flagged orders before everything else
 * (app/lib/order-prep/queue.ts reads HighPriorityOrder).
 * POST { orderId, reason? } flags; DELETE ?orderId= unflags.
 */
export async function POST(request: NextRequest) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as { orderId?: unknown; reason?: unknown } | null;
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const reason = (typeof body?.reason === 'string' && body.reason.trim()) || DEFAULT_REASON;
  if (!orderId) return NextResponse.json({ success: false, error: 'يجب تمرير رقم الطلب' }, { status: 400 });

  try {
    const order = await prisma.sallaOrder.findUnique({
      where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
      select: { orderNumber: true, customerName: true },
    });
    if (!order) return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    const data = {
      orderNumber: order.orderNumber || orderId,
      customerName: order.customerName,
      reason,
      createdById: auth.actor.id,
      createdByName: auth.actor.name,
    };
    await prisma.highPriorityOrder.upsert({
      where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId } },
      update: data,
      create: { merchantId: MERCHANT_ID, orderId, ...data },
    });
    log.info('Order flagged high priority', { orderId, by: auth.actor.name });
    return NextResponse.json({ success: true, message: 'تم تمييز الطلب، وسيُجهّز قبل غيره' });
  } catch (error) {
    log.error('Failed to flag priority order', { orderId, error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تمييز الطلب' }, { status: 500 });
  } finally {
    invalidateStuckOrders();
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  const orderId = new URL(request.url).searchParams.get('orderId')?.trim() || '';
  if (!orderId) return NextResponse.json({ success: false, error: 'يجب تمرير رقم الطلب' }, { status: 400 });

  try {
    const { count } = await prisma.highPriorityOrder.deleteMany({ where: { merchantId: MERCHANT_ID, orderId } });
    log.info('Order unflagged high priority', { orderId, by: auth.actor.name, removed: count });
    return NextResponse.json({ success: true, message: count ? 'أُلغي تمييز الطلب' : 'الطلب غير مميز أصلاً' });
  } catch (error) {
    log.error('Failed to unflag priority order', { orderId, error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر إلغاء التمييز' }, { status: 500 });
  } finally {
    invalidateStuckOrders();
  }
}
