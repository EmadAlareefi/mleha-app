/**
 * Reverse the delayed Q1 invoices by posting matching type-26 credit notes.
 *
 * The ERP has no delete/void endpoint, so each Q1 sale is cancelled with a
 * credit note carrying the SAME original Q1 date (transformOrderToERPInvoice
 * resolves the date from the Salla order — we do NOT override it here), which
 * nets Q1 back down to the already-filed VAT return.
 *
 * Dry-run by default. Pass --apply to post. See --help.
 *
 * Run from your own terminal (the agent's Bash HTTPS is proxied):
 *   npm run erp:reverse-delayed -- --exclude "already-filed.xlsx"
 *   npm run erp:reverse-delayed -- --exclude "already-filed.xlsx" --limit 5 --apply
 */

import path from 'path';
import process from 'process';
import nextEnv from '@next/env';
import prismaPkg from '@prisma/client';
import {
  postInvoiceToERP,
  transformOrderToERPInvoice,
} from '../app/lib/erp-invoice.ts';
import {
  applyExclusions,
  appendLedger,
  assertReconciled,
  computePayloadTotal,
  ledgerOrderNumbers,
  loadLedger,
  money,
  parseCommonArgs,
  parseDelayedRows,
  sleep,
  summarize,
} from './lib/delayed-invoices-common.mjs';

const { loadEnvConfig } = nextEnv;
const { PrismaClient } = prismaPkg;

loadEnvConfig(process.cwd());
const prisma = new PrismaClient();

const LEDGER_PATH = path.resolve(process.cwd(), 'scripts/output/reverse-ledger.json');
const TOTAL_EPS = 0.05; // per-invoice rebuilt vs exported total tolerance

function printUsage() {
  console.log(`
Reverse delayed Q1 invoices (type-26 credit notes, original Q1 dates)
=====================================================================
Options:
  --file <path>        ERP export (default: "delayed invoices.xlsx")
  --sheet <name>       Worksheet name (default: first sheet)
  --exclude <path>     Invoices already in the filed Q1 return (.xlsx/.csv/.txt)
  --limit <n>          Only process the first N moved invoices
  --delay-ms <n>       Delay between ERP posts (default: 250)
  --no-reconcile-check Skip the "must tie out to 234,642.36" guard (dangerous)
  --apply              Actually post credit notes to the ERP
  --help, -h           Show this help
`.trim());
}

function forceRefundOrder(order) {
  return { ...order, statusSlug: 'refund' };
}

async function fetchOrders(orderNumbers) {
  const map = new Map();
  const unique = [...new Set(orderNumbers)];
  for (let i = 0; i < unique.length; i += 200) {
    const batch = unique.slice(i, i + 200);
    const orders = await prisma.sallaOrder.findMany({ where: { orderNumber: { in: batch } } });
    for (const o of orders) if (o.orderNumber) map.set(o.orderNumber, o);
  }
  return map;
}

async function main() {
  const options = parseCommonArgs(process.argv.slice(2));
  if (options.help) return printUsage();

  const filePath = path.resolve(process.cwd(), options.file);
  const allRows = parseDelayedRows(filePath, options.sheet);
  const { moved, excluded } = applyExclusions(allRows, options.exclude);

  console.log('[reverse] delayed Q1 invoices → type-26 credit notes');
  console.log(`  file        : ${filePath}`);
  console.log(`  parsed rows : ${allRows.length}`);
  console.log(`  excluded    : ${excluded.length} (already filed in Q1)`);
  console.log(`  to reverse  : ${moved.length}`);
  console.log(`  mode        : ${options.apply ? 'APPLY' : 'DRY RUN'}`);

  assertReconciled(moved, undefined, { enforce: options.reconcileCheck });

  const workset = options.limit ? moved.slice(0, options.limit) : moved;
  const ordersByNumber = await fetchOrders(workset.map((r) => r.orderNumber));
  const done = ledgerOrderNumbers(loadLedger(LEDGER_PATH));

  const prepared = [];
  const skipped = [];

  for (const row of workset) {
    if (done.has(row.orderNumber)) {
      skipped.push({ row, reason: 'Already reversed (in ledger).' });
      continue;
    }
    const order = ordersByNumber.get(row.orderNumber);
    if (!order) {
      skipped.push({ row, reason: 'Order not found in sallaOrder.' });
      continue;
    }
    try {
      const payload = await transformOrderToERPInvoice(forceRefundOrder(order));
      const built = computePayloadTotal(payload);
      const diff = Math.abs(built - row.totalInclVat);
      if (diff > TOTAL_EPS) {
        skipped.push({
          row,
          reason: `Rebuilt total ${money(built)} ≠ exported ${money(row.totalInclVat)} (diff ${money(diff)}).`,
        });
        continue;
      }
      prepared.push({ row, order, payload, amount: built });
    } catch (error) {
      skipped.push({ row, reason: error instanceof Error ? error.message : 'Build failed.' });
    }
  }

  const preparedTotals = summarize(prepared.map((p) => p.row));
  console.log('');
  console.log(`Prepared credit notes: ${prepared.length}  (total incl VAT ${money(preparedTotals.totalInclVat)})`);
  console.log(`Skipped              : ${skipped.length}`);
  for (const s of skipped.slice(0, 15)) {
    console.log(`  - order ${s.row.orderNumber} (ERP #${s.row.erpNo}): ${s.reason}`);
  }
  if (skipped.length > 15) console.log(`  ... ${skipped.length - 15} more`);

  if (!options.apply) {
    console.log('\nDry run complete. Re-run with --apply to post credit notes.');
    return;
  }
  if (prepared.length === 0) {
    console.log('\nNothing to post.');
    return;
  }

  let ok = 0;
  for (const item of prepared) {
    const result = await postInvoiceToERP(item.payload);
    appendLedger(LEDGER_PATH, {
      script: 'reverse',
      orderNumber: item.order.orderNumber,
      originalErpNo: item.row.erpNo,
      newErpInvoiceId: result.erpInvoiceId ?? null,
      ltrtype: item.payload.ltrtype,
      datetime_stamp: item.payload.datetime_stamp,
      amount: item.amount,
      success: !!result.success,
      message: result.message ?? result.error ?? null,
    });
    if (result.success) {
      ok += 1;
    } else {
      console.log(`  ✗ order ${item.order.orderNumber}: ${result.error || result.message}`);
    }
    if (options.delayMs) await sleep(options.delayMs);
  }
  console.log(`\nCredit notes posted: ${ok}/${prepared.length}. Ledger: ${LEDGER_PATH}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
