import nextEnv from '@next/env';
import path from 'path';
import process from 'process';
import XLSX from 'xlsx';
import prismaPkg from '@prisma/client';
import {
  postInvoiceToERP,
  transformOrderToERPInvoice,
} from '../app/lib/erp-invoice.ts';

const { loadEnvConfig } = nextEnv;
const { PrismaClient } = prismaPkg;

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

const DEFAULT_FILE = 'invoices.xlsx';
const HEADER_ROW_LABEL = 'النوع';
const REQUIRED_HEADERS = [
  'النوع',
  'الرقم',
  'اجمالي الفاتورة',
  'اسم العميل او الحساب',
];
const ORDER_NUMBER_REGEX = /(\d{6,})/;

function printUsage() {
  console.log(`
ERP Refund Import
=================

Reads invoice rows from an Excel file and posts ERP refund invoices using the
existing postInvoiceToERP helper. Dry-run is the default mode.

Usage:
  npm run refunds:erp-xlsx -- [options]

Options:
  --file <path>      Excel file path (default: invoices.xlsx)
  --sheet <name>     Worksheet name to read (default: first sheet)
  --apply            Post refund invoices to ERP
  --limit <number>   Only process the first N unique order rows
  --help, -h         Show this help

Examples:
  npm run refunds:erp-xlsx
  npm run refunds:erp-xlsx -- --limit 20
  npm run refunds:erp-xlsx -- --apply
`.trim());
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    file: DEFAULT_FILE,
    apply: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      case '--file': {
        const value = args[++i];
        if (!value) throw new Error('Missing value for --file');
        options.file = value;
        break;
      }
      case '--sheet': {
        const value = args[++i];
        if (!value) throw new Error('Missing value for --sheet');
        options.sheet = value;
        break;
      }
      case '--limit': {
        const value = args[++i];
        if (!value) throw new Error('Missing value for --limit');
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('Limit must be a positive integer.');
        }
        options.limit = parsed;
        break;
      }
      case '--apply':
        options.apply = true;
        break;
      default:
        if (arg.startsWith('--file=')) {
          options.file = arg.slice('--file='.length);
        } else if (arg.startsWith('--sheet=')) {
          options.sheet = arg.slice('--sheet='.length);
        } else if (arg.startsWith('--limit=')) {
          const parsed = Number.parseInt(arg.slice('--limit='.length), 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            throw new Error('Limit must be a positive integer.');
          }
          options.limit = parsed;
        } else {
          throw new Error(`Unknown option "${arg}". Use --help to view usage.`);
        }
        break;
    }
  }

  return options;
}

function normalize(value) {
  return String(value ?? '').trim();
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function findHeaderRow(rows) {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalize);
    return REQUIRED_HEADERS.every((required) => headers.includes(required)) && headers.includes(HEADER_ROW_LABEL);
  });

  if (headerIndex === -1) {
    throw new Error('Unable to find the invoice header row in the workbook.');
  }

  return headerIndex;
}

function parseInvoiceRows(filePath, sheetName, limit) {
  const workbook = XLSX.readFile(filePath);
  const resolvedSheetName = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[resolvedSheetName];

  if (!worksheet) {
    throw new Error(`Worksheet "${resolvedSheetName}" was not found in ${filePath}.`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  const headerRowIndex = findHeaderRow(rows);
  const headers = rows[headerRowIndex].map(normalize);
  const dataRows = rows.slice(headerRowIndex + 1);
  const parsedRows = [];
  const seenOrderNumbers = new Set();

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, row[headerIndex]]));
    const customerText = normalize(record['اسم العميل او الحساب']);

    if (!customerText) {
      continue;
    }

    const orderNumberMatch = customerText.match(ORDER_NUMBER_REGEX);
    if (!orderNumberMatch) {
      continue;
    }

    const orderNumber = orderNumberMatch[1];
    if (seenOrderNumbers.has(orderNumber)) {
      parsedRows.push({
        rowNumber: headerRowIndex + index + 2,
        orderNumber,
        duplicateOfSheet: true,
      });
      continue;
    }

    seenOrderNumbers.add(orderNumber);
    parsedRows.push({
      rowNumber: headerRowIndex + index + 2,
      orderNumber,
      duplicateOfSheet: false,
    });

    if (limit && seenOrderNumbers.size >= limit) {
      break;
    }
  }

  return parsedRows;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchOrdersByOrderNumbers(orderNumbers) {
  const result = new Map();
  const uniqueOrderNumbers = Array.from(new Set(orderNumbers));

  for (const batch of chunkArray(uniqueOrderNumbers, 200)) {
    const orders = await prisma.sallaOrder.findMany({
      where: {
        orderNumber: {
          in: batch,
        },
      },
    });

    for (const order of orders) {
      if (order.orderNumber) {
        result.set(order.orderNumber, order);
      }
    }
  }

  return result;
}

function forceRefundOrder(order) {
  return {
    ...order,
    statusSlug: 'refund',
  };
}

function computePayloadTotal(payload) {
  const lineTotal = payload.API_Inv.reduce((sum, item) => {
    const subtotal = Number(item.price) * Number(item.qty);
    const discount = subtotal * (Number(item.discpc) / 100);
    return sum + (subtotal - discount);
  }, 0);

  return roundCurrency(lineTotal - Number(payload.hinvdsvl || 0));
}

async function prepareRefunds(rows) {
  const ordersByNumber = await fetchOrdersByOrderNumbers(
    rows.filter((row) => !row.duplicateOfSheet).map((row) => row.orderNumber)
  );

  const prepared = [];
  const skipped = [];

  for (const row of rows) {
    if (row.duplicateOfSheet) {
      skipped.push({ row, reason: 'Duplicate order number in the sheet.' });
      continue;
    }

    const order = ordersByNumber.get(row.orderNumber);
    if (!order) {
      skipped.push({ row, reason: 'Order not found in sallaOrder.' });
      continue;
    }

    try {
      const payload = await transformOrderToERPInvoice(forceRefundOrder(order));
      prepared.push({
        row,
        order,
        payload,
        refundAmount: computePayloadTotal(payload),
      });
    } catch (error) {
      skipped.push({
        row,
        reason: error instanceof Error ? error.message : 'Failed to build ERP refund payload.',
      });
    }
  }

  return { prepared, skipped };
}

function printSummary(prepared, skipped, options) {
  const totalRefundAmount = roundCurrency(
    prepared.reduce((sum, item) => sum + item.refundAmount, 0)
  );

  console.log('');
  console.log(options.apply ? 'Apply Summary' : 'Dry Run Summary');
  console.log('----------------');
  console.log(`Refund invoices ${options.apply ? 'posted' : 'to post'}: ${prepared.length}`);
  console.log(`Skipped rows: ${skipped.length}`);
  console.log(`Total refund amount: ${totalRefundAmount.toFixed(2)} SAR`);

  if (prepared.length > 0) {
    console.log('');
    console.log('Preview:');
    for (const item of prepared.slice(0, 10)) {
      console.log(
        `  row ${item.row.rowNumber} | order ${item.order.orderNumber} | ERP type ${item.payload.ltrtype} | refund ${item.refundAmount.toFixed(2)} SAR`
      );
    }
    if (prepared.length > 10) {
      console.log(`  ... ${prepared.length - 10} more`);
    }
  }

  if (skipped.length > 0) {
    console.log('');
    console.log('Skipped:');
    for (const item of skipped.slice(0, 10)) {
      console.log(`  row ${item.row.rowNumber} | order ${item.row.orderNumber} | ${item.reason}`);
    }
    if (skipped.length > 10) {
      console.log(`  ... ${skipped.length - 10} more`);
    }
  }
}

async function applyRefunds(prepared) {
  const results = [];

  for (const item of prepared) {
    const result = await postInvoiceToERP(item.payload);
    results.push({
      rowNumber: item.row.rowNumber,
      orderNumber: item.order.orderNumber,
      refundAmount: item.refundAmount,
      result,
    });
  }

  return results;
}

function printApplyResults(results) {
  const successCount = results.filter((item) => item.result.success).length;
  const failed = results.filter((item) => !item.result.success);

  console.log('');
  console.log(`ERP refund success: ${successCount}/${results.length}`);

  if (failed.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const item of failed.slice(0, 10)) {
      console.log(
        `  row ${item.rowNumber} | order ${item.orderNumber} | ${item.result.error || item.result.message || 'Unknown error'}`
      );
    }
    if (failed.length > 10) {
      console.log(`  ... ${failed.length - 10} more`);
    }
  }
}

async function main() {
  const options = parseCliArgs();
  const filePath = path.resolve(process.cwd(), options.file);
  const rows = parseInvoiceRows(filePath, options.sheet, options.limit);

  if (rows.length === 0) {
    throw new Error(`No invoice rows were parsed from ${filePath}.`);
  }

  console.log('[info] Preparing ERP refund import', {
    filePath,
    sheet: options.sheet,
    rows: rows.length,
    apply: options.apply,
  });

  const { prepared, skipped } = await prepareRefunds(rows);
  printSummary(prepared, skipped, options);

  if (!options.apply) {
    return;
  }

  if (prepared.length === 0) {
    console.log('');
    console.log('No ERP refund invoices were posted.');
    return;
  }

  const results = await applyRefunds(prepared);
  printApplyResults(results);
}

main()
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
