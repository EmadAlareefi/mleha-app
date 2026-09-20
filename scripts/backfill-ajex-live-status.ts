/**
 * Replays stored AJEX callbacks onto scanned warehouse shipments.
 *
 * Usage: npm run backfill:ajex-live-status [-- --dry-run]
 */
import { prisma } from '@/lib/prisma';
import { applyAjexTrackingToShipments } from '@/app/lib/ajex-shipment-tracking';
import { normalizeAjexTrackingEvent, type AjexTrackingEvent } from '@/app/lib/ajex-tracking';

const BATCH_SIZE = 2000;
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const latestByTracking = new Map<string, AjexTrackingEvent>();
  let cursor: string | undefined;
  let scanned = 0;

  for (;;) {
    const logs = await prisma.webhookLog.findMany({
      where: { event: 'ajex.tracking' },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, json: true },
    });

    if (logs.length === 0) break;
    cursor = logs[logs.length - 1].id;
    scanned += logs.length;

    for (const entry of logs) {
      if (!entry.json || typeof entry.json !== 'object' || Array.isArray(entry.json)) continue;
      const event = normalizeAjexTrackingEvent(entry.json as Record<string, unknown>);
      if (!event) continue;
      const existing = latestByTracking.get(event.trackingId);
      if (!existing || existing.eventAt <= event.eventAt) {
        latestByTracking.set(event.trackingId, event);
      }
    }
  }

  console.log(`scanned ${scanned} callbacks, ${latestByTracking.size} unique waybills`);

  if (dryRun) {
    console.log('dry run: no shipments updated');
    return;
  }

  let matched = 0;
  let updated = 0;
  for (const event of latestByTracking.values()) {
    const count = await applyAjexTrackingToShipments(prisma, event);
    if (count > 0) {
      matched += 1;
      updated += count;
    }
  }

  console.log(`linked ${matched} waybills to ${updated} shipments`);
}

main()
  .catch((error) => {
    console.error('AJEX backfill failed', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
