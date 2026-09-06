/** Read-only audit of stored snapshots; prints aggregate counts, never customer details. */
import { loadEnvConfig } from '@next/env';
import { buildInvoiceData, invoiceTotalMatchesOrder } from '../app/lib/salla-invoice-pdf';
import type { SallaOrder } from '../app/lib/salla-api';
import { resolveCommercialInvoiceConsignee } from '../lib/commercial-invoice-address';

loadEnvConfig(process.cwd());

async function main() {
  const { prisma } = await import('../lib/prisma');
  try {
    const merchantId = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
    const rows = await prisma.sallaOrder.findMany({
      where: { merchantId },
      orderBy: { placedAt: 'desc' },
      take: 200,
      select: { rawOrder: true, placedAt: true, orderId: true },
    });
    const invoices = await prisma.sallaInvoice.findMany({
      where: { merchantId },
      orderBy: { issueDate: 'desc' },
      take: 100,
      select: { rawInvoice: true, rawOrder: true, orderId: true },
    });
    const counts: Record<string, number> = {
      cityDiffersFromDestinationResolver: 0,
      missingRenderedCity: 0,
      missingRenderedAddress: 0,
      missingRenderedPhone: 0,
      discountHidden: 0,
      explicitZeroTaxRateNotPreserved: 0,
      invoiceDateMismatch: 0,
      invoiceTotalDiffersFromOrder: 0,
    };
    const count = (key: string, condition: unknown = true) => {
      if (condition) counts[key] = (counts[key] || 0) + 1;
    };
    for (const row of rows) {
      const order = row.rawOrder as unknown as SallaOrder;
      const raw = row.rawOrder as Record<string, any>;
      const destination = resolveCommercialInvoiceConsignee(order);
      const data = buildInvoiceData(order, null);
      count('orders');
      count('ordersWithItems', order.items?.length);
      count('cityDiffersFromDestinationResolver', data.buyerCity !== destination.city);
      const oldShipping = raw.ship_to || raw.shipping?.address || raw.shipping || {};
      const oldCity = typeof oldShipping.city === 'string' ? oldShipping.city : raw.customer?.city || '';
      // String differences include translations, so this is NOT a wrong-city count.
      count('previousCityStringDiffersFromDestination', oldCity !== destination.city);
      count('missingRenderedCity', !data.buyerCity);
      count('missingRenderedAddress', !data.buyerAddress);
      count('missingRenderedPhone', !data.buyerPhone);
      count('discountHidden', data.couponAmount > 0 && !data.couponLabel);
      count('explicitZeroTaxRateNotPreserved', raw.amounts?.tax?.percent != null && Number(raw.amounts.tax.percent) === 0 && data.taxPercent !== 0);
      count('hasShipmentDestination', raw.shipments?.some((s: any) => s.ship_to));
    }
    for (const stored of invoices) {
      const inv = stored.rawInvoice as Record<string, any>;
      count('invoiceRecords');
      count(`invoiceType:${inv.type}`);
      count('dateOnlyInvoiceRecords', /^\d{4}-\d{2}-\d{2}$/.test(inv.date));
      if (!stored.rawOrder) continue;
      count('invoiceRecordsWithOrderSnapshot');
      const order = stored.rawOrder as unknown as SallaOrder;
      const rendered = buildInvoiceData(order, inv);
      count('invoiceDateMismatch', typeof inv.date === 'string' && rendered.dateIso !== inv.date.slice(0, 10));
      count('invoiceTotalDiffersFromOrder', !invoiceTotalMatchesOrder(rendered, order));
    }
    console.log(JSON.stringify({
      source: 'Most recent 200 stored order snapshots; not a delivery log or live Salla verification',
      from: rows.at(-1)?.placedAt, to: rows[0]?.placedAt,
      counts,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error('Read-only invoice audit failed; no customer payloads logged.');
  process.exitCode = 1;
});
