/**
 * One-time cutover backfill: converts Fabric.stockLength from "at warehouse only"
 * (its meaning under the old issue-fabric/record-delivery flow, which decremented
 * stockLength the moment fabric was issued to a tailor) into a true grand total
 * (everything in existence, whether at the warehouse or currently with a tailor).
 *
 * For each fabric, adds back whatever is still checked out via an open
 * (status != 'closed') pre-migration TailorFabricIssue row:
 *   stockLength_new = stockLength_old + SUM(issuedLength - consumedLength - returnedLength)
 *                     over that fabric's open LEGACY_ISSUE rows
 *
 * Idempotent: re-running after it has already applied is a no-op, because by then
 * every previously-open row's remaining amount has either been folded into
 * stockLength once (rows aren't touched/re-counted - it only reads current DB
 * state, so run this exactly once at cutover, not repeatedly on a live system
 * that's still creating new open legacy issues).
 *
 * Usage: node --import tsx scripts/backfill-fabric-stock-grand-total.ts [--dry-run]
 */
import { loadEnvConfig } from '@next/env';
import process from 'process';

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const { prisma } = await import('@/lib/prisma');
  const { Prisma } = await import('@prisma/client');

  const openAgg = await prisma.tailorFabricIssue.groupBy({
    by: ['fabricId'],
    where: { movementType: 'LEGACY_ISSUE', status: { not: 'closed' } },
    _sum: { issuedLength: true, consumedLength: true, returnedLength: true },
  });

  if (openAgg.length === 0) {
    console.log('No open legacy issues found - grand-total backfill is a no-op.');
    return;
  }

  console.log(`${openAgg.length} fabric(s) have outstanding open legacy issues:${DRY_RUN ? ' (dry run)' : ''}\n`);

  for (const row of openAgg) {
    const remaining =
      Number(row._sum.issuedLength || 0) - Number(row._sum.consumedLength || 0) - Number(row._sum.returnedLength || 0);
    if (remaining === 0) continue;

    const fabric = await prisma.fabric.findUnique({ where: { id: row.fabricId } });
    if (!fabric) continue;

    const oldTotal = Number(fabric.stockLength);
    const newTotal = oldTotal + remaining;
    console.log(`${fabric.name}: ${oldTotal} -> ${newTotal} (adding back ${remaining} m currently with tailor(s))`);

    if (!DRY_RUN) {
      await prisma.fabric.update({
        where: { id: fabric.id },
        data: { stockLength: new Prisma.Decimal(newTotal) },
      });
    }
  }

  console.log(DRY_RUN ? '\nDry run complete - no changes written.' : '\nBackfill complete.');
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect();
  });
