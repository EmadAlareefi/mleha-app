import { loadEnvConfig } from '@next/env';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { prisma } from '@/lib/prisma';
import { syncOrderToERP } from '@/app/lib/erp-invoice';
import { log as logger } from '@/app/lib/logger';
import type { SallaOrder } from '@prisma/client';

loadEnvConfig(process.cwd());

interface CliOptions {
  batchSize: number;
  force: boolean;
  once: boolean;
  delayMs: number;
}

interface BatchSummary {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
}

const skuLogFilePath = path.resolve(__dirname, 'erp-sync-missing-skus.txt');
const missingSkuEntries = new Map<string, { orderRef: string; sku: string; message: string }>();
const SKU_REGEX = /\bsku\b[^A-Za-z0-9]*([A-Za-z0-9_-]+)/gi;

function printUsage(): void {
  console.log(`
ERP Unsynced Orders Sync
========================

Syncs unsynced Salla orders to the ERP system using the same logic as
the ERP settings page (POST /api/erp/sync-orders-batch).

Usage:
  npm run sync:erp-orders -- [options]

Options:
  -b, --batch-size <number>  Number of orders per batch (default: 1000)
  -f, --force                Force re-sync even if an order is already synced
  -o, --once                 Run a single batch (frontend behavior)
  -d, --delay <ms>           Delay between orders in milliseconds (default: 100)
  -h, --help                 Show this help message
`.trim());
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    batchSize: 1000,
    force: false,
    once: false,
    delayMs: 100,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      case '--batch-size':
      case '--batch':
      case '-b': {
        const value = args[++i];
        if (!value) throw new Error('Missing value for --batch-size');
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('Batch size must be a positive integer.');
        }
        options.batchSize = parsed;
        break;
      }
      case '--force':
      case '-f':
        options.force = true;
        break;
      case '--once':
      case '-o':
        options.once = true;
        break;
      case '--delay':
      case '-d': {
        const value = args[++i];
        if (!value) throw new Error('Missing value for --delay');
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error('Delay must be a non-negative integer.');
        }
        options.delayMs = parsed;
        break;
      }
      default:
        if (arg.startsWith('--batch-size=')) {
          const parsed = Number.parseInt(arg.split('=')[1] ?? '', 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error('Batch size must be a positive integer.');
          }
          options.batchSize = parsed;
        } else if (arg.startsWith('--delay=')) {
          const parsed = Number.parseInt(arg.split('=')[1] ?? '', 10);
          if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error('Delay must be a non-negative integer.');
          }
          options.delayMs = parsed;
        } else if (arg === '--force=true') {
          options.force = true;
        } else if (arg === '--once=true') {
          options.once = true;
        } else {
          throw new Error(`Unknown option "${arg}". Use --help to view usage.`);
        }
        break;
    }
  }

  return options;
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSkusFromMessage(message?: string): string[] {
  if (!message) return [];
  const matches: string[] = [];
  const normalized = message.replace(/\s+/g, ' ');

  for (const match of normalized.matchAll(SKU_REGEX)) {
    const sku = match[1]?.trim();
    if (sku) {
      matches.push(sku);
    }
  }

  return matches;
}

function trackMissingSkus(order: SallaOrder, ...messages: Array<string | undefined>) {
  const orderRef = order.orderNumber ?? order.orderId;
  for (const message of messages) {
    const skus = extractSkusFromMessage(message);
    for (const sku of skus) {
      const key = `${orderRef}:${sku}`;
      if (!missingSkuEntries.has(key)) {
        missingSkuEntries.set(key, {
          orderRef,
          sku,
          message: (message ?? '').replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
}

async function flushMissingSkuLog(): Promise<void> {
  if (missingSkuEntries.size === 0) return;
  const timestamp = new Date().toISOString();
  const lines: string[] = [];

  for (const entry of missingSkuEntries.values()) {
    lines.push(`${timestamp}\t${entry.orderRef}\t${entry.sku}\t${entry.message}`);
  }

  await fs.promises.appendFile(skuLogFilePath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Logged ${missingSkuEntries.size} SKU issue(s) to ${path.relative(process.cwd(), skuLogFilePath)}`);
}

async function processBatch(limit: number, force: boolean, delayMs: number): Promise<BatchSummary> {
  const orders = await prisma.sallaOrder.findMany({
    where: { erpSyncedAt: null },
    orderBy: { placedAt: 'desc' },
    take: limit,
  });

  if (orders.length === 0) {
    return { total: 0, successful: 0, failed: 0, skipped: 0 };
  }

  logger.info('Starting ERP CLI batch sync', { orders: orders.length, limit, force });

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  for (const order of orders) {
    try {
      const result = await syncOrderToERP(order, force);
      const wasSkipped = result.success && result.message?.includes('already synced');

      if (result.success && !wasSkipped) {
        await prisma.sallaOrder.update({
          where: { id: order.id },
          data: {
            erpSyncedAt: new Date(),
            erpInvoiceId: result.erpInvoiceId ? String(result.erpInvoiceId) : null,
            erpSyncError: null,
            erpSyncAttempts: { increment: 1 },
          },
        });
        successful += 1;
        console.log(`✔ Synced order ${order.orderNumber ?? order.orderId} → Invoice ${result.erpInvoiceId ?? 'n/a'}`);
      } else if (wasSkipped) {
        skipped += 1;
        console.log(`↷ Skipped order ${order.orderNumber ?? order.orderId}: ${result.message}`);
      } else {
        await prisma.sallaOrder.update({
          where: { id: order.id },
          data: {
            erpSyncError: result.error || result.message || 'Unknown error',
            erpSyncAttempts: { increment: 1 },
          },
        });
        failed += 1;
        console.error(`✖ Failed order ${order.orderNumber ?? order.orderId}: ${result.error || result.message}`);
        trackMissingSkus(order, result.error, result.message);
      }
    } catch (error: any) {
      await prisma.sallaOrder.update({
        where: { id: order.id },
        data: {
          erpSyncError: error.message || 'Unknown error',
          erpSyncAttempts: { increment: 1 },
        },
      });
      failed += 1;
      console.error(`✖ Failed order ${order.orderNumber ?? order.orderId}: ${error.message ?? error}`);
      trackMissingSkus(order, error.message ?? String(error));
    }

    await delay(delayMs);
  }

  logger.info('ERP CLI batch sync completed', {
    total: orders.length,
    successful,
    failed,
    skipped,
  });

  return {
    total: orders.length,
    successful,
    failed,
    skipped,
  };
}

async function main() {
  try {
    const options = parseCliArgs();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' ERP Unsynced Orders Sync');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Batch size : ${options.batchSize}`);
    console.log(`Force sync : ${options.force ? 'enabled' : 'disabled'}`);
    console.log(`Delay      : ${options.delayMs}ms between orders`);
    console.log(`Mode       : ${options.once ? 'single batch' : 'until all unsynced orders are processed'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const aggregate: BatchSummary = { total: 0, successful: 0, failed: 0, skipped: 0 };
    let batchNumber = 1;

    while (true) {
      console.log(`Starting batch #${batchNumber}...`);
      const batch = await processBatch(options.batchSize, options.force, options.delayMs);
      if (batch.total === 0) {
        if (batchNumber === 1) {
          console.log('No unsynced orders found.');
        } else {
          console.log('All unsynced orders processed.');
        }
        break;
      }

      aggregate.total += batch.total;
      aggregate.successful += batch.successful;
      aggregate.failed += batch.failed;
      aggregate.skipped += batch.skipped;

      console.log(`Batch #${batchNumber} complete → synced: ${batch.successful}, skipped: ${batch.skipped}, failed: ${batch.failed}`);

      if (options.once) {
        console.log('Single batch mode enabled, stopping after first batch.');
        break;
      }

      batchNumber += 1;
    }

    console.log('\nSummary');
    console.log('----------------------------------------');
    console.log(`Orders processed : ${aggregate.total}`);
    console.log(`Synced           : ${aggregate.successful}`);
    console.log(`Skipped          : ${aggregate.skipped}`);
    console.log(`Failed           : ${aggregate.failed}`);

    if (aggregate.failed > 0) {
      console.error('\nSome orders failed to sync. Check logs for details.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('ERP sync script failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await flushMissingSkuLog();
    await prisma.$disconnect();
  }
}

main();
