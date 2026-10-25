/**
 * Re-derives SallaOrder.placedAt / updatedAtRemote from rawOrder. Rows synced
 * before app/lib/salla-time.ts stored Salla's Asia/Riyadh wall-clock time as
 * if it were UTC (3 hours late). Idempotent: only rows whose stored value
 * differs from the re-derived one are updated.
 *
 * Usage: npm run backfill:salla-order-dates [-- --dry-run]
 */
import { prisma } from '@/lib/prisma';
import { extractDates } from '@/app/lib/salla-orders';

const BATCH_SIZE = 500;
const dryRun = process.argv.includes('--dry-run');

const sameInstant = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

async function main() {
  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;
  const shifts = new Map<number, number>();

  for (;;) {
    const rows = await prisma.sallaOrder.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, rawOrder: true, placedAt: true, updatedAtRemote: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    const updates = rows.flatMap((row) => {
      const dates = extractDates(row.rawOrder as Record<string, any>);
      const placedAt = dates.created ?? row.placedAt;
      const updatedAtRemote = dates.updated ?? row.updatedAtRemote;
      if (sameInstant(placedAt, row.placedAt) && sameInstant(updatedAtRemote, row.updatedAtRemote)) return [];
      if (placedAt && row.placedAt) {
        const hours = (row.placedAt.getTime() - placedAt.getTime()) / 3_600_000;
        shifts.set(hours, (shifts.get(hours) ?? 0) + 1);
      }
      return [{ id: row.id, placedAt, updatedAtRemote }];
    });
    changed += updates.length;

    if (!dryRun && updates.length > 0) {
      await prisma.$transaction(
        updates.map(({ id, placedAt, updatedAtRemote }) =>
          prisma.sallaOrder.update({ where: { id }, data: { placedAt, updatedAtRemote }, select: { id: true } })
        )
      );
    }
    console.log(`scanned ${scanned}, ${dryRun ? 'would update' : 'updated'} ${changed}`);
  }

  console.log('placedAt shift (stored − correct, hours → rows):', Object.fromEntries(shifts));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
