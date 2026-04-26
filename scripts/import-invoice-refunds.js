const { loadEnvConfig } = require('@next/env');
const path = require('path');
const process = require('process');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

const logger = {
  info(message, payload) {
    console.log(`[info] ${message}`, payload ?? '');
  },
};

const DEFAULT_FILE = 'invoices.xlsx';
const HEADER_ROW_LABEL = 'النوع';
const REQUIRED_HEADERS = [
  'النوع',
  'الرقم',
  'اجمالي الفاتورة',
  'اسم العميل او الحساب',
];
const NET_INVOICE_TOTAL_HEADER = 'صافي الفاتورة';
const DELIVERY_DATE_HEADER = 'تاريخ التسليم';
const ORDER_NUMBER_REGEX = /(\d{6,})/;
const IMPORT_REVIEWED_BY = 'script:invoice-refund-import';
const IMPORT_REASON = 'imported_full_refund';

function printUsage() {
  console.log(`
Invoice Refund Import
=====================

Reads invoice rows from an Excel file and prepares one full refund return request
per invoice row. Dry-run is the default mode.

Usage:
  npm run refunds:import-xlsx -- [options]

Options:
  --file <path>        Excel file path (default: invoices.xlsx)
  --sheet <name>       Worksheet name to read (default: first sheet)
  --apply              Create refund records in the database
  --limit <number>     Only process the first N valid invoice rows
  --use-sheet-total    Use "صافي الفاتورة" from the sheet as the refund amount
  --help, -h           Show this help

Examples:
  npm run refunds:import-xlsx
  npm run refunds:import-xlsx -- --limit 20
  npm run refunds:import-xlsx -- --apply
  npm run refunds:import-xlsx -- --apply --use-sheet-total
`.trim());
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    file: DEFAULT_FILE,
    apply: false,
    useSheetTotal: false,
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
        if (!value) {
          throw new Error('Missing value for --file');
        }
        options.file = value;
        break;
      }
      case '--sheet': {
        const value = args[++i];
        if (!value) {
          throw new Error('Missing value for --sheet');
        }
        options.sheet = value;
        break;
      }
      case '--limit': {
        const value = args[++i];
        if (!value) {
          throw new Error('Missing value for --limit');
        }
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
      case '--use-sheet-total':
        options.useSheetTotal = true;
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

function normalizeHeader(value) {
  return String(value ?? '').trim();
}

function normalizeCellString(value) {
  return String(value ?? '').trim();
}

function toNumberOrNull(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function getAmountValue(value) {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === 'object') {
    if ('amount' in value) {
      return getAmountValue(value.amount);
    }
    if ('value' in value) {
      return getAmountValue(value.value);
    }
  }

  return 0;
}

function getShippingTotal(shippingCost, shippingTax) {
  return roundCurrency(getAmountValue(shippingCost) + getAmountValue(shippingTax));
}

function findHeaderRow(rows) {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
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
  const headers = rows[headerRowIndex].map(normalizeHeader);
  const dataRows = rows.slice(headerRowIndex + 1);
  const parsedRows = [];

  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const record = Object.fromEntries(headers.map((header, headerIndex) => [header, row[headerIndex]]));
    const invoiceType = normalizeCellString(record['النوع']);
    const customerText = normalizeCellString(record['اسم العميل او الحساب']);

    if (!invoiceType && !customerText) {
      continue;
    }

    const orderNumberMatch = customerText.match(ORDER_NUMBER_REGEX);
    if (!orderNumberMatch) {
      continue;
    }

    parsedRows.push({
      rowNumber: headerRowIndex + index + 2,
      invoiceType,
      sequenceNumber: normalizeCellString(record['الرقم']),
      orderNumber: orderNumberMatch[1],
      customerText,
      invoiceTotal: toNumberOrNull(record['اجمالي الفاتورة']),
      netInvoiceTotal: toNumberOrNull(record[NET_INVOICE_TOTAL_HEADER]),
      deliveryDate: normalizeCellString(record[DELIVERY_DATE_HEADER]),
    });

    if (limit && parsedRows.length >= limit) {
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

async function fetchExistingRequests(orders) {
  const orderKeys = orders.map((order) => ({
    merchantId: order.merchantId,
    orderId: order.orderId,
  }));
  const existing = new Map();

  for (const batch of chunkArray(orderKeys, 200)) {
    const requests = await prisma.returnRequest.findMany({
      where: {
        OR: batch,
      },
      select: {
        id: true,
        merchantId: true,
        orderId: true,
      },
    });

    for (const request of requests) {
      existing.set(`${request.merchantId}:${request.orderId}`, request.id);
    }
  }

  return existing;
}

function extractVariantName(item) {
  const names = Array.isArray(item.options)
    ? item.options
        .flatMap((option) => {
          const directName = normalizeCellString(option?.value?.name);
          if (directName) {
            return [directName];
          }

          if (Array.isArray(option?.values)) {
            return option.values
              .map((value) => normalizeCellString(value?.name))
              .filter(Boolean);
          }

          return [];
        })
        .filter(Boolean)
    : [];

  if (names.length === 0) {
    return undefined;
  }

  return names.join(' / ');
}

function getLineTotal(item) {
  const totalAmount = toNumberOrNull(item?.amounts?.total?.amount);
  if (totalAmount !== null) {
    return totalAmount;
  }

  const priceWithoutTax = toNumberOrNull(item?.amounts?.price_without_tax?.amount) ?? 0;
  const taxAmount = toNumberOrNull(item?.amounts?.tax?.amount?.amount) ?? 0;
  const discountAmount = toNumberOrNull(item?.amounts?.total_discount?.amount) ?? 0;
  return roundCurrency(priceWithoutTax + taxAmount - discountAmount);
}

function buildReturnItems(order) {
  const rawOrder = order.rawOrder ?? {};
  const rawItems = Array.isArray(rawOrder.items) ? rawOrder.items : [];

  return rawItems
    .map((item) => {
      const quantity = Math.max(0, Number(item.quantity) || 0);
      if (quantity === 0) {
        return null;
      }

      const lineTotal = getLineTotal(item);
      const unitPrice = quantity > 0 ? roundCurrency(lineTotal / quantity) : 0;
      const productId = String(item?.product?.id ?? item?.product_id ?? item?.id ?? '');

      if (!productId) {
        return null;
      }

      return {
        productId,
        productName: normalizeCellString(item.name || item?.product?.name || 'Unknown product'),
        productSku: normalizeCellString(item.sku || item?.product?.sku) || undefined,
        variantId: item?.product_sku_id ? String(item.product_sku_id) : undefined,
        variantName: extractVariantName(item),
        quantity,
        price: unitPrice,
      };
    })
    .filter((item) => Boolean(item && item.quantity > 0 && item.price >= 0));
}

function computeRefundAmount(items) {
  return roundCurrency(
    items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0)
  );
}

function buildImportNote(prepared) {
  const parts = [
    `Imported from ${prepared.sourceFile}`,
    `sheet row ${prepared.row.rowNumber}`,
    `sequence ${prepared.row.sequenceNumber || 'n/a'}`,
    `invoice type ${prepared.row.invoiceType || 'n/a'}`,
  ];

  if (prepared.row.netInvoiceTotal !== null) {
    parts.push(`sheet net total ${prepared.row.netInvoiceTotal.toFixed(2)} SAR`);
  }

  if (prepared.warning) {
    parts.push(prepared.warning);
  }

  return parts.join(' | ');
}

async function prepareRefunds(rows, options) {
  const ordersByNumber = await fetchOrdersByOrderNumbers(rows.map((row) => row.orderNumber));
  const foundOrders = rows
    .map((row) => ordersByNumber.get(row.orderNumber))
    .filter(Boolean);
  const existingRequests = await fetchExistingRequests(foundOrders);

  const prepared = [];
  const skipped = [];

  for (const row of rows) {
    const order = ordersByNumber.get(row.orderNumber);
    if (!order) {
      skipped.push({ row, reason: 'Order not found in sallaOrder.' });
      continue;
    }

    const existingRequestId = existingRequests.get(`${order.merchantId}:${order.orderId}`);
    if (existingRequestId) {
      skipped.push({ row, reason: `Return request already exists (${existingRequestId}).` });
      continue;
    }

    const items = buildReturnItems(order);
    if (items.length === 0) {
      skipped.push({ row, reason: 'Order has no refundable items in rawOrder.items.' });
      continue;
    }

    const computedRefundAmount = computeRefundAmount(items);
    const rowRefundAmount = row.netInvoiceTotal ?? row.invoiceTotal;
    const rawOrder = order.rawOrder ?? {};
    const shippingAmount = roundCurrency(
      getShippingTotal(rawOrder?.amounts?.shipping_cost ?? null, rawOrder?.amounts?.shipping_tax ?? null)
    );

    const refundAmountToCreate =
      options.useSheetTotal && rowRefundAmount !== null
        ? roundCurrency(rowRefundAmount)
        : computedRefundAmount;

    let warning;
    if (rowRefundAmount !== null) {
      const difference = roundCurrency(Math.abs(rowRefundAmount - computedRefundAmount));
      if (difference > 0.05) {
        warning = `sheet/computed difference ${difference.toFixed(2)} SAR`;
      }
    }

    prepared.push({
      row,
      order,
      sourceFile: path.basename(options.file),
      items,
      computedRefundAmount,
      shippingAmount,
      rowRefundAmount,
      refundAmountToCreate,
      existingRequestId,
      warning,
    });
  }

  return { prepared, skipped };
}

function printSummary(rows, prepared, skipped, options) {
  const totalRefundAmount = roundCurrency(
    prepared.reduce((sum, item) => sum + item.refundAmountToCreate, 0)
  );
  const warnings = prepared.filter((item) => item.warning);

  console.log('');
  console.log(options.apply ? 'Apply Summary' : 'Dry Run Summary');
  console.log('----------------');
  console.log(`Rows read: ${rows.length}`);
  console.log(`Refunds ${options.apply ? 'created' : 'to create'}: ${prepared.length}`);
  console.log(`Skipped rows: ${skipped.length}`);
  console.log(`Total refund amount: ${totalRefundAmount.toFixed(2)} SAR`);
  console.log(`Refund amount source: ${options.useSheetTotal ? 'sheet net total' : 'computed from order items'}`);

  if (warnings.length > 0) {
    console.log(`Rows with sheet/computed differences: ${warnings.length}`);
  }

  if (prepared.length > 0) {
    console.log('');
    console.log('Preview:');
    for (const item of prepared.slice(0, 10)) {
      console.log(
        `  row ${item.row.rowNumber} | order ${item.order.orderNumber} | refund ${item.refundAmountToCreate.toFixed(2)} SAR${item.warning ? ` | ${item.warning}` : ''}`
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
  for (const item of prepared) {
    const rawOrder = item.order.rawOrder ?? {};
    const customer = rawOrder.customer ?? {};
    const customerName =
      `${normalizeCellString(customer.first_name)} ${normalizeCellString(customer.last_name)}`.trim() || null;

    await prisma.returnRequest.create({
      data: {
        merchantId: item.order.merchantId,
        orderId: item.order.orderId,
        orderNumber: item.order.orderNumber,
        customerId: customer.id ? String(customer.id) : null,
        customerName,
        customerEmail: normalizeCellString(customer.email) || null,
        customerPhone: customer.mobile ? String(customer.mobile) : null,
        type: 'return',
        status: 'completed',
        reason: IMPORT_REASON,
        reasonDetails: `Imported full refund from ${item.sourceFile}.`,
        totalRefundAmount: item.refundAmountToCreate,
        returnFee: 0,
        shippingAmount: item.shippingAmount,
        adminNotes: buildImportNote(item),
        reviewedBy: IMPORT_REVIEWED_BY,
        reviewedAt: new Date(),
        items: {
          create: item.items,
        },
      },
    });
  }
}

async function main() {
  const options = parseCliArgs();
  const filePath = path.resolve(process.cwd(), options.file);
  const rows = parseInvoiceRows(filePath, options.sheet, options.limit);

  if (rows.length === 0) {
    throw new Error(`No invoice rows were parsed from ${filePath}.`);
  }

  logger.info('Preparing invoice refund import', {
    filePath,
    sheet: options.sheet,
    rows: rows.length,
    apply: options.apply,
    useSheetTotal: options.useSheetTotal,
  });

  const { prepared, skipped } = await prepareRefunds(rows, options);
  printSummary(rows, prepared, skipped, options);

  if (!options.apply) {
    return;
  }

  if (prepared.length === 0) {
    console.log('');
    console.log('No refunds were created.');
    return;
  }

  await applyRefunds(prepared);

  console.log('');
  console.log(`Created ${prepared.length} refund request(s).`);
}

main()
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
