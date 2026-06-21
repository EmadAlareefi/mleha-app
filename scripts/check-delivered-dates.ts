/**
 * Live check: for each order number, resolve the order from Salla, detect the courier,
 * and print the delivered date used for the return window.
 *
 * For AJ-EX / Redbox orders the delivered date comes from the Salla order-history
 * "تم التوصيل" conversion (the same logic /api/returns/check now uses); for other
 * couriers it shows what resolveReturnDeliveryDate() falls back to.
 *
 * Usage: npx tsx scripts/check-delivered-dates.ts [orderNumber ...]
 */
import { loadEnvConfig } from '@next/env';
import process from 'process';

loadEnvConfig(process.cwd());

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const DEFAULT_ORDERS = ['267120060', '267119647', '267118180', '266919782', '266902081'];

async function main() {
  // Imported after env is loaded so DB/Salla clients pick up credentials.
  const { getSallaOrderByReference, getSallaOrderDeliveredDate } = await import('@/app/lib/salla-api');
  const { extractSallaTrackingNumber } = await import('@/app/lib/salla-shipment');
  const { detectShipmentCompany } = await import('@/lib/shipment-detector');
  const { resolveReturnDeliveryDate } = await import('@/lib/returns/policy');
  const { prisma } = await import('@/lib/prisma');

  const orderNumbers = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_ORDERS;

  console.log(`Merchant: ${MERCHANT_ID}`);
  console.log(`Checking ${orderNumbers.length} order(s)\n`);
  console.log('='.repeat(90));

  for (const orderNumber of orderNumbers) {
    console.log(`\nOrder #${orderNumber}`);

    const order = await getSallaOrderByReference(MERCHANT_ID, orderNumber);
    if (!order) {
      console.log('  ❌ Order not found');
      continue;
    }

    const orderId = String((order as any).id ?? '');
    const status = (order as any)?.status?.name ?? (order as any)?.status?.slug ?? 'unknown';

    // The order payload usually has no tracking number; the stored shipment is the reliable
    // courier source, mirroring resolveReturnDeliveryDate().
    const shipment = await prisma.sallaShipment.findFirst({
      where: { merchantId: MERCHANT_ID, OR: [{ orderId }, { orderNumber }] },
      orderBy: { updatedAt: 'desc' },
    });
    const tracking = shipment?.trackingNumber || extractSallaTrackingNumber(order as any);
    const courier = tracking ? detectShipmentCompany(tracking) : null;

    console.log(`  Salla order id : ${orderId}`);
    console.log(`  Status         : ${status}`);
    console.log(`  Tracking       : ${tracking ?? '—'}`);
    console.log(`  Courier        : ${courier ? `${courier.nameEn} (${courier.id})` : 'unknown'}`);

    // Raw order-history delivered date (what the new helper returns directly).
    const historyDelivered = orderId ? await getSallaOrderDeliveredDate(MERCHANT_ID, orderId) : null;
    console.log(`  History "تم التوصيل": ${historyDelivered ? historyDelivered.toISOString() : '— (no delivered history entry)'}`);

    // What the returns flow actually resolves (history first for ajex/redbox, else the chain).
    const resolved = await resolveReturnDeliveryDate(MERCHANT_ID, order as any);
    const deliveryDate = resolved.date;
    console.log(`  Resolved date  : ${deliveryDate ? deliveryDate.toISOString() : '—'}  (source: ${resolved.source ?? 'n/a'})`);

    if (deliveryDate) {
      const hours = (Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60);
      const days = hours / 24;
      console.log(`  Since delivery : ${hours.toFixed(1)}h / ${days.toFixed(2)}d`);
      console.log(`  Window status  : evening-dress(24h) ${days <= 1 ? '✅ open' : '⛔ expired'}  |  other(3d) ${days <= 3 ? '✅ open' : '⛔ expired'}`);
    }
  }

  console.log(`\n${'='.repeat(90)}`);
}

main()
  .then(async () => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Error:', error);
    const { prisma } = await import('@/lib/prisma');
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
