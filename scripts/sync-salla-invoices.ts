import { loadEnvConfig } from '@next/env';
import process from 'process';
import { syncSallaInvoices } from '@/app/lib/salla-invoices';
import { prisma } from '@/lib/prisma';

loadEnvConfig(process.cwd());

interface CliOptions {
  merchantId?: string;
  perPage?: number;
  startDate?: string;
  endDate?: string;
  help?: boolean;
}

function printUsage(): void {
  console.log(`
Salla Invoice Sync CLI
======================

Fetches invoices directly from https://api.salla.dev/admin/v2/orders/invoices using the
stored tokens inside the SallaAuth table and persists them locally.

Usage:
  npm run sync:salla-invoices -- [options]

Options:
  -m, --merchant <id>      Limit sync to a single merchant ID
  -s, --start-date <date>  Start date filter (YYYY-MM-DD)
  -e, --end-date <date>    End date filter (YYYY-MM-DD)
  -p, --per-page <number>  Items per page (10-200, default 50)
  -h, --help               Show this help

Examples:
  npm run sync:salla-invoices
  npm run sync:salla-invoices -- --merchant 123456 --start-date 2024-01-01 --end-date 2024-03-31
`.trim());
}

function parseDate(value?: string): string | undefined {
  if (!value) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!match) {
    throw new Error(`Invalid date "${value}". Expected format YYYY-MM-DD.`);
  }
  return value;
}

function clampPerPage(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 10 || value > 200) {
    throw new Error('perPage must be an integer between 10 and 200.');
  }
  return value;
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        return options;
      case '--merchant':
      case '-m':
        options.merchantId = args[++i];
        break;
      case '--start-date':
      case '--startDate':
      case '-s':
        options.startDate = parseDate(args[++i]);
        break;
      case '--end-date':
      case '--endDate':
      case '-e':
        options.endDate = parseDate(args[++i]);
        break;
      case '--per-page':
      case '--perPage':
      case '-p':
        options.perPage = clampPerPage(Number.parseInt(args[++i] ?? '', 10));
        break;
      default:
        if (arg.startsWith('--per-page=')) {
          options.perPage = clampPerPage(Number.parseInt(arg.split('=')[1] ?? '', 10));
        } else if (arg.startsWith('--merchant=')) {
          options.merchantId = arg.split('=')[1];
        } else if (arg.startsWith('--start-date=')) {
          options.startDate = parseDate(arg.split('=')[1]);
        } else if (arg.startsWith('--end-date=')) {
          options.endDate = parseDate(arg.split('=')[1]);
        } else if (arg.startsWith('--')) {
          throw new Error(`Unknown option "${arg}". Use --help to view usage.`);
        } else {
          throw new Error(`Unexpected argument "${arg}". Use --help to view usage.`);
        }
        break;
    }
  }

  return options;
}

type ExitStatus = 'success' | 'partial' | 'failed';

function summarizeStatus(stats: Awaited<ReturnType<typeof syncSallaInvoices>>): ExitStatus {
  const failedMerchants = stats.filter(
    (stat) => stat.pagesProcessed === 0 && stat.invoicesFetched === 0 && stat.errors.length > 0
  );

  if (failedMerchants.length === stats.length && stats.length > 0) {
    return 'failed';
  }

  if (failedMerchants.length > 0) {
    return 'partial';
  }

  if (stats.some((stat) => stat.errors.length > 0)) {
    return 'partial';
  }

  return 'success';
}

async function main() {
  try {
    const cliOptions = parseCliArgs();

    if (cliOptions.help) {
      printUsage();
      return;
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' Salla Invoice Sync');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (cliOptions.merchantId) {
      console.log(`Merchant: ${cliOptions.merchantId}`);
    } else {
      console.log('Merchant: All configured merchants');
    }
    if (cliOptions.startDate || cliOptions.endDate) {
      console.log(`Date Range: ${cliOptions.startDate ?? '∞'} → ${cliOptions.endDate ?? '∞'}`);
    }
    if (cliOptions.perPage) {
      console.log(`Per Page: ${cliOptions.perPage}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const stats = await syncSallaInvoices({
      merchantId: cliOptions.merchantId,
      perPage: cliOptions.perPage,
      startDate: cliOptions.startDate,
      endDate: cliOptions.endDate,
    });

    if (stats.length === 0) {
      console.log('No merchants found in SallaAuth. Please insert credentials before running this script.');
      process.exitCode = 1;
      return;
    }

    for (const stat of stats) {
      console.log(`Merchant ${stat.merchantId}`);
      console.log('----------------------------------------');
      console.log(`Pages processed : ${stat.pagesProcessed}`);
      console.log(`Invoices fetched: ${stat.invoicesFetched}`);
      console.log(`Invoices stored : ${stat.invoicesStored}`);
      console.log(`Order lookups   : ${stat.orderLookups}`);
      if (stat.errors.length > 0) {
        console.log(`Errors (${stat.errors.length}):`);
        for (const err of stat.errors.slice(0, 5)) {
          console.log(`  - [Invoice ${err.invoiceId ?? 'n/a'}] ${err.message}`);
        }
        if (stat.errors.length > 5) {
          console.log(`  ...and ${stat.errors.length - 5} more`);
        }
      } else {
        console.log('Errors          : none');
      }
      console.log('');
    }

    const status = summarizeStatus(stats);
    if (status === 'failed') {
      console.error('Sync failed for every merchant.');
      process.exitCode = 1;
    } else if (status === 'partial') {
      console.warn('Sync completed with some errors. Review the logs above.');
      process.exitCode = 2;
    } else {
      console.log('Sync completed successfully.');
    }
  } catch (error) {
    console.error('Invoice sync failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
