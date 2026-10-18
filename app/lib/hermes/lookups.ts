import { normalizeE164Phone, normalizePhoneWithDialCode } from '@/app/lib/phone';
import {
  buildShipmentEvents,
  buildShipmentViews,
  orderReference,
  presentReturn,
  toOrderDetail,
  toOrderSummary,
  type PresentOptions,
} from './dto';
import type { HandlerResult, HermesContext } from './handler';
import { HermesError } from './http';
import {
  customerRef,
  emailLookupVariants,
  phoneLookupVariants,
  resolveCustomerRef,
  trackingVariants,
} from './identifiers';
import { presentEmail, presentPhone } from './pii';
import { IN_TRANSIT_STAGES, OPEN_STAGES, orderStage } from './statuses';
import type { HermesStore, OrderSummaryRow } from './store';
import {
  paginationMeta,
  parseCustomerSearch,
  parseOrderReference,
  parseOrderSearch,
  parsePagination,
  parseShipmentSearch,
  parseTrackingNumber,
} from './validation';

/**
 * Support lookups. Every search needs one exact identifier — there is no
 * partial matching, listing or free-text search — and every match is checked
 * again in code against the identifier that was asked for, so an over-broad
 * database match can never return another customer's data.
 */

/** Upper bound on rows fetched for one identifier; enough for any real customer. */
const CANDIDATE_LIMIT = 100;
const RECENT_ORDERS = 5;
const SUMMARY_ORDER_WINDOW = 200;

function presentOptions(ctx: HermesContext): PresentOptions {
  const merchantId = ctx.credential.merchantId;
  return { fullPii: ctx.fullPii, customerRefFor: (customerId) => customerRef(merchantId, customerId) };
}

const piiClass = (ctx: HermesContext) => (ctx.fullPii ? 'pii:full' : 'pii:masked');

/** Keeps only rows whose stored phone really is `wanted`, using the order's own dialling code. */
async function verifyPhoneMatches(
  store: HermesStore,
  merchantId: string,
  rows: OrderSummaryRow[],
  wanted: string
): Promise<OrderSummaryRow[]> {
  const confirmed = new Set<string>();
  const ambiguous: string[] = [];
  for (const row of rows) {
    // Webhook-written rows hold E.164 already normalised with Salla's dialling code.
    if (row.customerMobile?.startsWith('+')) {
      if (normalizeE164Phone(row.customerMobile) === wanted) confirmed.add(row.id);
    } else {
      ambiguous.push(row.id);
    }
  }
  if (ambiguous.length > 0) {
    for (const info of await store.loadDialInfo(merchantId, ambiguous)) {
      if (normalizePhoneWithDialCode(info.mobile, info.mobileCode) === wanted) confirmed.add(info.id);
    }
  }
  return rows.filter((row) => confirmed.has(row.id));
}

async function ordersByPhone(store: HermesStore, merchantId: string, phone: string) {
  const rows = await store.findOrdersByPhoneVariants(merchantId, phoneLookupVariants(phone), CANDIDATE_LIMIT);
  return verifyPhoneMatches(store, merchantId, rows, phone);
}

async function ordersByEmail(store: HermesStore, merchantId: string, email: string) {
  const rows = await store.findOrdersByEmails(merchantId, emailLookupVariants(email), CANDIDATE_LIMIT);
  return rows.filter((row) => row.customerEmail?.trim().toLowerCase() === email);
}

/** Prefers the order whose customer-facing reference matches over an internal number match. */
function pickByReference(rows: OrderSummaryRow[], reference: string): OrderSummaryRow | null {
  return rows.find((row) => row.referenceId === reference) ?? rows.find((row) => row.orderNumber === reference) ?? null;
}

// ---------------------------------------------------------------------- orders

export async function searchOrders(ctx: HermesContext): Promise<HandlerResult> {
  const criteria = parseOrderSearch(ctx.params);
  const pagination = parsePagination(ctx.params);
  const { store } = ctx;
  const merchantId = ctx.credential.merchantId;

  let rows: OrderSummaryRow[];
  let criterion: string;
  if (criteria.orderNumber) {
    criterion = 'order_number';
    const match = pickByReference(await store.findOrdersByReference(merchantId, criteria.orderNumber), criteria.orderNumber);
    rows = match ? [match] : [];
  } else if (criteria.phone) {
    criterion = 'phone';
    rows = await ordersByPhone(store, merchantId, criteria.phone);
  } else if (criteria.email) {
    criterion = 'email';
    rows = await ordersByEmail(store, merchantId, criteria.email);
  } else {
    criterion = 'tracking_number';
    rows = await store.findOrdersByTracking(merchantId, trackingVariants(criteria.trackingNumber!), CANDIDATE_LIMIT);
  }

  const options = presentOptions(ctx);
  const page = rows.slice(pagination.offset, pagination.offset + pagination.pageSize);
  return {
    data: { items: page.map((row) => toOrderSummary(row, options)) },
    meta: { criterion, pagination: paginationMeta(pagination, rows.length), currency: null },
    audit: {
      outcome: rows.length > 0 ? 'success' : 'not_found',
      targetType: 'order',
      // The search input (phone/email) is never stored; only what was returned.
      targetId: rows.length === 1 ? rows[0].id : null,
      resultCount: rows.length,
      classification: piiClass(ctx),
    },
  };
}

export async function getOrder(ctx: HermesContext): Promise<HandlerResult> {
  const reference = parseOrderReference(ctx.pathParams.orderReference ?? null, 'orderReference')!;
  const merchantId = ctx.credential.merchantId;
  const match = pickByReference(await ctx.store.findOrdersByReference(merchantId, reference), reference);
  const bundle = match ? await ctx.store.loadOrderDetail(merchantId, match.id) : null;
  if (!bundle) throw new HermesError('not_found');

  return {
    data: toOrderDetail(bundle, presentOptions(ctx)),
    meta: { currency: bundle.order.currency },
    audit: { targetType: 'order', targetId: bundle.order.id, resultCount: 1, classification: piiClass(ctx) },
  };
}

// ------------------------------------------------------------------- customers

function groupCustomers(rows: OrderSummaryRow[], ctx: HermesContext) {
  const groups = new Map<string, OrderSummaryRow[]>();
  for (const row of rows) {
    const key = row.customerId ?? `contact:${row.customerMobile ?? row.customerEmail ?? row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.values()).map((orders) => {
    const latest = orders[0];
    return {
      customer_ref: customerRef(ctx.credential.merchantId, latest.customerId),
      name: latest.customerName,
      phone: presentPhone(latest.customerMobile, ctx.fullPii),
      email: presentEmail(latest.customerEmail, ctx.fullPii),
      city: latest.customerCity,
      country: latest.customerCountry,
      matched_orders: orders.length,
      last_order_at: latest.placedAt?.toISOString() ?? null,
    };
  });
}

export async function searchCustomers(ctx: HermesContext): Promise<HandlerResult> {
  const criteria = parseCustomerSearch(ctx.params);
  const merchantId = ctx.credential.merchantId;
  const { store } = ctx;

  let rows: OrderSummaryRow[];
  let criterion: string;
  if (criteria.phone) {
    criterion = 'phone';
    rows = await ordersByPhone(store, merchantId, criteria.phone);
  } else if (criteria.email) {
    criterion = 'email';
    rows = await ordersByEmail(store, merchantId, criteria.email);
  } else {
    criterion = 'customer_id';
    rows = await store.findOrdersByCustomerId(merchantId, criteria.customerId!, CANDIDATE_LIMIT);
  }

  // One identifier maps to very few customers; the cap stops it becoming a listing.
  const customers = groupCustomers(rows, ctx).slice(0, 5);
  return {
    data: { items: customers },
    meta: { criterion, currency: null },
    audit: {
      outcome: customers.length > 0 ? 'success' : 'not_found',
      targetType: 'customer',
      targetId: customers.length === 1 ? rows[0].customerId : null,
      resultCount: customers.length,
      classification: piiClass(ctx),
    },
  };
}

export async function getCustomerSummary(ctx: HermesContext): Promise<HandlerResult> {
  const merchantId = ctx.credential.merchantId;
  const customerId = resolveCustomerRef(merchantId, ctx.pathParams.customerRef ?? '');
  if (!customerId) throw new HermesError('not_found');

  const [orders, orderCount] = await Promise.all([
    ctx.store.findOrdersByCustomerId(merchantId, customerId, SUMMARY_ORDER_WINDOW),
    ctx.store.countOrdersByCustomerId(merchantId, customerId),
  ]);
  if (orders.length === 0) throw new HermesError('not_found');

  const options = presentOptions(ctx);
  const activeOrders = orders.filter((row) => {
    const stage = orderStage(row.statusSlug);
    return stage === 'awaiting_payment' || OPEN_STAGES.includes(stage) || IN_TRANSIT_STAGES.includes(stage);
  });
  const orderIds = orders.map((row) => row.orderId);
  const [returns, localShipments] = await Promise.all([
    ctx.store.loadReturnsForOrders(merchantId, orderIds),
    ctx.store.loadLocalShipmentsForOrders(
      merchantId,
      activeOrders.map((row) => row.orderId)
    ),
  ]);

  const latest = orders[0];
  const openReturnStatuses = new Set(['pending_review', 'approved', 'shipped', 'delivered']);
  const localByOrder = new Map(localShipments.map((row) => [row.orderId, row]));

  return {
    data: {
      customer_ref: customerRef(merchantId, customerId),
      name: latest.customerName,
      phone: presentPhone(latest.customerMobile, ctx.fullPii),
      email: presentEmail(latest.customerEmail, ctx.fullPii),
      city: latest.customerCity,
      country: latest.customerCountry,
      order_count: orderCount,
      first_order_at: orderCount <= orders.length ? orders[orders.length - 1].placedAt?.toISOString() ?? null : null,
      last_order_at: latest.placedAt?.toISOString() ?? null,
      recent_orders: orders.slice(0, RECENT_ORDERS).map((row) => toOrderSummary(row, options)),
      active_orders: activeOrders.map((row) => toOrderSummary(row, options)),
      active_shipments: activeOrders
        .filter((row) => IN_TRANSIT_STAGES.includes(orderStage(row.statusSlug)) || localByOrder.has(row.orderId))
        .map((row) => {
          const local = localByOrder.get(row.orderId);
          return {
            order_reference: orderReference(row),
            tracking_number: local?.trackingNumber ?? row.trackingNumber,
            carrier: local ? 'local_courier' : toOrderSummary(row, options).carrier?.code ?? null,
            status: toOrderSummary(row, options).status,
          };
        }),
      returns: {
        total: returns.length,
        open: returns.filter((row) => openReturnStatuses.has(row.status)).length,
        recent: returns.slice(0, RECENT_ORDERS).map(presentReturn),
      },
    },
    meta: { currency: null, orders_considered: orders.length },
    audit: { targetType: 'customer', targetId: customerId, resultCount: 1, classification: piiClass(ctx) },
  };
}

// ------------------------------------------------------------------- shipments

export async function searchShipments(ctx: HermesContext): Promise<HandlerResult> {
  const criteria = parseShipmentSearch(ctx.params);
  const merchantId = ctx.credential.merchantId;
  let items: ReturnType<typeof buildShipmentViews> = [];

  if (criteria.orderNumber) {
    const match = pickByReference(await ctx.store.findOrdersByReference(merchantId, criteria.orderNumber), criteria.orderNumber);
    const bundle = match ? await ctx.store.loadOrderDetail(merchantId, match.id) : null;
    if (bundle) {
      items = buildShipmentViews(
        bundle.order,
        bundle.sallaShipment ? [bundle.sallaShipment] : [],
        bundle.localShipments,
        bundle.scans
      );
    }
  } else {
    items = (await shipmentsForTracking(ctx, criteria.trackingNumber!)).views;
  }

  return {
    data: { items },
    meta: { criterion: criteria.orderNumber ? 'order_number' : 'tracking_number', currency: null },
    audit: {
      outcome: items.length > 0 ? 'success' : 'not_found',
      targetType: 'shipment',
      targetId: items.length === 1 ? items[0].tracking_number : null,
      resultCount: items.length,
      classification: 'operational',
    },
  };
}

async function shipmentsForTracking(ctx: HermesContext, trackingNumber: string) {
  const merchantId = ctx.credential.merchantId;
  const variants = trackingVariants(trackingNumber);
  const sources = await ctx.store.findShipmentSources(merchantId, variants);
  if (sources.orders.length === 0) return { views: [], sources, scans: [] };

  const trackingNumbers = Array.from(
    new Set([
      ...sources.sallaShipments.map((row) => row.trackingNumber),
      ...sources.localShipments.map((row) => row.trackingNumber),
      ...sources.orders.map((row) => row.trackingNumber).filter((value): value is string => Boolean(value)),
    ])
  );
  const scans = await ctx.store.loadScans(trackingNumbers);
  const views = sources.orders.flatMap((order) =>
    buildShipmentViews(
      order,
      sources.sallaShipments.filter((row) => row.orderId === order.orderId),
      sources.localShipments.filter((row) => row.orderId === order.orderId),
      scans
    ).filter((view) => variants.includes(view.tracking_number))
  );
  return { views, sources, scans };
}

export async function getShipment(ctx: HermesContext): Promise<HandlerResult> {
  const trackingNumber = parseTrackingNumber(ctx.pathParams.shipmentReference ?? null, 'shipmentReference')!;
  const { views, sources, scans } = await shipmentsForTracking(ctx, trackingNumber);
  const shipment = views[0];
  if (!shipment) throw new HermesError('not_found');

  const carrierEvents = await ctx.store.loadCarrierEvents([shipment.tracking_number]);
  const scan = scans.find((row) => row.trackingNumber === shipment.tracking_number);
  const local = sources.localShipments.find((row) => row.trackingNumber === shipment.tracking_number);

  return {
    data: { ...shipment, events: buildShipmentEvents(shipment, scan, carrierEvents, local) },
    meta: { currency: null },
    audit: { targetType: 'shipment', targetId: shipment.tracking_number, resultCount: 1, classification: 'operational' },
  };
}
