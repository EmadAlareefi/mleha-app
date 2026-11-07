import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { findHistoryRefunds } from '@/app/lib/salla-transactions';
import { carrierDelivered, RECEIVABLE_STATUSES } from '@/lib/returns/workflow';
import { syncLocalReturnPickupTask } from '@/app/lib/returns/local-return-pickup';
import { runExchangePaymentMaintenance, type ExchangeMaintenanceReport } from '@/app/lib/returns/exchange-order-flow';

/**
 * Moves return requests forward on the server, replacing the browser-side
 * auto-complete that only ran when someone opened the management page.
 */

const RESTORED_SLUGS = new Set(['restored']);
const RESTORED_NAMES = new Set(['مسترجع']);

/** Carrier says the return reached us: mark received. Never completes anything. */
export async function markReturnsReceived(where: Prisma.ReturnRequestWhereInput, source: string) {
  const targets = await prisma.returnRequest.findMany({
    where: { AND: [where, { status: { in: RECEIVABLE_STATUSES } }] },
    select: { id: true },
  });
  if (targets.length === 0) return 0;
  const { count } = await prisma.returnRequest.updateMany({
    where: { id: { in: targets.map((t) => t.id) }, status: { in: RECEIVABLE_STATUSES } },
    data: { status: 'delivered', receivedAt: new Date() },
  });
  for (const { id } of targets) {
    await syncLocalReturnPickupTask(id).catch(() => undefined);
  }
  log.info('Return requests marked received', { count, source });
  return count;
}

/** AJEX webhook hook: keep the return's live status and mark it received on delivery. */
export async function applyAjexEventToReturns(trackingId: string, status: { delivered?: boolean } & Record<string, unknown>) {
  const where: Prisma.ReturnRequestWhereInput = {
    smsaTrackingNumber: { startsWith: trackingId, mode: 'insensitive' },
  };
  await prisma.returnRequest.updateMany({
    where,
    data: { smsaLiveStatus: status as Prisma.InputJsonValue, smsaLiveStatusUpdatedAt: new Date() },
  });
  if (status.delivered) await markReturnsReceived(where, 'ajex-webhook');
}

const LOOKBACK_DAYS = 60;

export interface AutoProgressReport {
  exchangePayments?: ExchangeMaintenanceReport;
  received: number;
  restoredOutsideApp: number;
  refundsResolved: number;
  refundsStillUnknown: number;
}

export async function runReturnsAutoProgress(): Promise<AutoProgressReport> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const report: AutoProgressReport = { received: 0, restoredOutsideApp: 0, refundsResolved: 0, refundsStillUnknown: 0 };

  // 1. Delivered by the carrier but the webhook update was missed.
  const open = await prisma.returnRequest.findMany({
    where: { createdAt: { gte: since }, status: { in: RECEIVABLE_STATUSES } },
    select: { id: true, merchantId: true, orderId: true, smsaLiveStatus: true, processingStatus: true },
  });
  const deliveredIds = open.filter((r) => carrierDelivered(r.smsaLiveStatus)).map((r) => r.id);
  if (deliveredIds.length > 0) {
    report.received += await markReturnsReceived({ id: { in: deliveredIds } }, 'auto-progress');
  }

  // 2. Salla order already "مسترجع" before we processed it: somebody handled it
  //    in the Salla dashboard. Do not restock or refund again; flag it.
  const unprocessed = await prisma.returnRequest.findMany({
    where: {
      createdAt: { gte: since },
      status: { notIn: ['completed', 'cancelled', 'rejected'] },
      processingStatus: { in: ['idle'] },
    },
    select: { id: true, merchantId: true, orderId: true },
  });
  if (unprocessed.length > 0) {
    const orders = await prisma.sallaOrder.findMany({
      where: { OR: unprocessed.map((r) => ({ merchantId: r.merchantId, orderId: r.orderId })) },
      select: { merchantId: true, orderId: true, statusSlug: true, statusName: true },
    });
    const restored = new Set(
      orders
        .filter((o) => RESTORED_SLUGS.has(String(o.statusSlug || '')) || RESTORED_NAMES.has(String(o.statusName || '').trim()))
        .map((o) => `${o.merchantId}:${o.orderId}`),
    );
    for (const request of unprocessed) {
      if (!restored.has(`${request.merchantId}:${request.orderId}`)) continue;
      await prisma.returnRequest.update({
        where: { id: request.id },
        data: {
          processingStatus: 'needs_attention',
          processingError: 'الطلب "مسترجع" في سلة قبل معالجته من النظام. تحقق من المبلغ والمخزون ثم أغلق الطلب بدون معالجة.',
        },
      });
      report.restoredOutsideApp++;
    }
  }

  // 3. Refunds whose outcome was unknown: settle from the order history. Never resend.
  const pending = await prisma.returnRequest.findMany({
    where: {
      refundStatus: { in: ['unknown', 'requested'] },
      updatedAt: { lte: new Date(Date.now() - 2 * 60 * 1000) },
    },
    select: { id: true, merchantId: true, orderId: true, createdAt: true },
  });
  for (const request of pending) {
    try {
      const refunds = (await findHistoryRefunds(request.merchantId, request.orderId)).filter(
        (refund) => !refund.at || new Date(refund.at).getTime() >= request.createdAt.getTime() - 60_000,
      );
      if (refunds.length > 0) {
        const amount = refunds.reduce((sum, refund) => sum + (refund.amount ?? 0), 0);
        await prisma.returnRequest.update({
          where: { id: request.id },
          data: {
            refundStatus: 'refunded',
            refundedAt: new Date(),
            ...(amount > 0 ? { refundedAmount: amount } : {}),
            refundError: null,
          },
        });
        report.refundsResolved++;
      } else {
        report.refundsStillUnknown++;
      }
    } catch (error) {
      log.warn('Could not resolve unknown refund from Salla history', { returnRequestId: request.id, error });
      report.refundsStillUnknown++;
    }
  }

  // 4. App-created exchange orders: missed payment webhooks, reminders, expiry.
  try {
    report.exchangePayments = await runExchangePaymentMaintenance();
  } catch (error) {
    log.error('Exchange payment maintenance failed', { error });
  }

  return report;
}
