/**
 * Live probe for customer order self-service (cancel / address / items).
 *
 * Salla does not document what happens to a paid order when its items or
 * address change, so each behaviour is tried once on a real test order and the
 * result is read back. Read-only steps run freely; every write needs
 * `--confirm`, is sent exactly once (never retried), and is refused unless the
 * order carries a do-not-ship flag, so a packer can never be handed the test
 * order while it is being probed.
 *
 * Read-only:
 *   npm run probe:order-manage -- --step scopes
 *   npm run probe:order-manage -- --step tx-methods            (refundability per payment method)
 *   npm run probe:order-manage -- --step find --ref 123456789  (order id from its number)
 *   npm run probe:order-manage -- --step snapshot --order <id>
 *
 * Writes (add --confirm):
 *   --step flag        --order <id>                      put the do-not-ship flag on the test order
 *   --step unflag      --order <id>                      remove it again
 *   --step put-order   --order <id> --body '<json>'      PUT /orders/{id}
 *   --step item-add    --order <id> --body '<json>'      POST /orders/items (order_id is added)
 *   --step item-update --order <id> --item <itemId> --body '<json>'   PUT /orders/items/{itemId}
 *   --step item-delete --order <id> --item <itemId>      DELETE /orders/items/{itemId}
 *   --step refund      --order <id> --tx <txId> --amount 5 [--currency SAR]
 *   --step cancel      --order <id>                      change_status canceled + restore_items
 *
 * Each write prints the order before and after (status, amounts, payment
 * actions, items, transactions, last history notes, stock of the variants on
 * the order, and webhooks received meanwhile).
 */
import { loadEnvConfig } from '@next/env';
import process from 'process';
import { prisma } from '@/lib/prisma';
import { SallaCallError, callSalla, getMerchantScopes } from '@/app/lib/salla-transactions';
import { SALLA_CANCELED_STATUS_ID } from '@/app/lib/salla-exchange-order';

loadEnvConfig(process.cwd());

const WRITE_STEPS = new Set(['flag', 'unflag', 'put-order', 'item-add', 'item-update', 'item-delete', 'refund', 'cancel']);
const SALLA_WRITE_STEPS = new Set(['put-order', 'item-add', 'item-update', 'item-delete', 'refund', 'cancel']);
const FLAG_NOTE = 'probe-order-manage: test order, do not pack';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function need(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return value;
}

function parseBody(): Record<string, unknown> {
  const raw = need('body');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    console.error(`--body is not a JSON object: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

const merchantId = () => process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

async function safeGet(path: string): Promise<any> {
  try {
    return await callSalla(merchantId(), 'GET', path);
  } catch (error) {
    return { __error: error instanceof Error ? error.message : String(error) };
  }
}

const money = (value: any) => (value && typeof value === 'object' ? `${value.amount} ${value.currency ?? ''}`.trim() : value ?? null);

/** Phone numbers and names are left out on purpose: this prints to a terminal. */
function summarizeOrder(order: any) {
  if (!order || order.__error) return order;
  const amounts = order.amounts || {};
  return {
    id: order.id,
    reference_id: order.reference_id,
    status: {
      id: order.status?.id,
      slug: order.status?.slug,
      name: order.status?.name,
      customized: order.status?.customized ? { id: order.status.customized.id, name: order.status.customized.name } : null,
    },
    payment_method: order.payment_method,
    is_pending_payment: order.is_pending_payment,
    pending_payment_ends_at: order.pending_payment_ends_at,
    payment_actions: order.payment_actions ?? null,
    amounts: Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, money(value)])),
    total: money(order.total),
    shipping: order.shipping
      ? {
          company: order.shipping.company,
          courier_id: order.shipping.id ?? order.shipping.courier_id,
          city: order.shipping.address?.city ?? order.shipping.pickup_address?.city,
          address_keys: order.shipping.address ? Object.keys(order.shipping.address) : null,
          receiver_keys: order.shipping.receiver ? Object.keys(order.shipping.receiver) : null,
        }
      : null,
    receiver_keys: order.receiver ? Object.keys(order.receiver) : null,
    ship_to_keys: order.ship_to ? Object.keys(order.ship_to) : null,
    urls: order.urls ? Object.keys(order.urls) : null,
    updated_at: order.updated_at,
  };
}

function summarizeItems(items: any) {
  if (!Array.isArray(items)) return items;
  return items.map((item) => ({
    id: item.id,
    product_id: item.product?.id ?? item.product_id,
    name: item.name,
    sku: item.sku,
    quantity: item.quantity,
    amounts: item.amounts
      ? Object.fromEntries(Object.entries(item.amounts).map(([key, value]) => [key, money(value)]))
      : null,
    options: Array.isArray(item.options)
      ? item.options.map((option: any) => ({
          id: option.id,
          name: option.name,
          value: option.value && typeof option.value === 'object' ? { id: option.value.id, name: option.value.name } : option.value,
        }))
      : null,
  }));
}

function summarizeTransactions(transactions: any) {
  if (!Array.isArray(transactions)) return transactions;
  return transactions.map((tx) => ({
    id: tx.id,
    status: tx.status?.slug ?? tx.status,
    total: money(tx.total),
    refunded: money(tx.refunded_amount ?? tx.refunded),
    available_actions: tx.available_actions,
    payment_method: tx.payment_method
      ? {
          slug: tx.payment_method.slug,
          name: tx.payment_method.name,
          is_refundable: tx.payment_method.is_refundable,
          within_refund_period: tx.payment_method.within_refund_period,
        }
      : null,
  }));
}

async function variantStock(items: any[]): Promise<unknown> {
  const productIds = [...new Set(items.map((item) => item?.product?.id ?? item?.product_id).filter(Boolean))].slice(0, 6);
  const stock: Record<string, unknown> = {};
  for (const productId of productIds) {
    const body = await safeGet(`/products/${productId}`);
    if (body.__error) {
      stock[String(productId)] = body;
      continue;
    }
    const product = body?.data ?? {};
    stock[String(productId)] = {
      quantity: product.quantity,
      unlimited: product.unlimited_quantity,
      skus: Array.isArray(product.skus)
        ? product.skus.map((sku: any) => ({ id: sku.id, sku: sku.sku, stock: sku.stock_quantity, values: sku.related_option_values }))
        : null,
    };
  }
  return stock;
}

async function snapshot(orderId: string, since?: Date) {
  const id = encodeURIComponent(orderId);
  const [order, items, transactions, histories, shipments] = await Promise.all([
    safeGet(`/orders/${id}`),
    safeGet(`/orders/items?order_id=${id}`),
    safeGet(`/transactions?order_id=${id}`),
    safeGet(`/orders/${id}/histories`),
    safeGet(`/orders/${id}/shipments`),
  ]);
  const itemRows = Array.isArray(items?.data) ? items.data : [];
  const webhooks = since
    ? await prisma.webhookLog
        .findMany({
          where: { receivedAt: { gte: since }, orderId },
          orderBy: { receivedAt: 'asc' },
          select: { event: true, status: true, receivedAt: true },
        })
        .catch((error: unknown) => ({ __error: error instanceof Error ? error.message : String(error) }))
    : undefined;
  return {
    order: summarizeOrder(order?.data ?? order),
    items: items?.__error ? items : summarizeItems(itemRows),
    transactions: transactions?.__error ? transactions : summarizeTransactions(transactions?.data),
    histories: histories?.__error
      ? histories
      : (Array.isArray(histories?.data) ? histories.data : []).slice(0, 6).map((entry: any) => ({
          status: entry.status,
          note: String(entry.note ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
          at: entry.created_at?.date,
        })),
    shipments: shipments?.__error
      ? shipments
      : (Array.isArray(shipments?.data) ? shipments.data : []).map((shipment: any) => ({
          id: shipment.id,
          type: shipment.type,
          courier_id: shipment.courier_id,
          courier_name: shipment.courier_name,
          status: shipment.status,
          ship_to_keys: shipment.ship_to ? Object.keys(shipment.ship_to) : null,
          city_id: shipment.ship_to?.city_id,
          total: money(shipment.total),
        })),
    stock: await variantStock(itemRows),
    ...(webhooks ? { webhooksSince: webhooks } : {}),
  };
}

function print(label: string, value: unknown) {
  console.log(`\n===== ${label} =====`);
  console.log(JSON.stringify(value, null, 2));
}

async function assertFlagged(orderId: string) {
  const flag = await prisma.orderDoNotShipFlag.findUnique({
    where: { merchantId_orderId: { merchantId: merchantId(), orderId } },
    select: { id: true },
  });
  if (!flag) {
    console.error(`Order ${orderId} has no do-not-ship flag. Run --step flag --order ${orderId} --confirm first.`);
    process.exit(1);
  }
  const claim = await prisma.orderPrepAssignment.findFirst({
    where: { merchantId: merchantId(), orderId },
    select: { id: true, status: true, userName: true },
  });
  if (claim) {
    console.error(`Order ${orderId} is already held in order prep (${claim.status}, ${claim.userName}). Not probing it.`);
    process.exit(1);
  }
}

async function stepScopes() {
  const scopes = await getMerchantScopes(merchantId());
  print('scopes', scopes);
  for (const required of ['orders.read_write', 'transactions.read_write', 'products.read_write']) {
    console.log(`${required}: ${scopes ? (scopes.includes(required) ? 'yes' : 'MISSING') : 'unknown (token stored without scopes)'}`);
  }
  print('webhook subscriptions', await safeGet('/webhooks/subscriptions'));
}

/** Refund capability per payment method, from two recent paid orders of each. */
async function stepTxMethods() {
  const methods = await prisma.sallaOrder.groupBy({
    by: ['paymentMethod'],
    where: { merchantId: merchantId(), placedAt: { gte: new Date(Date.now() - 45 * 86_400_000) } },
    _count: { _all: true },
  });
  print('payment methods, last 45 days', methods.map((row) => ({ method: row.paymentMethod, orders: row._count._all })));
  for (const row of methods) {
    if (!row.paymentMethod) continue;
    const orders = await prisma.sallaOrder.findMany({
      where: { merchantId: merchantId(), paymentMethod: row.paymentMethod, isPendingPayment: { not: true } },
      orderBy: { placedAt: 'desc' },
      take: 2,
      select: { orderId: true, placedAt: true, statusSlug: true },
    });
    for (const order of orders) {
      const body = await safeGet(`/transactions?order_id=${encodeURIComponent(order.orderId)}`);
      print(`${row.paymentMethod} — order ${order.orderId} (${order.statusSlug}, ${order.placedAt?.toISOString().slice(0, 10)})`,
        body.__error ? body : summarizeTransactions(body?.data));
    }
  }
}

async function stepFind() {
  const reference = need('ref');
  const rows = await prisma.sallaOrder.findMany({
    where: { merchantId: merchantId(), OR: [{ referenceId: reference }, { orderNumber: reference }] },
    select: { orderId: true, referenceId: true, statusName: true, statusCustomId: true, paymentMethod: true, placedAt: true },
  });
  print(`orders for reference ${reference}`, rows);
}

async function runWrite(step: string, orderId: string): Promise<unknown> {
  const id = encodeURIComponent(orderId);
  switch (step) {
    case 'put-order':
      return callSalla(merchantId(), 'PUT', `/orders/${id}`, parseBody());
    case 'item-add':
      return callSalla(merchantId(), 'POST', '/orders/items', { order_id: Number(orderId), ...parseBody() });
    case 'item-update':
      return callSalla(merchantId(), 'PUT', `/orders/items/${encodeURIComponent(need('item'))}`, parseBody());
    case 'item-delete':
      return callSalla(merchantId(), 'DELETE', `/orders/items/${encodeURIComponent(need('item'))}`);
    case 'refund': {
      const amount = Number(need('amount'));
      // Salla reads 0 as "refund everything".
      if (!Number.isFinite(amount) || amount <= 0) {
        console.error('--amount must be greater than 0');
        process.exit(1);
      }
      return callSalla(merchantId(), 'PUT', `/transactions/${encodeURIComponent(need('tx'))}`, {
        action: 'refund',
        amount,
        currency: arg('currency') || 'SAR',
      });
    }
    case 'cancel':
      return callSalla(merchantId(), 'POST', '/orders/actions', {
        operations: [
          { action_name: 'change_status', value: { status: SALLA_CANCELED_STATUS_ID, restore_items: true, send_status_sms: false } },
        ],
        filters: { order_ids: [Number(orderId)] },
      });
    default:
      throw new Error(`Unknown step ${step}`);
  }
}

async function main() {
  const step = need('step');

  if (step === 'scopes') return stepScopes();
  if (step === 'tx-methods') return stepTxMethods();
  if (step === 'find') return stepFind();

  const orderId = need('order');
  if (step === 'snapshot') return print(`snapshot ${orderId}`, await snapshot(orderId));

  if (!WRITE_STEPS.has(step)) {
    console.error(`Unknown step "${step}"`);
    process.exit(1);
  }
  if (!has('confirm')) {
    console.error(`"${step}" writes to the live store. Re-run with --confirm.`);
    process.exit(1);
  }

  if (step === 'flag') {
    const order = await prisma.sallaOrder.findUnique({
      where: { merchantId_orderId: { merchantId: merchantId(), orderId } },
      select: { referenceId: true, orderNumber: true },
    });
    if (!order) {
      console.error(`Order ${orderId} is not in the local mirror yet (wait for the webhook, or check the id).`);
      process.exit(1);
    }
    await prisma.orderDoNotShipFlag.upsert({
      where: { merchantId_orderId: { merchantId: merchantId(), orderId } },
      create: {
        merchantId: merchantId(),
        orderId,
        orderNumber: order.referenceId || order.orderNumber,
        notes: FLAG_NOTE,
        createdByName: 'probe-order-manage',
      },
      update: {},
    });
    console.log(`Do-not-ship flag is on order ${orderId}.`);
    return;
  }
  if (step === 'unflag') {
    const removed = await prisma.orderDoNotShipFlag.deleteMany({
      where: { merchantId: merchantId(), orderId, notes: FLAG_NOTE },
    });
    console.log(removed.count > 0 ? `Flag removed from order ${orderId}.` : 'No probe flag on that order (a flag set by staff is left alone).');
    return;
  }

  if (SALLA_WRITE_STEPS.has(step)) await assertFlagged(orderId);

  const startedAt = new Date();
  print(`BEFORE ${step}`, await snapshot(orderId));
  try {
    const response = await runWrite(step, orderId);
    print(`RESPONSE ${step}`, response);
  } catch (error) {
    if (error instanceof SallaCallError) {
      print(`ERROR ${step}`, { message: error.message, status: error.status, outcomeUnknown: error.outcomeUnknown });
      if (error.outcomeUnknown) console.log('Outcome unknown: do NOT re-run this step. Check the AFTER snapshot below.');
    } else {
      throw error;
    }
  }
  // Webhooks trail the write by a few seconds.
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  print(`AFTER ${step}`, await snapshot(orderId, startedAt));
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('Probe failed:', error);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
