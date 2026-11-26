import { prisma } from '@/lib/prisma';
import { smsaScanKey, type NormalizedScan } from '@/app/lib/smsa-webhook-payload';

/**
 * Adds scans to a shipment's SMSA history. SMSA usually posts only its newest
 * scan, so earlier ones are kept; scans already stored (resends) are skipped.
 * Returns how many scans were added.
 */
export async function appendSmsaScans(shipmentId: string, scans: NormalizedScan[]): Promise<number> {
  if (scans.length === 0) return 0;
  const existing = await prisma.smsaWebhookScan.findMany({
    where: { shipmentId },
    select: { scanType: true, scanDateTime: true, scanDescription: true },
  });
  const seen = new Set(existing.map(smsaScanKey));
  const fresh = scans.filter((scan) => {
    const key = smsaScanKey(scan);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (fresh.length === 0) return 0;
  await prisma.smsaWebhookScan.createMany({
    data: fresh.map((scan) => ({
      shipmentId,
      referenceId: scan.referenceId,
      city: scan.city,
      scanType: scan.scanType,
      scanDescription: scan.scanDescription,
      scanDateTime: scan.scanDateTime,
      scanTimeZone: scan.scanTimeZone,
      receivedBy: scan.receivedBy,
    })),
  });
  return fresh.length;
}
