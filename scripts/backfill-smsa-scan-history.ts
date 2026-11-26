/**
 * Rebuilds SMSA movement history from the raw webhooks kept in WebhookLog.
 * The webhook used to replace a shipment's scans on every post, and SMSA posts
 * one scan at a time, so only the newest scan survived. Additive only: scans
 * already stored are skipped, nothing is deleted.
 *
 * Usage: npx tsx scripts/backfill-smsa-scan-history.ts [--apply]   (dry run by default)
 */
import { prisma } from '@/lib/prisma';
import { normalizeShipments, smsaScanKey, type NormalizedScan } from '@/app/lib/smsa-webhook-payload';
import { appendSmsaScans } from '@/app/lib/smsa-scan-store';

const BATCH_SIZE = 2000;
const apply = process.argv.includes('--apply');

async function main() {
  const scansByAwb = new Map<string, NormalizedScan[]>();
  let cursor: string | undefined;
  let logs = 0;

  for (;;) {
    const batch = await prisma.webhookLog.findMany({
      where: { event: 'smsa.webhook' },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, json: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    logs += batch.length;
    for (const row of batch) {
      for (const shipment of normalizeShipments(row.json)) {
        const list = scansByAwb.get(shipment.awb) ?? [];
        list.push(...shipment.scans);
        scansByAwb.set(shipment.awb, list);
      }
    }
  }

  const shipments = await prisma.smsaWebhookShipment.findMany({
    where: { awb: { in: [...scansByAwb.keys()] } },
    select: { id: true, awb: true, scans: { select: { scanType: true, scanDateTime: true, scanDescription: true } } },
  });

  let missing = 0;
  let touched = 0;
  for (const shipment of shipments) {
    const stored = new Set(shipment.scans.map(smsaScanKey));
    const candidates = scansByAwb.get(shipment.awb) ?? [];
    const toAdd = new Set(candidates.map(smsaScanKey).filter((key) => !stored.has(key)));
    if (toAdd.size === 0) continue;
    missing += toAdd.size;
    touched += 1;
    if (apply) await appendSmsaScans(shipment.id, candidates);
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    webhookLogs: logs,
    awbsInLogs: scansByAwb.size,
    shipmentsMatched: shipments.length,
    shipmentsWithMissingScans: touched,
    scansMissing: missing,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
