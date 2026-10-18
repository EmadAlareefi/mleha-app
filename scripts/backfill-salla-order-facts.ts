/**
 * Fills the SallaOrder report fact columns (discountTotal, refundedItemsTotal,
 * refundedItemsCount, isPendingPayment, exchangeRate) for rows written before
 * they existed. Idempotent: only rows with factsComputedAt = NULL are touched,
 * and new writes populate the columns themselves.
 *
 * Usage: npm run backfill:salla-order-facts [-- --dry-run]
 */
import { prisma } from '@/lib/prisma';
import { sallaOrderFactsData } from '@/app/lib/salla-order-facts';

const BATCH_SIZE = 200;
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const pending = await prisma.sallaOrder.count({ where: { factsComputedAt: null } });
  console.log(`${pending} orders need facts${dryRun ? ' (dry run)' : ''}`);
  if (dryRun || pending === 0) return;

  let cursor: string | undefined;
  let updated = 0;

  for (;;) {
    const rows = await prisma.sallaOrder.findMany({
      where: { factsComputedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, rawOrder: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const computedAt = new Date();
    await prisma.$transaction(
      rows.map((row) =>
        prisma.sallaOrder.update({
          where: { id: row.id },
          data: sallaOrderFactsData(row.rawOrder, computedAt),
          select: { id: true },
        })
      )
    );
    updated += rows.length;
    console.log(`updated ${updated}/${pending}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
