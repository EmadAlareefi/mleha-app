/**
 * Finds return requests whose stored type disagrees with their pieces, e.g. an
 * "exchange" request whose pieces are stored as `return`. Those show (and
 * processing would pay) a money refund on an exchange. They date from the
 * returns-v2 migration window, when old code wrote pieces without a type.
 *
 * Read-only by default: prints each mismatch with its money state.
 * With --fix, the request's type is copied onto its pieces (the v2 backfill
 * rule), the request is repriced and gets a `type_fix` audit entry, for:
 * - open requests where no money moved, and
 * - "exchange" requests settled by an exchange coupon with no refund (open or
 *   closed): the coupon locks the stored credit, so no amount changes, and an
 *   open one can no longer be refunded on top of its coupon.
 * Anything else (a refund already paid, a closed request's stored type) is
 * listed for a person to settle; request types are never changed here because
 * ERP refund credit notes depend on them.
 *
 * Usage: node --import tsx scripts/check-return-type-consistency.ts [--fix]
 * Local dev points at the production database: run --fix only with approval.
 */
import { loadEnvConfig } from '@next/env';
import process from 'process';

loadEnvConfig(process.cwd());

const FIX = process.argv.includes('--fix');

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const { repriceRequest, creditLocked, refundSettled } = await import('@/app/lib/returns/reprice');
  const { deriveRequestType } = await import('@/lib/returns/pieces');

  const requests = await prisma.returnRequest.findMany({
    where: { items: { some: {} } },
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      processingStatus: true,
      refundStatus: true,
      couponCode: true,
      exchangeMode: true,
      exchangeOrderId: true,
      exchangePaymentStatus: true,
      totalRefundAmount: true,
      couponAmount: true,
      processingAudit: true,
      items: { select: { id: true, type: true } },
    },
  });

  const mismatched = requests.filter(
    (request) =>
      ['return', 'exchange', 'mixed'].includes(request.type) &&
      deriveRequestType(request.items.map((item) => item.type)) !== request.type,
  );
  if (mismatched.length === 0) {
    console.log('No mismatched requests.');
    return;
  }

  let fixed = 0;
  for (const request of mismatched) {
    const pieceType = deriveRequestType(request.items.map((item) => item.type));
    const open = !['completed', 'cancelled', 'rejected'].includes(request.status);
    const moneyMoved = refundSettled(request.refundStatus) || creditLocked(request);
    const refundNone = (request.refundStatus || 'none') === 'none';
    // The exchange coupon was the settlement and no money went back: the pieces
    // are exchanges. Leaving them as returns would make processing pay a refund
    // on top of the coupon. Only piece types change; the coupon locks the
    // stored credit and the request type (which ERP reads) stays as it is.
    const couponSettledExchange =
      request.type === 'exchange' && Boolean(request.couponCode) && refundNone && request.exchangeMode !== 'order';
    // Only a single-type request has an unambiguous intended type to copy down.
    const fixable =
      request.processingStatus !== 'processing' &&
      request.type !== 'mixed' &&
      ((open && !moneyMoved) || couponSettledExchange);
    console.log(
      [
        `#${request.orderNumber ?? request.id}`,
        `stored=${request.type}`,
        `pieces=${pieceType}`,
        `status=${request.status}/${request.processingStatus}`,
        `refund=${request.refundStatus}`,
        `coupon=${request.couponCode ?? '-'}`,
        `totalRefundAmount=${request.totalRefundAmount ?? '-'}`,
        `couponAmount=${request.couponAmount ?? '-'}`,
        fixable ? 'FIXABLE' : 'REVIEW BY HAND',
      ].join('  '),
    );
    if (!FIX || !fixable) continue;

    await prisma.returnItem.updateMany({ where: { returnRequestId: request.id }, data: { type: request.type } });
    await repriceRequest(request.id);
    const audit = Array.isArray(request.processingAudit) ? (request.processingAudit as unknown[]) : [];
    await prisma.returnRequest.update({
      where: { id: request.id },
      data: {
        processingAudit: [
          ...audit,
          {
            at: new Date().toISOString(),
            step: 'type_fix',
            result: 'ok',
            by: 'check-return-type-consistency',
            details: { from: pieceType, to: request.type, pieces: request.items.length },
          },
        ] as any,
      },
    });
    fixed++;
  }

  console.log(`\n${mismatched.length} mismatched; ${FIX ? `${fixed} fixed` : 'dry run (pass --fix to repair the FIXABLE ones)'}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect();
  });
