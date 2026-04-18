import { loadEnvConfig } from '@next/env';
import fs from 'fs';
import path from 'path';
import process from 'process';
import { createInterface } from 'readline/promises';
import { prisma } from '@/lib/prisma';
import { syncOrderToERP } from '@/app/lib/erp-invoice';
import { log as logger } from '@/app/lib/logger';
import type { Prisma, SallaOrder } from '@prisma/client';

loadEnvConfig(process.cwd());

interface CliOptions {
  batchSize: number;
  force: boolean;
  once: boolean;
  delayMs: number;
  startDate?: string;
  endDate?: string;
  promptForDateRange: boolean;
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
const DATE_INPUT_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function printUsage(): void {
  console.log(`
ERP Orders Sync
===============

Syncs unsynced Salla orders to the ERP system using the same core logic as
the frontend ERP sync flow. Date filters use the same placedAt boundaries as
/order-reports.

Usage:
  npm run sync:erp-orders -- [options]
  npm run sync:erp-orders-range -- [options]

Options:
  -b, --batch-size <number>  Number of orders per batch (default: 1000)
  -f, --force                Force re-sync even if an order is already synced
  -o, --once                 Run a single batch (frontend behavior)
  -d, --delay <ms>           Delay between orders in milliseconds (default: 100)
  --start-date <YYYY-MM-DD>  Filter orders placed on/after this date
  --end-date <YYYY-MM-DD>    Filter orders placed on/before this date
  -p, --prompt               Prompt for a start/end date range in the terminal
  -h, --help                 Show this help message

Examples:
  npm run sync:erp-orders -- --start-date 2026-04-01 --end-date 2026-04-15
  npm run sync:erp-orders-range
`.trim());
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    batchSize: 1000,
    force: false,
    once: false,
    delayMs: 100,
    promptForDateRange: false,
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
      case '--start-date': {
        const value = args[++i];
        if (!value) throw new Error('Missing value for --start-date');
        options.startDate = value;
        break;
      }
      case '--end-date': {
        const value = args[++i];
        if (!value) throw new Error('Missing value for --end-date');
        options.endDate = value;
        break;
      }
      case '--prompt':
      case '-p':
        options.promptForDateRange = true;
        break;
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
        } else if (arg.startsWith('--start-date=')) {
          options.startDate = arg.split('=')[1] ?? '';
        } else if (arg.startsWith('--end-date=')) {
          options.endDate = arg.split('=')[1] ?? '';
        } else if (arg === '--force=true') {
          options.force = true;
        } else if (arg === '--once=true') {
          options.once = true;
        } else if (arg === '--prompt=true') {
          options.promptForDateRange = true;
        } else {
          throw new Error(`Unknown option "${arg}". Use --help to view usage.`);
        }
        break;
    }
  }

  return options;
}

function normalizeDateInput(value: string, label: string): string {
  const trimmed = value.trim();
  if (!DATE_INPUT_REGEX.test(trimmed)) {
    throw new Error(`${label} must be in YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new Error(`${label} is not a valid calendar date.`);
  }

  return trimmed;
}

function validateDateRange(options: CliOptions): CliOptions {
  const startDate = options.startDate
    ? normalizeDateInput(options.startDate, 'Start date')
    : undefined;
  const endDate = options.endDate
    ? normalizeDateInput(options.endDate, 'End date')
    : undefined;

  if (startDate && endDate && startDate > endDate) {
    throw new Error('Start date must be on or before end date.');
  }

  return {
    ...options,
    startDate,
    endDate,
  };
}

async function promptForDateRange(options: CliOptions): Promise<CliOptions> {
  if (!options.promptForDateRange || (options.startDate && options.endDate)) {
    return validateDateRange(options);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive date prompts require a TTY. Pass --start-date and --end-date when running non-interactively.'
    );
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const startDateInput = options.startDate
      ?? await readline.question('Start date (YYYY-MM-DD): ');
    const endDateInput = options.endDate
      ?? await readline.question('End date (YYYY-MM-DD): ');

    if (!startDateInput.trim() || !endDateInput.trim()) {
      throw new Error('Both start date and end date are required in prompt mode.');
    }

    return validateDateRange({
      ...options,
      startDate: startDateInput,
      endDate: endDateInput,
    });
  } finally {
    readline.close();
  }
}

function buildOrderWhereClause(options: CliOptions): Prisma.SallaOrderWhereInput {
  const whereClause: Prisma.SallaOrderWhereInput = {
    erpSyncedAt: null,
  };

  if (options.startDate || options.endDate) {
    whereClause.placedAt = {
      // Match /api/order-history/admin so the CLI selects the same date range as /order-reports.
      gte: options.startDate ? new Date(`${options.startDate}T00:00:00.000Z`) : undefined,
      lte: options.endDate ? new Date(`${options.endDate}T23:59:59.999Z`) : undefined,
    };
  }

  return whereClause;
}

function formatDateRange(options: CliOptions): string {
  if (!options.startDate && !options.endDate) {
    return 'all dates';
  }

  return `${options.startDate ?? '...'} → ${options.endDate ?? '...'}`;
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

async function processBatch(options: CliOptions): Promise<BatchSummary> {
  const whereClause = buildOrderWhereClause(options);
  const orders = await prisma.sallaOrder.findMany({
    where: whereClause,
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take: options.batchSize,
  });

  if (orders.length === 0) {
    return { total: 0, successful: 0, failed: 0, skipped: 0 };
  }

  logger.info('Starting ERP CLI batch sync', {
    orders: orders.length,
    limit: options.batchSize,
    force: options.force,
    startDate: options.startDate,
    endDate: options.endDate,
  });

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  for (const order of orders) {
    try {
      const result = await syncOrderToERP(order, options.force);
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

    await delay(options.delayMs);
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
    const options = await promptForDateRange(parseCliArgs());
    const whereClause = buildOrderWhereClause(options);
    const totalMatchingOrders = await prisma.sallaOrder.count({
      where: whereClause,
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' ERP Orders Sync');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Batch size : ${options.batchSize}`);
    console.log(`Force sync : ${options.force ? 'enabled' : 'disabled'}`);
    console.log(`Delay      : ${options.delayMs}ms between orders`);
    console.log(`Date range : ${formatDateRange(options)}`);
    console.log(`Mode       : ${options.once ? 'single batch' : 'until all unsynced orders are processed'}`);
    console.log(`Matched    : ${totalMatchingOrders} unsynced order(s)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const aggregate: BatchSummary = { total: 0, successful: 0, failed: 0, skipped: 0 };
    let batchNumber = 1;

    while (true) {
      console.log(`Starting batch #${batchNumber}...`);
      const batch = await processBatch(options);
      if (batch.total === 0) {
        if (batchNumber === 1) {
          console.log(`No unsynced orders found for ${formatDateRange(options)}.`);
        } else {
          console.log(`All unsynced orders processed for ${formatDateRange(options)}.`);
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
