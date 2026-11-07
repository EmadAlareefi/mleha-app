import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { requireReturnsStaff, staffActorName } from '@/app/lib/returns/staff-auth';
import { maybeReleaseExchangeOrderHold } from '@/app/lib/returns/exchange-order';
import {
  createExchangeOrderForRequest,
  expireExchangeOrder,
  productionExchangeDeps,
} from '@/app/lib/returns/exchange-order-flow';
import { getExchangeOrderState } from '@/app/lib/salla-exchange-order';
import { listOrderTransactions, pickRefundableTransaction, refundTransaction } from '@/app/lib/salla-transactions';
import { returnStatusPath } from '@/app/lib/returns/status-token';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Action = 'release' | 'cancel' | 'resend_link' | 'retry';

async function audit(id: string, step: string, result: string, by: string, details: Record<string, unknown>) {
  const current = await prisma.returnRequest.findUnique({ where: { id }, select: { processingAudit: true } });
  const entries = Array.isArray(current?.processingAudit) ? (current!.processingAudit as unknown[]) : [];
  await prisma.returnRequest.update({
    where: { id },
    data: { processingAudit: [...entries, { at: new Date().toISOString(), step, result, by, details }] as any },
  });
}

/**
 * POST /api/returns/exchange-order { returnRequestId, action }
 *  release     — ship the held replacement even though inspection is not all good
 *  cancel      — cancel the replacement (refunding any difference paid) and fall back to a coupon
 *  resend_link — WhatsApp the payment link again
 *  retry       — create the replacement order again after a failure
 */
export async function POST(request: NextRequest) {
  const auth = await requireReturnsStaff();
  if (auth.response) return auth.response;
  const actor = staffActorName(auth.session);

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.returnRequestId === 'string' ? body.returnRequestId : '';
  const action = body?.action as Action;
  if (!id || !['release', 'cancel', 'resend_link', 'retry'].includes(action)) {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
  }
  const returnRequest = await prisma.returnRequest.findUnique({ where: { id }, include: { exchangeLines: true } });
  if (!returnRequest) return NextResponse.json({ error: 'طلب الإرجاع غير موجود' }, { status: 404 });

  try {
    switch (action) {
      case 'release': {
        if (returnRequest.exchangeMode !== 'order') throw new Error('لا يوجد طلب استبدال لهذا الطلب');
        const result = await maybeReleaseExchangeOrderHold(id, { force: true });
        await audit(id, 'exchange_order', result.released ? 'ok' : 'failed', actor, { forced: true, reason: result.reason });
        if (!result.released) throw new Error(result.reason === 'payment_pending' ? 'العميل لم يدفع الفرق بعد' : `تعذر الإطلاق: ${result.reason}`);
        await prisma.returnRequest.update({ where: { id }, data: { processingStatus: 'idle', processingError: null } });
        return NextResponse.json({ success: true, message: 'تم إطلاق طلب الاستبدال للتجهيز.' });
      }
      case 'cancel': {
        if (returnRequest.exchangeMode !== 'order' || !returnRequest.exchangeOrderId) throw new Error('لا يوجد طلب استبدال لإلغائه');
        const state = await getExchangeOrderState(returnRequest.merchantId, returnRequest.exchangeOrderId);
        let refunded = 0;
        if (state.paidAmount > 0) {
          const option = pickRefundableTransaction(await listOrderTransactions(returnRequest.merchantId, returnRequest.exchangeOrderId));
          if (!option.ok) throw new Error(`دفع العميل ${state.paidAmount} ولا يمكن استرجاعه تلقائياً: ${option.reason}`);
          await refundTransaction(returnRequest.merchantId, option.transaction.id, Math.min(state.paidAmount, option.total), option.currency, option.total);
          refunded = Math.min(state.paidAmount, option.total);
        }
        await expireExchangeOrder(returnRequest, productionExchangeDeps, { status: 'cancelled' });
        await prisma.returnRequest.update({ where: { id }, data: { processingStatus: 'idle', processingError: null } });
        await audit(id, 'exchange_order', 'ok', actor, { cancelled: true, refunded });
        return NextResponse.json({
          success: true,
          message: refunded > 0
            ? `تم إلغاء طلب الاستبدال واسترجاع ${refunded} للعميل. سيُصدر كوبون الاستبدال عند المعالجة.`
            : 'تم إلغاء طلب الاستبدال. سيُصدر كوبون الاستبدال عند المعالجة.',
        });
      }
      case 'resend_link': {
        if (returnRequest.exchangePaymentStatus !== 'pending' || !returnRequest.exchangeCheckoutUrl) {
          throw new Error('لا يوجد دفع معلق لهذا الطلب');
        }
        const statusPath = returnStatusPath(id);
        await productionExchangeDeps.notify('ZOKO_TPL_EXCHANGE_PAYMENT_PENDING', returnRequest.customerPhone, [
          returnRequest.customerName || 'عميلنا العزيز',
          returnRequest.exchangeOrderNumber || '',
          `${Number(returnRequest.exchangeAmountDue || 0).toFixed(2)} ر.س`,
          returnRequest.exchangeCheckoutUrl,
        ]);
        await audit(id, 'exchange_order', 'info', actor, { resentPaymentLink: true, statusPath });
        return NextResponse.json({ success: true, message: 'تم إرسال رابط الدفع للعميل.' });
      }
      case 'retry': {
        if (returnRequest.exchangeOrderId) throw new Error('طلب الاستبدال موجود مسبقاً');
        if (returnRequest.exchangeLines.length === 0) throw new Error('لا توجد منتجات بديلة محفوظة لهذا الطلب');
        if (returnRequest.couponCode) throw new Error('تم إصدار كوبون استبدال لهذا الطلب مسبقاً');
        await prisma.returnRequest.update({ where: { id }, data: { exchangeMode: 'order', exchangePaymentStatus: 'none' } });
        const result = await createExchangeOrderForRequest(id);
        await audit(id, 'exchange_order', result.ok ? 'ok' : 'failed', actor, { retry: true, error: result.ok ? undefined : result.error });
        if (!result.ok) throw new Error(result.error);
        return NextResponse.json({
          success: true,
          message: result.paymentUrl
            ? `تم إنشاء طلب الاستبدال #${result.orderNumber}. أرسلي رابط الدفع للعميل.`
            : `تم إنشاء طلب الاستبدال #${result.orderNumber}.`,
        });
      }
    }
  } catch (error) {
    log.error('Exchange order staff action failed', { id, action, error });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'فشل تنفيذ الإجراء' }, { status: 400 });
  }
}
