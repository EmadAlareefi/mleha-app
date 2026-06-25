import nextEnv from '@next/env';
import fs from 'fs';
import path from 'path';
import process from 'process';
import prismaPkg from '@prisma/client';

const { loadEnvConfig } = nextEnv;
const { PrismaClient, Prisma } = prismaPkg;

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

// Only v7 — the JSON files are cumulative snapshots and v7 is the superset.
const DEFAULT_FILE = 'invoices/fabric_invoices_unified_updated_v7.json';
const YARD_TO_METER = 0.9144;

// Units that mean "accessory" (counted pieces/boxes/rolls) vs. fabric (length).
const ACCESSORY_UNITS = new Set(['PSC', 'PKT', 'PKT (100)', 'BOX (12)', 'CTN 10', 'ROLL', 'علبة']);
// Fabric length units (طاقة = bolt, kept as-is; ياردة converted to meters).
const FABRIC_UNITS = new Set(['ياردة', 'طاقة', 'meter', 'متر', 'غير محدد']);

const isDry = process.argv.includes('--dry');

function dec(value) {
  const n = Number(value);
  return new Prisma.Decimal(Number.isFinite(n) ? n : 0);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Pure price quotes (عرض سعر, not an actual invoice) are excluded.
function isQuoteOnly(item) {
  const dt = item.document_type || '';
  return dt.includes('عرض سعر') && !dt.includes('فاتورة');
}

// Finished dresses (sold by other workshops) are neither fabric nor accessory.
function isFinishedDress(item) {
  const name = item.fabric_name || item.product_name || '';
  return item.unit === 'حبة' || name.includes('فستان');
}

function classify(item) {
  if (item.unit && ACCESSORY_UNITS.has(item.unit)) return 'accessory';
  if (item.unit && FABRIC_UNITS.has(item.unit)) return 'fabric';
  // null / unknown unit → default to fabric.
  return 'fabric';
}

// Fabric stock is kept in meters; yards convert, everything else passes through.
function fabricStockMeters(quantity, unit) {
  const q = Number(quantity) || 0;
  return unit === 'ياردة' ? q * YARD_TO_METER : q;
}

async function upsertSupplier(name) {
  const clean = cleanText(name);
  if (!clean) return;
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: clean, mode: 'insensitive' } },
  });
  if (existing) {
    if (!existing.isActive) {
      await prisma.supplier.update({ where: { id: existing.id }, data: { isActive: true } });
    }
    return;
  }
  await prisma.supplier.create({ data: { name: clean, createdBy: 'invoice-import', updatedBy: 'invoice-import' } });
}

// Find-or-create a Fabric, incrementing its stock. Returns the fabric id.
async function applyFabricStock(tx, item, supplier) {
  const sku = cleanText(item.product_number) || null;
  const name = cleanText(item.fabric_name) || cleanText(item.product_name) || 'قماش بدون اسم';
  const meters = fabricStockMeters(item.quantity, item.unit);
  const unitCost = dec(item.unit_cost);
  const note = `فاتورة شراء ${item.invoice_number}`;

  let fabric = sku ? await tx.fabric.findUnique({ where: { sku } }) : null;
  if (!fabric) fabric = await tx.fabric.findFirst({ where: { name } });

  if (fabric) {
    const updated = await tx.fabric.update({
      where: { id: fabric.id },
      data: {
        stockLength: { increment: new Prisma.Decimal(meters) },
        unitCost: unitCost.gt(0) ? unitCost : fabric.unitCost,
        supplier: supplier || fabric.supplier,
        notes: [fabric.notes, `توريد: ${note}`].filter(Boolean).join('\n'),
      },
    });
    return updated.id;
  }

  const created = await tx.fabric.create({
    data: {
      name,
      sku,
      supplier: supplier || null,
      unitCost,
      stockLength: new Prisma.Decimal(meters),
      notes: note,
    },
  });
  return created.id;
}

// Find-or-create an Accessory, incrementing its stock. Returns the accessory id.
async function applyAccessoryStock(tx, item) {
  const sku = cleanText(item.product_number) || null;
  const name = cleanText(item.fabric_name) || cleanText(item.product_name) || 'مستلزم بدون اسم';
  const qty = dec(item.quantity);
  const unitPrice = dec(item.unit_cost);
  const note = `فاتورة شراء ${item.invoice_number}`;

  let accessory = sku ? await tx.accessory.findUnique({ where: { sku } }) : null;
  if (!accessory) accessory = await tx.accessory.findFirst({ where: { name } });

  if (accessory) {
    const updated = await tx.accessory.update({
      where: { id: accessory.id },
      data: {
        stockQty: { increment: qty },
        unitPrice: unitPrice.gt(0) ? unitPrice : accessory.unitPrice,
        notes: [accessory.notes, `توريد: ${note}`].filter(Boolean).join('\n'),
      },
    });
    return updated.id;
  }

  const created = await tx.accessory.create({
    data: { name, sku, unitPrice, stockQty: qty, notes: note },
  });
  return created.id;
}

async function main() {
  const file = process.argv.find((a) => a.endsWith('.json')) || DEFAULT_FILE;
  const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
  const items = Array.isArray(raw.items) ? raw.items : [];

  const stats = {
    totalLines: items.length,
    skippedQuotes: 0,
    skippedDresses: 0,
    fabricLines: 0,
    accessoryLines: 0,
    invoicesNew: 0,
    invoicesExisting: 0,
    suppliers: new Set(),
  };

  // Filter, then group remaining lines by invoiceNumber + supplier.
  const groups = new Map();
  for (const item of items) {
    if (isQuoteOnly(item)) { stats.skippedQuotes++; continue; }
    if (isFinishedDress(item)) { stats.skippedDresses++; continue; }
    const itemType = classify(item);
    if (itemType === 'fabric') stats.fabricLines++; else stats.accessoryLines++;

    const supplier = cleanText(item.supplier) || null;
    const key = `${item.invoice_number}|||${supplier || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        invoiceNumber: String(item.invoice_number ?? ''),
        documentType: item.document_type || null,
        supplier,
        purchaseDate: item.purchase_date ? new Date(item.purchase_date) : null,
        sourceFile: item.source_file || null,
        lines: [],
      });
    }
    groups.get(key).lines.push({ ...item, _itemType: itemType });
    if (supplier) stats.suppliers.add(supplier);
  }

  console.log(`\n=== Fabric invoice import${isDry ? ' (DRY RUN)' : ''} ===`);
  console.log(`Source: ${file}`);
  console.log(`Lines: ${stats.totalLines} | fabric: ${stats.fabricLines} | accessory: ${stats.accessoryLines}`);
  console.log(`Skipped: ${stats.skippedQuotes} quotes, ${stats.skippedDresses} dresses`);
  console.log(`Invoices (grouped): ${groups.size} | suppliers: ${stats.suppliers.size}\n`);

  for (const group of groups.values()) {
    // Idempotency: skip an invoice that already exists so stock isn't double-counted.
    const existing = await prisma.purchaseInvoice.findUnique({
      where: { invoiceNumber_supplier: { invoiceNumber: group.invoiceNumber, supplier: group.supplier } },
    }).catch(() => null);
    if (existing) {
      stats.invoicesExisting++;
      continue;
    }

    let subtotal = new Prisma.Decimal(0);
    let vat = new Prisma.Decimal(0);
    let total = new Prisma.Decimal(0);
    for (const line of group.lines) {
      subtotal = subtotal.plus(dec(line.line_total_excluding_vat));
      vat = vat.plus(dec(line.vat_amount));
      total = total.plus(dec(line.line_total_including_vat));
    }

    if (isDry) {
      stats.invoicesNew++;
      console.log(`+ ${group.invoiceNumber} | ${group.supplier || '—'} | ${group.lines.length} lines | total ${total.toFixed(2)}`);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber: group.invoiceNumber,
          documentType: group.documentType,
          supplier: group.supplier,
          purchaseDate: group.purchaseDate,
          subtotalExclVat: subtotal,
          vatAmount: vat,
          totalInclVat: total,
          sourceFile: group.sourceFile,
        },
      });

      for (const line of group.lines) {
        let fabricId = null;
        let accessoryId = null;
        if (line._itemType === 'fabric') {
          fabricId = await applyFabricStock(tx, line, group.supplier);
        } else {
          accessoryId = await applyAccessoryStock(tx, line);
        }

        await tx.purchaseInvoiceItem.create({
          data: {
            invoiceId: invoice.id,
            itemType: line._itemType,
            fabricId,
            accessoryId,
            productName: cleanText(line.fabric_name) || cleanText(line.product_name) || '—',
            productNumber: cleanText(line.product_number) || null,
            unit: line.unit || null,
            quantity: dec(line.quantity),
            unitCost: dec(line.unit_cost),
            vatRate: dec(line.vat_rate ?? 0.15),
            lineTotalExclVat: dec(line.line_total_excluding_vat),
            vatAmount: dec(line.vat_amount),
            lineTotalInclVat: dec(line.line_total_including_vat),
            extractionConfidence: line.extraction_confidence || null,
            notes: cleanText(line.notes) || null,
          },
        });
      }
    }, { timeout: 30000, maxWait: 30000 });
    stats.invoicesNew++;
  }

  if (!isDry) {
    for (const supplier of stats.suppliers) await upsertSupplier(supplier);
  }

  console.log(`\nDone. Invoices created: ${stats.invoicesNew}, already-existing (skipped): ${stats.invoicesExisting}`);
  if (isDry) console.log('(dry run — nothing written)');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
