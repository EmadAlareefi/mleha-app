import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { requireBoardUser } from '@/app/lib/order-prep/route-auth';
import { NEW_ORDER_STATUS_ID } from '@/app/lib/order-prep/sync-rules';
import { MERCHANT_ID } from '@/app/lib/shipping/tasks';
import { invalidateStuckOrders } from '@/app/lib/stuck-orders/cache';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_REASON = 'تم تحديده من مركز قيادة المستودع';

/**
 * «طلب مميز»: the prep queue serves flagged orders before everything else
 * (app/lib/order-prep/queue.ts reads HighPriorityOrder).
 * GET lists flagged orders still waiting for prep;
 * POST { orderId | orderNumber, reason? } flags; DELETE ?orderId= unflags.
 */
export async function GET() {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  try {
    const flagged = await prisma.highPriorityOrder.findMany({
      where: { merchantId: MERCHANT_ID },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { orderId: true, orderNumber: true, customerName: true, reason: true, createdByName: true, createdAt: true },
    });
    const waiting = new Set(
      (
        await prisma.sallaOrder.findMany({
          where: { merchantId: MERCHANT_ID, orderId: { in: flagged.map((row) => row.orderId) }, statusCustomId: NEW_ORDER_STATUS_ID },
          select: { orderId: true },
        })
      ).map((row) => row.orderId),
    );
    return NextResponse.json({ success: true, orders: flagged.filter((row) => waiting.has(row.orderId)).slice(0, 100) });
  } catch (error) {
    log.error('Failed to list priority orders', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'تعذر تحميل الطلبات المميزة' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireBoardUser();
  if ('response' in auth) return auth.response;
  const body = (await request.json().catch(() => null)) as { orderId?: unknown; orderNumber?: unknown; reason?: unknown } | null;
  const givenId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const givenNumber = typeof body?.orderNumber === 'string' ? body.orderNumber.trim().replace(/^#/, '').slice(0, 64) : '';
  const reason = (typeof body?.reason === 'string' && body.reason.trim().slice(0, 200)) || DEFAULT_REASON;
  if (!givenId && !givenNumber) return NextResponse.json({ success: false, error: 'يجب تمرير رقم الطلب' }, { status: 400 });

  let orderId = givenId;
  try {
    const order = givenId
      ? await prisma.sallaOrder.findUnique({
          where: { merchantId_orderId: { merchantId: MERCHANT_ID, orderId: givenId } },
          select: { orderId: true, orderNumber: true, customerName: true, statusCustomId: true },
        })
      : await prisma.sallaOrder.findFirst({
          where: {
            merchantId: MERCHANT_ID,
            OR: [{ orderNumber: givenNumber }, { referenceId: givenNumber }, { orderId: givenNumber }],
          },
          orderBy: { placedAt: 'desc' },
          select: { orderId: true, orderNumber: true, customerName: true, statusCustomId: true },
        });
    if (!order) return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    orderId = order.orderId;
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
    const waiting = order.statusCustomId === NEW_ORDER_STATUS_ID;
    return NextResponse.json({
      success: true,
      message: waiting
        ? `تم تمييز الطلب #${data.orderNumber}، وسيُجهّز قبل غيره`
        : `مُيّز الطلب #${data.orderNumber}، لكنه ليس «طلب جديد» الآن فلن يدخل طابور التجهيز حتى يعود إليه`,
    });
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
