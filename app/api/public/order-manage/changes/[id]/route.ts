import { NextRequest } from 'next/server';
import { log } from '@/app/lib/logger';
import { productionItemDeps } from '@/app/lib/order-manage/engine-deps';
import { SIGNED_OUT, jsonNoStore, sessionFromRequest } from '@/app/lib/order-manage/http';
import { serviceNumber, settleAwaitingPayment } from '@/app/lib/order-manage/items';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/order-manage/changes/{id}
 *
 * One change of the signed-in customer's order, for the tracking screen. A
 * change waiting on payment is checked against Salla on the way, so the page
 * moves on as soon as the customer has paid.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return jsonNoStore(SIGNED_OUT, 401);
    const { id } = await params;
    const owned = await prisma.customerOrderChange.findFirst({
      where: { id, merchantId: session.merchantId, orderId: session.orderId },
      select: { state: true },
    });
    if (!owned) return jsonNoStore({ error: 'not_found' }, 404);
    if (owned.state === 'awaiting_payment') await settleAwaitingPayment(productionItemDeps, id).catch(() => undefined);

    const change = await prisma.customerOrderChange.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        state: true,
        refundStatus: true,
        refundAmount: true,
        paymentStatus: true,
        paymentUrl: true,
        paymentExpiresAt: true,
        amountDelta: true,
        currency: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!change) return jsonNoStore({ error: 'not_found' }, 404);
    return jsonNoStore({
      success: true,
      change: {
        ...change,
        serviceNumber: serviceNumber(change.id),
        refundAmount: change.refundAmount === null ? null : Number(change.refundAmount),
        amountDelta: change.amountDelta === null ? null : Number(change.amountDelta),
        paymentUrl: change.state === 'awaiting_payment' ? change.paymentUrl : null,
      },
    });
  } catch (error) {
    log.error('Order-manage change read failed', { error: error instanceof Error ? error.message : error });
    return jsonNoStore({ error: 'حدث خطأ، يرجى المحاولة لاحقاً.' }, 500);
  }
}
