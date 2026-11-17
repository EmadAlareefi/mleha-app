import { NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { isCronAuthorized } from '@/app/lib/order-prep/route-auth';
import { productionEngineDeps, productionItemDeps, productionWorkerStore } from '@/app/lib/order-manage/engine-deps';
import { processItemsRefund, settleAwaitingPayment } from '@/app/lib/order-manage/items';
import { prisma } from '@/lib/prisma';
import { getOrderManageSettings } from '@/app/lib/order-manage/settings';
import { runOrderManageWorker } from '@/app/lib/order-manage/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron, every minute: finishes customer order changes a request left
 * half done and decides refunds that are still open. Runs even when the
 * feature is switched off, so nothing already started is left hanging.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const settings = await getOrderManageSettings({ fresh: true });
    const summary = await runOrderManageWorker(productionEngineDeps, productionWorkerStore, settings);
    const items = await runItemChanges(settings);
    return NextResponse.json({ success: true, ...summary, items });
  } catch (error) {
    log.error('Order-manage worker failed', { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ success: false, error: 'Worker failed' }, { status: 500 });
  }
}

/**
 * Piece changes (items.ts): finish or undo changes waiting on the customer's
 * payment, and send refunds the request did not get to.
 */
async function runItemChanges(settings: Awaited<ReturnType<typeof getOrderManageSettings>>) {
  const result: Record<string, number> = {};
  const count = (key: string) => (result[key] = (result[key] ?? 0) + 1);
  const awaiting = await prisma.customerOrderChange.findMany({
    where: { state: 'awaiting_payment' },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: 20,
  });
  for (const { id } of awaiting) count(`payment_${await settleAwaitingPayment(productionItemDeps, id).catch(() => 'error')}`);

  // Applied in Salla but the mirror lagged: release once the mirror catches up.
  const unreleased = await prisma.customerOrderChange.findMany({
    where: { kind: { in: ['swap', 'items'] }, state: { in: ['completed', 'failed'] }, holdActive: true },
    select: { id: true, merchantId: true, orderId: true, state: true },
    take: 20,
  });
  for (const change of unreleased) {
    const live = await productionItemDeps.fetchLive(change.merchantId, change.orderId);
    const synced = live.kind === 'ok' && (await productionItemDeps.syncMirror(change.merchantId, live.detail).catch(() => false));
    if (!synced) continue;
    await productionItemDeps.updateChange(change.id, { holdActive: true }, {
      holdActive: false,
      lastError: change.state === 'failed' ? 'payment_expired' : null,
      step: { step: 'release', result: 'ok' },
    });
    count('released');
  }

  const refunds = await prisma.customerOrderChange.findMany({
    where: {
      kind: { in: ['swap', 'items'] },
      state: 'completed',
      refundStatus: 'none',
      refundAmount: { gt: 0 },
      updatedAt: { lt: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
    take: 20,
  });
  for (const { id } of refunds) count(`refund_${await processItemsRefund(productionItemDeps, id, settings).catch(() => 'error')}`);
  return result;
}
