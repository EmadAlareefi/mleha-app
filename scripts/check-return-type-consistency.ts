/**
 * Finds return requests whose stored type disagrees with their pieces, e.g. an
 * "exchange" request whose pieces are stored as `return`. Those show (and
 * processing would pay) a money refund on an exchange. They date from the
 * returns-v2 migration window, when old code wrote pieces without a type.
 *
 * Read-only by default: prints each mismatch with its money state.
 * With --fix, open requests where no money moved get the request's type copied
 * onto their pieces (the v2 backfill rule), are repriced, and get a `type_fix`
 * audit entry. Anything else is listed for staff to settle in returns-management.
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
    // Only a single-type request has an unambiguous intended type to copy down.
    const fixable = open && !moneyMoved && request.processingStatus !== 'processing' && request.type !== 'mixed';
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
