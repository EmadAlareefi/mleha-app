/**
 * Setup and checks for holding international orders with incomplete shipping info.
 *
 * Read-only:
 *   npm run shipping-info -- --step statuses
 *       List Salla order statuses (finds the hold status if it already exists).
 *   npm run shipping-info -- --step payload --order <id> --first A --middle B --last C [--district D] [--street S]
 *       Print the PUT /orders/{id} body the form would send, from the live order.
 *       Feed it to `npm run probe:order-manage -- --step put-order --order <id> --body '<json>' --confirm`.
 *   npm run shipping-info -- --step scan [--days 30]
 *       How many recent international orders would be held, and why.
 *
 * Write (add --confirm):
 *   npm run shipping-info -- --step create-status --confirm
 *       Create the "بانتظار استكمال بيانات الشحن" sub-status under "طلب جديد".
 */
import { loadEnvConfig } from '@next/env';
import process from 'process';

loadEnvConfig(process.cwd());

const HOLD_STATUS_NAME = 'بانتظار استكمال بيانات الشحن';
const NEW_ORDER_PARENT_ID = 449146439;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);
const merchantId = () => process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

async function main() {
  const { sallaMakeRequest } = await import('@/app/lib/salla-oauth');
  const step = arg('step');

  if (step === 'statuses') {
    const result = await sallaMakeRequest<{ data: any[] }>(merchantId(), '/orders/statuses', { throwOnError: true });
    for (const status of result?.data ?? []) {
      console.log(`${status.id}\t${status.type}\t${status.slug}\tparent=${status.parent?.id ?? '-'}\t${status.name}`);
    }
    return;
  }

  if (step === 'create-status') {
    const existing = await sallaMakeRequest<{ data: any[] }>(merchantId(), '/orders/statuses', { throwOnError: true });
    const found = (existing?.data ?? []).find((s) => s.name === HOLD_STATUS_NAME);
    if (found) {
      console.log(`Already exists: ${found.id}`);
      return;
    }
    if (!has('confirm')) {
      console.log(`Would create "${HOLD_STATUS_NAME}" under ${NEW_ORDER_PARENT_ID}. Add --confirm.`);
      return;
    }
    const created = await sallaMakeRequest<{ data: any }>(merchantId(), '/orders/statuses', {
      method: 'POST',
      throwOnError: true,
      body: JSON.stringify({
        parent_id: NEW_ORDER_PARENT_ID,
        name: HOLD_STATUS_NAME,
        message: 'نحتاج استكمال الاسم الثلاثي وعنوان الشحن لطلبك، أرسلنا لك رابطًا عبر واتساب.',
        icon: 'sicon-location',
        is_active: true,
      }),
    });
    console.log(JSON.stringify(created?.data, null, 2));
    console.log(`\nHold status id: ${created?.data?.id}. Save it at /admin/order-prep/shipping-info.`);
    return;
  }

  if (step === 'payload') {
    const orderId = arg('order');
    if (!orderId) throw new Error('Missing --order');
    const { fetchLiveOrder } = await import('@/app/lib/order-prep/salla-live');
    const { buildOrderUpdatePayload, extractShippingInfo, findMissingFields, parseSubmission } = await import(
      '@/app/lib/shipping-info/rules'
    );
    const live = await fetchLiveOrder(merchantId(), orderId);
    if (live.kind !== 'ok') throw new Error(`Salla read failed: ${live.kind}`);
    const info = extractShippingInfo(live.detail);
    console.error('Current:', { ...info, missing: findMissingFields(info), status: live.statusName });
    const parsed = parseSubmission({
      firstName: arg('first'),
      middleName: arg('middle'),
      lastName: arg('last'),
      district: arg('district') ?? info.district,
      street: arg('street') ?? info.street,
      buildingNumber: info.buildingNumber,
      postalCode: info.postalCode,
      addressLine2: info.addressLine2,
    });
    if (!parsed.ok) throw new Error(`Incomplete: ${parsed.errors.join(', ')}`);
    console.log(JSON.stringify(buildOrderUpdatePayload(live.detail, parsed.value)));
    return;
  }

  if (step === 'scan') {
    const { prisma } = await import('@/lib/prisma');
    const { detectInternationalOrder } = await import('@/app/lib/order-destination');
    const { extractShippingInfo, findMissingFields } = await import('@/app/lib/shipping-info/rules');
    const days = Number(arg('days') ?? 30);
    const rows = await prisma.sallaOrder.findMany({
      where: { merchantId: merchantId(), placedAt: { gte: new Date(Date.now() - days * 86_400_000) } },
      select: { rawOrder: true, customerCountry: true },
    });
    const counts: Record<string, number> = { international: 0, held: 0, name: 0, district: 0, street: 0 };
    for (const row of rows) {
      if (!detectInternationalOrder(row.rawOrder).isInternational) continue;
      counts.international += 1;
      const missing = findMissingFields(extractShippingInfo(row.rawOrder));
      if (missing.length > 0) counts.held += 1;
      for (const field of missing) counts[field] += 1;
    }
    console.log(`Last ${days} days:`, counts);
    await prisma.$disconnect();
    return;
  }

  console.log('Usage: see the header of scripts/shipping-info-setup.ts');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
