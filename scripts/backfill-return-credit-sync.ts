/**
 * Marks return/exchange requests already covered by an ERP refund credit note
 * (ReturnRequest.erpCreditSyncedAt / erpCreditInvoiceId), so the refunds queue
 * only offers requests that were never reversed in ERP.
 *
 * Until now a credit note was tracked per order (ERPRefundOrderSync or a synced
 * Salla refund invoice). For each order with one:
 * - Full reversal (posted before partial crediting shipped, or no return-type
 *   request existed when it posted): every request on the order is covered.
 * - Partial credit: only requests created before it posted are covered. Later
 *   ones stay unmarked and show up in the queue as additional returns.
 *
 * Needs migration 20261126120000_return_request_erp_credit.
 * Usage: npx tsx scripts/backfill-return-credit-sync.ts [--apply]   (dry run by default)
 */
import { prisma } from '@/lib/prisma';
import { isPotentialRefundStatus } from '@/lib/refund-status';

const apply = process.argv.includes('--apply');
// d9e1854 (credit only returned items) — earlier refunds were always full reversals.
const PARTIAL_CREDIT_SINCE = new Date('2026-10-28T01:35:48Z');
const ACTIVE_TYPES = ['return', 'exchange', 'mixed'];
const INACTIVE_STATUSES = ['rejected', 'cancelled'];

interface Credit {
  syncedAt: Date;
  erpInvoiceId: string | null;
}

async function main() {
  const requests = await prisma.returnRequest.findMany({
    where: { type: { in: ACTIVE_TYPES }, status: { notIn: INACTIVE_STATUSES } },
    select: { id: true, merchantId: true, orderId: true, orderNumber: true, type: true, createdAt: true },
  });
  const byOrder = new Map<string, typeof requests>();
  for (const request of requests) {
    const key = `${request.merchantId}:${request.orderId}`;
    byOrder.set(key, [...(byOrder.get(key) ?? []), request]);
  }
  const orderIds = Array.from(new Set(requests.map((request) => request.orderId)));

  const credits = new Map<string, Credit>();
  const keep = (key: string, credit: Credit) => {
    const existing = credits.get(key);
    if (!existing || credit.syncedAt < existing.syncedAt) credits.set(key, credit);
  };

  const orderSyncs = await prisma.eRPRefundOrderSync.findMany({
    where: { orderId: { in: orderIds }, erpSyncedAt: { not: null }, erpSyncError: null },
    select: { merchantId: true, orderId: true, erpSyncedAt: true, erpInvoiceId: true },
  });
  for (const sync of orderSyncs) {
    keep(`${sync.merchantId}:${sync.orderId}`, { syncedAt: sync.erpSyncedAt!, erpInvoiceId: sync.erpInvoiceId });
  }

  const invoices = await prisma.sallaInvoice.findMany({
    where: { orderId: { in: orderIds }, erpSyncedAt: { not: null }, erpSyncError: null },
    select: { merchantId: true, orderId: true, erpSyncedAt: true, status: true, paymentStatus: true, totalAmount: true },
  });
  for (const invoice of invoices) {
    const isRefund =
      isPotentialRefundStatus(invoice.status) ||
      isPotentialRefundStatus(invoice.paymentStatus) ||
      (invoice.totalAmount != null && Number(invoice.totalAmount) < 0);
    if (isRefund && invoice.orderId) {
      keep(`${invoice.merchantId}:${invoice.orderId}`, { syncedAt: invoice.erpSyncedAt!, erpInvoiceId: null });
    }
  }

  const toMark: Array<{ id: string; credit: Credit }> = [];
  const leftOpen: string[] = [];
  let fullReversals = 0;

  for (const [key, credit] of credits) {
    const orderRequests = byOrder.get(key) ?? [];
    const partial =
      credit.syncedAt >= PARTIAL_CREDIT_SINCE &&
      orderRequests.some((request) => request.type === 'return' && request.createdAt <= credit.syncedAt);
    if (!partial) fullReversals += 1;

    for (const request of orderRequests) {
      if (!partial || request.createdAt <= credit.syncedAt) {
        toMark.push({ id: request.id, credit });
      } else {
        leftOpen.push(
          `${request.orderNumber ?? request.orderId} (${request.type}, created ${request.createdAt.toISOString()}, credit note ${credit.syncedAt.toISOString()})`
        );
      }
    }
  }

  console.log(`Orders with a credit note: ${credits.size} (${fullReversals} full reversals)`);
  console.log(`Requests to mark as credited: ${toMark.length}`);
  console.log(`Requests left for the queue (created after a partial credit note): ${leftOpen.length}`);
  for (const line of leftOpen) console.log(`  - ${line}`);
  const uncovered = requests.length - toMark.length - leftOpen.length;
  console.log(`Requests on orders with no credit note yet: ${uncovered}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  // One statement per batch: row-by-row updates over the pooler take hours.
  const BATCH = 1000;
  let written = 0;
  for (let start = 0; start < toMark.length; start += BATCH) {
    const batch = toMark.slice(start, start + BATCH);
    written += await prisma.$executeRaw`
      UPDATE "ReturnRequest" AS r
      SET "erpCreditSyncedAt" = v.synced_at, "erpCreditInvoiceId" = v.invoice_id
      FROM unnest(
        ${batch.map((row) => row.id)}::text[],
        ${batch.map((row) => row.credit.syncedAt.toISOString())}::timestamptz[],
        ${batch.map((row) => row.credit.erpInvoiceId)}::text[]
      ) AS v(id, synced_at, invoice_id)
      WHERE r."id" = v.id AND r."erpCreditSyncedAt" IS NULL
    `;
    console.log(`  ${Math.min(start + BATCH, toMark.length)}/${toMark.length}`);
  }
  console.log(`Marked ${written} requests.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
