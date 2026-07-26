/**
 * Shared helpers for the delayed-invoice reverse / re-post scripts.
 *
 * These read the ERP invoice export (same layout as `delayed invoices.xlsx`),
 * apply an "already-filed" exclusion list, verify the remaining set reconciles
 * to the filed Q1 VAT report, and keep a JSON ledger of every ERP document the
 * scripts post (for idempotent resume + rollback).
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const HEADER_ROW_LABEL = 'النوع';
const REQUIRED_HEADERS = [
  'النوع',
  'الرقم',
  'اجمالي الفاتورة',
  'اسم العميل او الحساب',
];
const ORDER_NUMBER_REGEX = /(\d{6,})/;

// Column headers we read out of the export.
const H = {
  type: 'النوع',
  erpNo: 'الرقم',
  date: 'التاريخ',
  totalInclVat: 'اجمالي الفاتورة',
  vat: 'ضريبة مستلمة',
  net: 'صافي البيع',
  customer: 'اسم العميل او الحساب',
};

// Reconciliation target from the filed Q1 VAT report (`delayed invoices.jpeg`).
export const Q1_TARGET = {
  net: 234642.36,
  vat: 35196.35,
  eps: 0.5,
};

// Q2 re-post date (mid-day UTC keeps the date on 01-04 in Riyadh, UTC+3).
export const REPOST_DATETIME = '2026-04-01T12:00:00.000Z';

function normalize(value) {
  return String(value ?? '').trim();
}

export function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

export function money(value) {
  return roundCurrency(Number(value) || 0).toFixed(2);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function findHeaderRow(rows) {
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalize);
    return (
      REQUIRED_HEADERS.every((required) => headers.includes(required)) &&
      headers.includes(HEADER_ROW_LABEL)
    );
  });
  if (headerIndex === -1) {
    throw new Error('Unable to find the invoice header row in the workbook.');
  }
  return headerIndex;
}

/**
 * Parse an ERP invoice export into normalized rows.
 * @returns {Array<{rowNumber:number, erpNo:string, orderNumber:string, dateStr:string,
 *                  totalInclVat:number, vat:number, net:number}>}
 */
export function parseDelayedRows(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath);
  const resolvedSheetName = sheetName || workbook.SheetNames[0];
  const worksheet = workbook.Sheets[resolvedSheetName];
  if (!worksheet) {
    throw new Error(`Worksheet "${resolvedSheetName}" was not found in ${filePath}.`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true });
  const headerRowIndex = findHeaderRow(rows);
  const headers = rows[headerRowIndex].map(normalize);
  const dataRows = rows.slice(headerRowIndex + 1);

  const parsed = [];
  for (let index = 0; index < dataRows.length; index += 1) {
    const row = dataRows[index];
    const record = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    const customerText = normalize(record[H.customer]);
    if (!customerText) continue;

    const match = customerText.match(ORDER_NUMBER_REGEX);
    if (!match) continue;

    parsed.push({
      rowNumber: headerRowIndex + index + 2,
      erpNo: normalize(record[H.erpNo]),
      orderNumber: match[1],
      dateStr: normalize(record[H.date]),
      totalInclVat: roundCurrency(toNumber(record[H.totalInclVat])),
      vat: roundCurrency(toNumber(record[H.vat])),
      net: roundCurrency(toNumber(record[H.net])),
    });
  }
  return parsed;
}

/**
 * Build a Set of exclusion identifiers from an exclude file.
 * Accepts an .xlsx in the same export layout (excludes by ERP number AND order
 * number) or a .csv/.txt of numeric tokens.
 */
function loadExclusionSet(excludeFile) {
  const set = new Set();
  const ext = path.extname(excludeFile).toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') {
    let excludedRows = [];
    try {
      excludedRows = parseDelayedRows(excludeFile);
    } catch {
      // Not a standard export — fall back to harvesting numeric cells below.
    }
    if (excludedRows.length > 0) {
      for (const r of excludedRows) {
        if (r.erpNo) set.add(String(r.erpNo));
        if (r.orderNumber) set.add(String(r.orderNumber));
      }
      return set;
    }
    // Fallback: harvest every integer-like token from the sheet.
    const wb = XLSX.readFile(excludeFile);
    for (const name of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
      for (const row of grid) {
        for (const cell of row) {
          const t = normalize(cell);
          if (/^\d+$/.test(t)) set.add(t);
        }
      }
    }
    return set;
  }

  const text = fs.readFileSync(excludeFile, 'utf8');
  for (const token of text.split(/[\s,;]+/)) {
    const t = token.trim();
    if (/^\d+$/.test(t)) set.add(t);
  }
  return set;
}

/**
 * Split parsed rows into the set to move vs the excluded (already-filed) set.
 */
export function applyExclusions(rows, excludeFile) {
  if (!excludeFile) {
    return { moved: rows, excluded: [], excludeSet: new Set() };
  }
  const excludeSet = loadExclusionSet(excludeFile);
  const moved = [];
  const excluded = [];
  for (const r of rows) {
    if (excludeSet.has(String(r.erpNo)) || excludeSet.has(String(r.orderNumber))) {
      excluded.push(r);
    } else {
      moved.push(r);
    }
  }
  return { moved, excluded, excludeSet };
}

export function summarize(rows) {
  return rows.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.net = roundCurrency(acc.net + r.net);
      acc.vat = roundCurrency(acc.vat + r.vat);
      acc.totalInclVat = roundCurrency(acc.totalInclVat + r.totalInclVat);
      return acc;
    },
    { count: 0, net: 0, vat: 0, totalInclVat: 0 },
  );
}

/**
 * Print a reconciliation table and (optionally) throw when the moved set does
 * not tie out to the filed Q1 report.
 */
export function assertReconciled(rows, target = Q1_TARGET, { enforce = true } = {}) {
  const s = summarize(rows);
  const netDiff = roundCurrency(s.net - target.net);
  const vatDiff = roundCurrency(s.vat - target.vat);
  const ok = Math.abs(netDiff) <= target.eps && Math.abs(vatDiff) <= target.eps;

  console.log('');
  console.log('Reconciliation (moved set vs filed Q1 report)');
  console.log('---------------------------------------------');
  console.log(`  invoices     : ${s.count}`);
  console.log(`  net (taxable): ${money(s.net)}   target ${money(target.net)}   diff ${money(netDiff)}`);
  console.log(`  VAT          : ${money(s.vat)}   target ${money(target.vat)}   diff ${money(vatDiff)}`);
  console.log(`  total inc VAT: ${money(s.totalInclVat)}`);
  console.log(`  status       : ${ok ? 'OK — ties out ✓' : 'MISMATCH ✗'}`);
  console.log('');

  if (!ok && enforce) {
    throw new Error(
      `Moved set does not reconcile to the filed Q1 report ` +
        `(net diff ${money(netDiff)}, VAT diff ${money(vatDiff)}). ` +
        `Provide/adjust the --exclude list, or pass --no-reconcile-check to override.`,
    );
  }
  return { summary: s, ok };
}

/**
 * Total incl. VAT implied by an ERP payload (mirrors the refund script's check).
 */
export function computePayloadTotal(payload) {
  const lineTotal = payload.API_Inv.reduce((sum, item) => {
    const subtotal = Number(item.price) * Number(item.qty);
    const discount = subtotal * (Number(item.discpc) / 100);
    return sum + (subtotal - discount);
  }, 0);
  return roundCurrency(lineTotal - Number(payload.hinvdsvl || 0));
}

// --- Ledger (JSON audit trail; enables idempotent resume + rollback) ---------

export function loadLedger(ledgerPath) {
  try {
    const raw = fs.readFileSync(ledgerPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ledgerOrderNumbers(entries) {
  return new Set(entries.filter((e) => e.success).map((e) => String(e.orderNumber)));
}

export function appendLedger(ledgerPath, entry) {
  const entries = loadLedger(ledgerPath);
  entries.push({ ...entry, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(entries, null, 2));
}

// --- Shared CLI parsing ------------------------------------------------------

export function parseCommonArgs(argv, defaults = {}) {
  const options = {
    file: 'delayed invoices.xlsx',
    apply: false,
    reconcileCheck: true,
    sheet: undefined,
    exclude: undefined,
    limit: undefined,
    delayMs: 250,
    ...defaults,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--file':
        options.file = takeValue();
        break;
      case '--sheet':
        options.sheet = takeValue();
        break;
      case '--exclude':
        options.exclude = takeValue();
        break;
      case '--limit':
        options.limit = Number.parseInt(takeValue(), 10);
        if (!Number.isFinite(options.limit) || options.limit <= 0) {
          throw new Error('--limit must be a positive integer.');
        }
        break;
      case '--delay-ms':
        options.delayMs = Number.parseInt(takeValue(), 10) || 0;
        break;
      case '--apply':
        options.apply = true;
        break;
      case '--no-reconcile-check':
        options.reconcileCheck = false;
        break;
      default:
        if (arg.startsWith('--file=')) options.file = arg.slice(7);
        else if (arg.startsWith('--sheet=')) options.sheet = arg.slice(8);
        else if (arg.startsWith('--exclude=')) options.exclude = arg.slice(10);
        else if (arg.startsWith('--limit=')) options.limit = Number.parseInt(arg.slice(8), 10);
        else throw new Error(`Unknown option "${arg}". Use --help.`);
        break;
    }
  }
  return options;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
