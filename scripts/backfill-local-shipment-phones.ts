import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { prisma } from '@/lib/prisma';
import { normalizeE164Phone } from '@/app/lib/phone';

/**
 * Backfills `LocalShipment.customerPhone` to E.164.
 *
 * Shipments created before the create route normalized the number stored
 * Salla's bare `5xxxxxxxx`, which no SMS/WhatsApp gateway can deliver to.
 * Runs as a dry run unless `--apply` is passed.
 */
async function main() {
  const apply = process.argv.includes('--apply');

  const shipments = await prisma.localShipment.findMany({
    select: { id: true, orderNumber: true, customerPhone: true },
  });

  const changes: { id: string; orderNumber: string; from: string; to: string }[] = [];
  const unfixable: { orderNumber: string; phone: string }[] = [];

  for (const shipment of shipments) {
    const current = (shipment.customerPhone || '').trim();
    if (!current || current === '0000000000') continue;

    const normalized = normalizeE164Phone(current);
    if (!normalized) {
      unfixable.push({ orderNumber: shipment.orderNumber, phone: current });
      continue;
    }
    if (normalized === current) continue;

    // These rows are Saudi numbers that lost their country code. A stored
    // number with no explicit prefix that does not resolve to a Saudi mobile
    // is malformed rather than merely unprefixed, and guessing a country for
    // it would write a plausible-looking wrong number, so leave it for review.
    const wasExplicitlyInternational =
      current.startsWith('+') || current.replace(/\D/g, '').startsWith('00');
    if (!wasExplicitlyInternational && !normalized.startsWith('+9665')) {
      unfixable.push({ orderNumber: shipment.orderNumber, phone: current });
      continue;
    }

    changes.push({
      id: shipment.id,
      orderNumber: shipment.orderNumber,
      from: current,
      to: normalized,
    });
  }

  console.log(`scanned:   ${shipments.length}`);
  console.log(`to update: ${changes.length}`);
  console.log(`unfixable: ${unfixable.length}`);

  for (const change of changes.slice(0, 10)) {
    console.log(`  ${change.orderNumber}: ${change.from} -> ${change.to}`);
  }
  if (changes.length > 10) console.log(`  ... and ${changes.length - 10} more`);

  for (const row of unfixable.slice(0, 20)) {
    console.log(`  UNFIXABLE ${row.orderNumber}: "${row.phone}"`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write these changes.');
    return;
  }

  // One round trip per row is slow enough against a remote database that an
  // interrupted run is likely. Batching keeps it short, and because a row that
  // already holds the normalized value is skipped above, re-running is safe.
  const CHUNK_SIZE = 100;
  let updated = 0;

  for (let i = 0; i < changes.length; i += CHUNK_SIZE) {
    const chunk = changes.slice(i, i + CHUNK_SIZE);
    await prisma.$transaction(
      chunk.map((change) =>
        prisma.localShipment.update({
          where: { id: change.id },
          data: { customerPhone: change.to },
        })
      )
    );
    updated += chunk.length;
    console.log(`  updated ${updated}/${changes.length}`);
  }

  console.log(`\nupdated ${updated} shipments.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
