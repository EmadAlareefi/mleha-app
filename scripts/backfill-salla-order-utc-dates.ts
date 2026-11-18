/**
 * Converts SallaOrder.placedAt and updatedAtRemote to real UTC instants.
 *
 * They used to hold Salla's Riyadh wall clock labelled as UTC (3 hours late),
 * while every other timestamp in the app is real UTC. Each row's dates are
 * recomputed from its stored rawOrder with the same extractDates() the sync
 * now uses, so the script is idempotent: running it again changes nothing, and
 * rows already written by the new code are left alone.
 *
 * Run it right after the code that writes UTC dates is deployed.
 *
 * Usage: npm run backfill:salla-order-utc-dates [-- --apply]
 *   (dry run by default: prints what would change, writes nothing)
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { extractDates } from '@/app/lib/salla-orders';
import { toSqlTimestamp } from '@/app/lib/order-prep/riyadh-time';

const BATCH_SIZE = 500;
const apply = process.argv.includes('--apply');
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

type Change = { id: string; placedAt: Date | null; updatedAtRemote: Date | null };

/** "YYYY-MM-DD HH:mm:ss.SSS" of the UTC instant, for a `timestamp` (no zone) column. */
const sqlTs = (value: Date | null) => (value ? `${toSqlTimestamp(value)}.${String(value.getUTCMilliseconds()).padStart(3, '0')}` : null);

const differs = (stored: Date | null, next: Date | null) =>
  next !== null && (stored === null || stored.getTime() !== next.getTime());

async function main() {
  const total = await prisma.sallaOrder.count();
  console.log(`${total} orders to check${apply ? '' : ' (dry run, nothing is written)'}`);

  let cursor: string | undefined;
  let scanned = 0;
  let changed = 0;
  let notMinusThree = 0;
  let unparsed = 0;
  const samples: string[] = [];

  for (;;) {
    const rows = await prisma.sallaOrder.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, orderNumber: true, placedAt: true, updatedAtRemote: true, rawOrder: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    const changes: Change[] = [];
    for (const row of rows) {
      const raw = row.rawOrder && typeof row.rawOrder === 'object' ? (row.rawOrder as Record<string, any>) : {};
      const dates = extractDates(raw);
      if (row.placedAt && !dates.created) unparsed += 1;
      const placedChanged = differs(row.placedAt, dates.created);
      const updatedChanged = differs(row.updatedAtRemote, dates.updated);
      if (!placedChanged && !updatedChanged) continue;

      if (placedChanged && row.placedAt && row.placedAt.getTime() - dates.created!.getTime() !== THREE_HOURS_MS) {
        notMinusThree += 1;
        if (samples.length < 10) {
          samples.push(`#${row.orderNumber ?? row.id}: ${row.placedAt.toISOString()} → ${dates.created!.toISOString()}`);
        }
      }
      changes.push({
        id: row.id,
        placedAt: placedChanged ? dates.created : row.placedAt,
        updatedAtRemote: updatedChanged ? dates.updated : row.updatedAtRemote,
      });
    }

    changed += changes.length;
    if (apply && changes.length > 0) {
      const values = Prisma.join(
        changes.map(
          (change) => Prisma.sql`(${change.id}, ${sqlTs(change.placedAt)}::timestamp, ${sqlTs(change.updatedAtRemote)}::timestamp)`
        )
      );
      await prisma.$executeRaw`
        UPDATE "SallaOrder" AS o
        SET "placedAt" = v."placedAt", "updatedAtRemote" = v."updatedAtRemote"
        FROM (VALUES ${values}) AS v(id, "placedAt", "updatedAtRemote")
        WHERE o.id = v.id`;
    }
    console.log(`checked ${scanned}/${total}, ${apply ? 'updated' : 'would update'} ${changed}`);
  }

  console.log(`\n${apply ? 'Updated' : 'Would update'} ${changed} of ${scanned} orders.`);
  console.log(`${unparsed} orders have a placedAt but no parseable date in rawOrder (left as they are).`);
  console.log(`${notMinusThree} placedAt changes are not exactly −3 h${samples.length ? ':' : '.'}`);
  for (const sample of samples) console.log(`  ${sample}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
