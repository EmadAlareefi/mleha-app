/**
 * Backfills SallaOrderItem for existing orders so the returns-analytics
 * "sales by SKU" feature has local data to read instead of live-fetching
 * from Salla on every page load.
 *
 * Prefers already-stored WebhookEvent.rawPayload (zero Salla API calls) and
 * only falls back to a live `/orders/items` fetch (rate-limit aware, with
 * backoff/retry) for orders with no local webhook history. Safe to re-run —
 * orders that already have SallaOrderItem rows are skipped.
 *
 * Usage: npx tsx scripts/backfill-order-items.ts [--days=120]
 */
import { loadEnvConfig } from '@next/env';
import process from 'process';
loadEnvConfig(process.cwd());

import { prisma } from '@/lib/prisma';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { getSallaOrderItems, type SallaOrderItem } from '@/app/lib/salla-api';
import { extractItemsFromWebhookPayload, upsertSallaOrderItems } from '@/app/lib/salla-order-items';

const DAYS = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] ?? '120');
const CHUNK_SIZE = 500;
const CONCURRENCY = 4;
const MAX_RETRIES = 5;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchItemsWithBackoff(merchantId: string, orderId: string): Promise<SallaOrderItem[] | null> {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    const items = await getSallaOrderItems(merchantId, orderId);
    if (items !== null) {
      return items;
    }
    attempt++;
    const delay = Math.min(30000, 1000 * 2 ** attempt);
    await sleep(delay);
  }
  return null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function main() {
  const resolved = await resolveSallaMerchantId();
  if (!resolved.merchantId) {
    console.error('No merchant:', resolved.error);
    process.exit(1);
  }
  const merchantId = resolved.merchantId;
  const startDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  console.log(`Backfilling order items for merchant ${merchantId}, orders placed since ${startDate.toISOString()}`);

  const orders = await prisma.sallaOrder.findMany({
    where: { merchantId, placedAt: { gte: startDate } },
    select: { orderId: true },
    orderBy: { placedAt: 'desc' },
  });

  const existing = await prisma.sallaOrderItem.findMany({
    where: { merchantId, orderId: { in: orders.map((o) => o.orderId) } },
    select: { orderId: true },
    distinct: ['orderId'],
  });
  const alreadyDone = new Set(existing.map((e) => e.orderId));
  const pending = orders.filter((o) => !alreadyDone.has(o.orderId));

  console.log(
    `Total orders in range: ${orders.length}, already backfilled: ${alreadyDone.size}, pending: ${pending.length}`
  );

  let fromWebhook = 0;
  let fromApi = 0;
  let failed = 0;
  let processed = 0;

  const chunks = chunk(pending, CHUNK_SIZE);
  for (const [chunkIndex, batch] of chunks.entries()) {
    const events = await prisma.webhookEvent.findMany({
      where: { orderId: { in: batch.map((o) => o.orderId) } },
      orderBy: { receivedAt: 'asc' },
      select: { orderId: true, rawPayload: true },
    });

    const latestItemsByOrder = new Map<string, ReturnType<typeof extractItemsFromWebhookPayload>>();
    events.forEach((e) => {
      if (!e.orderId) return;
      const items = extractItemsFromWebhookPayload(e.rawPayload);
      if (items.length > 0) {
        latestItemsByOrder.set(e.orderId, items);
      }
    });

    let cursor = 0;
    async function worker() {
      while (cursor < batch.length) {
        const idx = cursor++;
        const { orderId } = batch[idx];

        let items = latestItemsByOrder.get(orderId) || [];
        let source: 'webhook' | 'api' = 'webhook';

        if (items.length === 0) {
          const apiItems = await fetchItemsWithBackoff(merchantId, orderId);
          if (apiItems && apiItems.length > 0) {
            items = apiItems;
            source = 'api';
          }
        }

        if (items.length > 0) {
          const result = await upsertSallaOrderItems(merchantId, orderId, items, source);
          if (result.stored > 0) {
            if (source === 'webhook') fromWebhook++;
            else fromApi++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }

        processed++;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    console.log(
      `Chunk ${chunkIndex + 1}/${chunks.length} done. Progress: ${processed}/${pending.length} ` +
        `(webhook: ${fromWebhook}, api: ${fromApi}, failed: ${failed})`
    );
  }

  console.log(`\nDone. Total pending processed: ${processed}`);
  console.log(`From local webhook data (no API call): ${fromWebhook}`);
  console.log(`From live API fallback: ${fromApi}`);
  console.log(`Failed (no items found anywhere): ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
