import type { AjexLiveStatus } from '@/types/ajex';
import { returnReasonLabel } from '@/lib/returns/reasons';
import type { SmsaLiveStatus } from '@/types/smsa';
import { cachedReport, reportCacheKey } from './cache';
import { orderReference } from './dto';
import type { HandlerResult, HermesContext } from './handler';
import { HERMES_REPORT_CURRENCY } from './http';
import { customerRef } from './identifiers';
import { formatMoney, percentChange, ratio, sarRateFor, sum, toSar, ZERO, type Decimal } from './money';
import { canSeeFullPii, HERMES_SCOPES } from './scopes';
import {
  ajexStatusView,
  carrierLabel,
  derivePaymentState,
  deriveFulfillmentState,
  fulfillmentStateLabel,
  IN_TRANSIT_STAGES,
  localShipmentStatus,
  NON_SALE_STAGES,
  normalizeCarrier,
  orderStage,
  orderStageLabel,
  paymentStateLabel,
  RETURN_STAGES,
  returnStatusLabel,
  returnTypeLabel,
  shipmentStatusFromOrderStatus,
  shipmentStatusLabel,
  smsaStatusView,
  type CarrierCode,
  type ShipmentStatus,
} from './statuses';
import type {
  Freshness,
  HermesStore,
  ReportOrderRow,
  ShipmentFactRow,
  UtcRange,
} from './store';
import { addDays, eachDate, hoursBetween, localDateKey, parseLooseDate, startOfLocalDay } from './time';
import {
  MAX_REPORT_PAGE_SIZE,
  paginationMeta,
  parsePagination,
  parseReportParams,
  type DateRange,
  type Pagination,
  type ReportFilters,
  type ReportParams,
} from './validation';

/**
 * Management reports. Rows are loaded per merchant and date range only, then
 * filtered and aggregated here with Decimal arithmetic, so the same rules
 * apply to every report and are unit-testable without a database. All money
 * is converted to SAR with the per-order Salla exchange rate (the ERP sync's
 * resolution); orders that cannot be converted are excluded from money totals
 * and counted in `meta.unconverted_orders`.
 */

export const DELAY_THRESHOLD_HOURS = 5 * 24;
const AGING_LOOKBACK_DAYS = 180;
const TOP_CUSTOMERS = 10;
const LOW_PERFORMERS = 10;

// ------------------------------------------------------------------- plumbing

export function utcRange(range: DateRange, timeZone: string): UtcRange {
  return { start: startOfLocalDay(range.from, timeZone), end: startOfLocalDay(addDays(range.to, 1), timeZone) };
}

export function matchesFilters(row: ReportOrderRow, filters: ReportFilters): boolean {
  const lower = (value: string | null) => value?.trim().toLowerCase() ?? '';
  if (filters.status.length && !filters.status.includes(orderStage(row.statusSlug))) return false;
  if (filters.payment_method.length && !filters.payment_method.some((value) => value.toLowerCase() === lower(row.paymentMethod))) return false;
  if (filters.city.length && !filters.city.some((value) => value.toLowerCase() === lower(row.customerCity))) return false;
  if (filters.carrier.length && !filters.carrier.includes(normalizeCarrier(row.fulfillmentCompany) ?? '')) return false;
  if (filters.source.length && !filters.source.some((value) => value.toLowerCase() === lower(row.campaignSource))) return false;
  return true;
}

export const isSale = (row: Pick<ReportOrderRow, 'statusSlug'>) => !NON_SALE_STAGES.includes(orderStage(row.statusSlug));

interface Money {
  rate: Decimal | null;
  subtotal: Decimal;
  discount: Decimal;
  shipping: Decimal;
  tax: Decimal;
  total: Decimal;
  partialRefund: Decimal;
}

export function moneyFor(row: ReportOrderRow): Money {
  const rate = sarRateFor(row.currency, row.exchangeRate);
  const sar = (value: Decimal | null) => toSar(value, rate) ?? ZERO;
  return {
    rate,
    subtotal: sar(row.subtotalAmount),
    discount: sar(row.discountTotal),
    shipping: sar(row.shippingAmount),
    tax: sar(row.taxAmount),
    total: sar(row.totalAmount),
    partialRefund: sar(row.refundedItemsTotal),
  };
}

interface ReportInputs {
  orders: ReportOrderRow[];
  unconverted: number;
}

async function loadOrders(store: HermesStore, merchantId: string, range: UtcRange, filters: ReportFilters): Promise<ReportInputs> {
  const orders = (await store.loadReportOrders(merchantId, range)).filter((row) => matchesFilters(row, filters));
  const unconverted = orders.filter((row) => isSale(row) && !moneyFor(row).rate).length;
  return { orders, unconverted };
}

function rangeMeta(params: ReportParams) {
  const primary = utcRange(params.range, params.timeZone);
  const comparison = params.comparison ? utcRange(params.comparison, params.timeZone) : null;
  return {
    applied_range: { ...params.range, utc_start: primary.start.toISOString(), utc_end_exclusive: primary.end.toISOString() },
    comparison_range: params.comparison
      ? {
          mode: params.comparison.mode,
          from: params.comparison.from,
          to: params.comparison.to,
          utc_start: comparison!.start.toISOString(),
          utc_end_exclusive: comparison!.end.toISOString(),
        }
      : null,
    timezone: params.timeZone,
    applied_filters: params.filters,
  };
}

function freshnessMeta(freshness: Freshness, cache: { hit: boolean; storedAt: Date }) {
  return {
    last_order_placed_at: freshness.lastOrderPlacedAt?.toISOString() ?? null,
    last_webhook_received_at: freshness.lastWebhookAt?.toISOString() ?? null,
    source: 'Salla orders mirrored by webhook and scheduled sync',
    cached: cache.hit,
    computed_at: cache.storedAt.toISOString(),
    cache_ttl_seconds: 60,
  };
}

function money(value: Decimal) {
  return formatMoney(value);
}

function change(current: Decimal | number, previous: Decimal | number | null | undefined) {
  if (previous === null || previous === undefined) return null;
  return { previous: typeof previous === 'number' ? previous : formatMoney(previous), percent_change: percentChange(current, previous) };
}

function paginate<T>(items: T[], pagination: Pagination) {
  return {
    items: items.slice(pagination.offset, pagination.offset + pagination.pageSize),
    pagination: paginationMeta(pagination, items.length),
  };
}

interface ReportDefinition<T> {
  action: string;
  extraParams?: readonly string[];
  compute: (ctx: HermesContext, params: ReportParams) => Promise<T>;
  present: (computed: T, ctx: HermesContext, pagination: Pagination) => unknown;
  definitions: Record<string, string>;
}

export function reportParamNames(extra: readonly string[] = []): string[] {
  return ['from', 'to', 'timezone', 'compare', 'status', 'payment_method', 'city', 'carrier', 'source', 'page', 'page_size', ...extra];
}

export function runReport<T>(definition: ReportDefinition<T>) {
  return async (ctx: HermesContext): Promise<HandlerResult> => {
    const params = parseReportParams(ctx.params, ctx.now);
    const pagination = parsePagination(ctx.params, { max: MAX_REPORT_PAGE_SIZE, defaultSize: 20 });
    const merchantId = ctx.credential.merchantId;

    const key = reportCacheKey({
      merchantId,
      scopes: ctx.credential.scopes,
      action: definition.action,
      params: { range: params.range, comparison: params.comparison, timeZone: params.timeZone, filters: params.filters },
    });
    const [cache, freshness] = await Promise.all([
      cachedReport(key, () => definition.compute(ctx, params)),
      ctx.store.loadFreshness(merchantId),
    ]);

    return {
      data: definition.present(cache.value, ctx, pagination),
      meta: {
        currency: HERMES_REPORT_CURRENCY,
        ...rangeMeta(params),
        timezone: params.timeZone,
        definitions: definition.definitions,
        data_freshness: freshnessMeta(freshness, cache),
        unconverted_orders: (cache.value as { unconverted?: number }).unconverted ?? 0,
      },
      audit: { targetType: 'report', targetId: null, resultCount: null, classification: 'aggregate' },
    };
  };
}

// ---------------------------------------------------------------- sales summary

interface SalesTotals {
  order_count: number;
  gross_sales: Decimal;
  discounts: Decimal;
  shipping_revenue: Decimal;
  tax: Decimal;
  total_sales: Decimal;
  full_refunds: Decimal;
  full_refund_orders: number;
  partial_refunds: Decimal;
  partial_refund_orders: number;
  refunds: Decimal;
  net_sales: Decimal;
  average_order_value: Decimal;
  cancelled_orders: number;
  unconverted: number;
}

export async function computeSalesTotals(
  store: HermesStore,
  merchantId: string,
  range: UtcRange,
  filters: ReportFilters
): Promise<SalesTotals> {
  const [{ orders, unconverted }, restored] = await Promise.all([
    loadOrders(store, merchantId, range, filters),
    store.loadRestoredOrders(merchantId, range),
  ]);
  const sales = orders.filter(isSale).map((row) => ({ row, money: moneyFor(row) })).filter(({ money }) => money.rate);
  const fullRefunds = restored.filter((row) => matchesFilters(row, filters)).map(moneyFor).filter((m) => m.rate);
  const partial = sales.filter(({ row, money }) => !RETURN_STAGES.includes(orderStage(row.statusSlug)) && money.partialRefund.gt(0));

  const total = sum(sales.map(({ money }) => money.total));
  const fullRefundTotal = sum(fullRefunds.map((m) => m.total));
  const partialTotal = sum(partial.map(({ money }) => money.partialRefund));
  const refunds = fullRefundTotal.plus(partialTotal);

  return {
    order_count: sales.length,
    gross_sales: sum(sales.map(({ money }) => money.subtotal)),
    discounts: sum(sales.map(({ money }) => money.discount)),
    shipping_revenue: sum(sales.map(({ money }) => money.shipping)),
    tax: sum(sales.map(({ money }) => money.tax)),
    total_sales: total,
    full_refunds: fullRefundTotal,
    full_refund_orders: fullRefunds.length,
    partial_refunds: partialTotal,
    partial_refund_orders: partial.length,
    refunds,
    net_sales: total.minus(refunds),
    average_order_value: sales.length ? total.dividedBy(sales.length) : ZERO,
    cancelled_orders: orders.filter((row) => orderStage(row.statusSlug) === 'cancelled').length,
    unconverted,
  };
}

function presentSales(current: SalesTotals, previous: SalesTotals | null) {
  const moneyKeys = ['gross_sales', 'discounts', 'shipping_revenue', 'tax', 'total_sales', 'refunds', 'full_refunds', 'partial_refunds', 'net_sales', 'average_order_value'] as const;
  const countKeys = ['order_count', 'full_refund_orders', 'partial_refund_orders', 'cancelled_orders'] as const;
  const metrics: Record<string, unknown> = {};
  for (const key of moneyKeys) {
    metrics[key] = { value: money(current[key]), ...(previous ? { comparison: change(current[key], previous[key]) } : {}) };
  }
  for (const key of countKeys) {
    metrics[key] = { value: current[key], ...(previous ? { comparison: change(current[key], previous[key]) } : {}) };
  }
  return metrics;
}

export const salesReport = runReport({
  action: 'reports.sales',
  async compute(ctx, params) {
    const merchantId = ctx.credential.merchantId;
    const [current, previous] = await Promise.all([
      computeSalesTotals(ctx.store, merchantId, utcRange(params.range, params.timeZone), params.filters),
      params.comparison
        ? computeSalesTotals(ctx.store, merchantId, utcRange(params.comparison, params.timeZone), params.filters)
        : Promise.resolve(null),
    ]);
    return { current, previous, unconverted: current.unconverted };
  },
  present: ({ current, previous }) => ({ metrics: presentSales(current, previous) }),
  definitions: {
    order_count: 'Orders placed in the range, excluding awaiting-payment, cancelled and deleted orders.',
    gross_sales: 'Sum of Salla sub_total (item prices before order discounts, excluding shipping and VAT), SAR.',
    discounts: 'Sum of order-level discounts (coupons and promotions) from Salla amounts.discounts.',
    shipping_revenue: 'Sum of shipping charged to customers.',
    tax: 'Sum of VAT charged.',
    total_sales: 'Sum of order totals: gross_sales − discounts + shipping_revenue + tax.',
    full_refunds: 'Order totals of orders whose first transition to Salla status "restored" happened inside the range (refund date basis).',
    partial_refunds: 'Refunded line items (Salla refunded_items) on orders placed in the range that were not fully returned (order date basis).',
    refunds: 'full_refunds + partial_refunds.',
    net_sales: 'total_sales − refunds.',
    average_order_value: 'total_sales ÷ order_count.',
    currency: 'All amounts converted to SAR using each order\'s Salla exchange rate.',
  },
});

// ------------------------------------------------------------ order operations

export const orderOperationsReport = runReport({
  action: 'reports.order_operations',
  async compute(ctx, params) {
    const merchantId = ctx.credential.merchantId;
    const range = utcRange(params.range, params.timeZone);
    const openSlugs = ['payment_pending', 'under_review', 'in_progress', 'processing', 'completed', 'ready_for_pickup'];
    const [{ orders, unconverted }, returnRequests, openOrders, pendingReturns, previous] = await Promise.all([
      loadOrders(ctx.store, merchantId, range, params.filters),
      ctx.store.loadReportReturnRequests(merchantId, range),
      ctx.store.loadOpenOrders(merchantId, openSlugs, new Date(ctx.now.getTime() - AGING_LOOKBACK_DAYS * 86_400_000)),
      ctx.store.countPendingReturnRequests(merchantId),
      params.comparison
        ? loadOrders(ctx.store, merchantId, utcRange(params.comparison, params.timeZone), params.filters)
        : Promise.resolve(null),
    ]);

    const tally = <K extends string>(rows: ReportOrderRow[], keyOf: (row: ReportOrderRow) => K) => {
      const counts = new Map<K, number>();
      for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
      return counts;
    };
    const summarize = (rows: ReportOrderRow[]) => ({
      total: rows.length,
      byStage: tally(rows, (row) => orderStage(row.statusSlug)),
      byPayment: tally(rows, (row) => derivePaymentState(row).code),
      byFulfillment: tally(rows, (row) => deriveFulfillmentState(row.statusSlug).code),
      partialRefunds: rows.filter((row) => row.refundedItemsCount > 0 && !RETURN_STAGES.includes(orderStage(row.statusSlug))).length,
    });

    const nowMs = ctx.now.getTime();
    const aging = openOrders
      .filter((row) => matchesFilters(row, params.filters) && orderStage(row.statusSlug) !== 'awaiting_payment')
      .map((row) => ({
        order_reference: orderReference(row),
        status: orderStage(row.statusSlug),
        status_label_ar: orderStageLabel(orderStage(row.statusSlug)),
        placed_at: row.placedAt.toISOString(),
        age_hours: Math.floor((nowMs - row.placedAt.getTime()) / 3_600_000),
      }))
      .sort((a, b) => b.age_hours - a.age_hours || a.order_reference.localeCompare(b.order_reference));

    return {
      current: summarize(orders),
      previous: previous ? summarize(previous.orders) : null,
      returnRequests,
      aging,
      awaitingPayment: openOrders.filter((row) => orderStage(row.statusSlug) === 'awaiting_payment').length,
      pendingReturns,
      unconverted,
    };
  },
  present(computed, _ctx, pagination) {
    const { current, previous } = computed;
    const asList = (counts: Map<string, number>, label: (key: string) => string, prev?: Map<string, number>) =>
      Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, count]) => ({ code, label_ar: label(code), count, ...(prev ? { comparison: change(count, prev.get(code) ?? 0) } : {}) }));
    const count = (map: Map<string, number>, key: string) => map.get(key) ?? 0;
    const stageCount = (map: Map<string, number>, stages: readonly string[]) => stages.reduce((total, stage) => total + count(map, stage), 0);
    const bucket = (min: number, max: number) => computed.aging.filter((row) => row.age_hours >= min && row.age_hours < max).length;
    const returnsBy = (keyOf: (row: { type: string; status: string; reason: string }) => string, label: (key: string) => string) => {
      const counts = new Map<string, number>();
      for (const row of computed.returnRequests) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
      return asList(counts, label);
    };

    return {
      orders_total: { value: current.total, ...(previous ? { comparison: change(current.total, previous.total) } : {}) },
      orders_by_status: asList(current.byStage, (code) => orderStageLabel(code as never), previous?.byStage),
      payment: {
        paid: count(current.byPayment, 'paid') + count(current.byPayment, 'refunded') + count(current.byPayment, 'free'),
        unpaid: count(current.byPayment, 'awaiting_payment') + count(current.byPayment, 'cod_due'),
        breakdown: asList(current.byPayment, paymentStateLabel),
      },
      fulfillment: {
        fulfilled: count(current.byFulfillment, 'fulfilled'),
        unfulfilled: count(current.byFulfillment, 'unfulfilled') + count(current.byFulfillment, 'ready_to_ship'),
        breakdown: asList(current.byFulfillment, fulfillmentStateLabel),
      },
      cancelled_orders: count(current.byStage, 'cancelled'),
      returned_or_refunded_orders: {
        fully_returned: count(current.byStage, 'returned'),
        return_in_progress: count(current.byStage, 'return_in_progress'),
        partially_refunded: current.partialRefunds,
      },
      return_requests: {
        total: computed.returnRequests.length,
        by_type: returnsBy((row) => row.type, returnTypeLabel),
        by_status: returnsBy((row) => row.status, returnStatusLabel),
        by_reason: returnsBy((row) => row.reason, returnReasonLabel),
      },
      awaiting_action: {
        new_orders: computed.aging.filter((row) => row.status === 'new').length,
        processing: computed.aging.filter((row) => row.status === 'processing').length,
        ready_to_ship: computed.aging.filter((row) => row.status === 'ready_to_ship').length,
        awaiting_payment: computed.awaitingPayment,
        return_requests_pending_review: computed.pendingReturns,
      },
      aging_open_orders: {
        as_of: 'now',
        buckets: {
          under_24h: bucket(0, 24),
          from_1_to_3_days: bucket(24, 72),
          from_3_to_7_days: bucket(72, 168),
          over_7_days: bucket(168, Number.POSITIVE_INFINITY),
        },
        oldest_first: paginate(computed.aging, pagination),
      },
      in_transit_orders: stageCount(current.byStage, IN_TRANSIT_STAGES),
    };
  },
  definitions: {
    orders_by_status: 'Orders placed in the range grouped by their current normalized status.',
    payment: 'Derived from order status, payment method and Salla is_pending_payment (Salla does not store a payment status). paid includes refunded and free orders; unpaid is awaiting payment plus cash-on-delivery not yet collected.',
    fulfillment: 'fulfilled = handed to a carrier or later; unfulfilled = not yet shipped, including ready_to_ship.',
    aging_open_orders: 'As of now (not limited to the range): orders in new, processing or ready_to_ship status placed within the last 180 days; age is hours since placement. Filters apply.',
    awaiting_action: 'Open orders needing staff action now, plus return requests pending review (merchant-wide, filters not applied to returns).',
    return_requests: 'Return/exchange requests created in the range (filters not applied). by_reason uses the predefined reason the customer picked on the returns form; free-text details are not exposed.',
  },
});

// ---------------------------------------------------------- shipment performance

interface ShipmentFact {
  orderReference: string;
  trackingNumber: string | null;
  carrier: CarrierCode | null;
  status: ShipmentStatus;
  carrierTracked: boolean;
  placedAt: Date;
  labelAt: Date | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  exceptionReason: string | null;
}

export function toShipmentFact(row: ReportOrderRow, fact: ShipmentFactRow): ShipmentFact | null {
  const hasShipment = Boolean(fact.labelCreatedAt || fact.scannedAt || fact.localCreatedAt);
  if (!hasShipment) return null;

  if (fact.localStatus) {
    return {
      orderReference: orderReference(row),
      trackingNumber: fact.trackingNumber,
      carrier: 'local_courier',
      status: localShipmentStatus(fact.localStatus),
      carrierTracked: true,
      placedAt: row.placedAt,
      labelAt: fact.localCreatedAt,
      dispatchedAt: fact.localCreatedAt,
      deliveredAt: fact.localDeliveredAt,
      exceptionReason: null,
    };
  }

  const carrier = normalizeCarrier(fact.courierName, fact.scanCompany, row.fulfillmentCompany);
  const ajex = ajexStatusView(fact.ajexLiveStatus as AjexLiveStatus | null);
  const smsa = smsaStatusView(fact.smsaLiveStatus as SmsaLiveStatus | null);
  const live = carrier === 'ajex' ? ajex ?? smsa : smsa ?? ajex;
  const tracked = Boolean(live && live.status !== 'unknown');
  const status = tracked ? live!.status : shipmentStatusFromOrderStatus(row.statusSlug);

  return {
    orderReference: orderReference(row),
    trackingNumber: fact.trackingNumber,
    carrier,
    status,
    carrierTracked: tracked,
    placedAt: row.placedAt,
    labelAt: fact.labelCreatedAt,
    dispatchedAt: fact.scannedAt,
    deliveredAt: tracked && status === 'delivered' ? fact.ajexLiveStatusEventAt ?? parseLooseDate(live!.event_at) : null,
    exceptionReason: status === 'exception' ? live?.exception_reason ?? null : null,
  };
}

function average(values: (number | null)[]) {
  const present = values.filter((value): value is number => value !== null);
  return {
    hours: present.length ? (present.reduce((a, b) => a + b, 0) / present.length).toFixed(1) : null,
    sample_size: present.length,
  };
}

export function successRate(facts: ShipmentFact[]) {
  const tracked = facts.filter((fact) => fact.carrierTracked);
  const delivered = tracked.filter((fact) => fact.status === 'delivered').length;
  const failed = tracked.filter((fact) => fact.status === 'returned_to_sender').length;
  return { percent: ratio(delivered, delivered + failed), delivered, returned_to_sender: failed, sample_size: delivered + failed };
}

async function computeShipmentFacts(store: HermesStore, merchantId: string, range: UtcRange, filters: ReportFilters) {
  const [{ orders, unconverted }, factRows] = await Promise.all([
    loadOrders(store, merchantId, range, filters),
    store.loadShipmentFacts(merchantId, range),
  ]);
  const ordersById = new Map(orders.map((row) => [row.id, row]));
  const facts = factRows
    .map((fact) => {
      const row = ordersById.get(fact.orderRowId);
      return row ? toShipmentFact(row, fact) : null;
    })
    .filter((fact): fact is ShipmentFact => fact !== null);
  return { facts, unconverted };
}

export const shipmentPerformanceReport = runReport({
  action: 'reports.shipment_performance',
  async compute(ctx, params) {
    const merchantId = ctx.credential.merchantId;
    const [current, previous] = await Promise.all([
      computeShipmentFacts(ctx.store, merchantId, utcRange(params.range, params.timeZone), params.filters),
      params.comparison
        ? computeShipmentFacts(ctx.store, merchantId, utcRange(params.comparison, params.timeZone), params.filters)
        : Promise.resolve(null),
    ]);
    return { facts: current.facts, previousFacts: previous?.facts ?? null, unconverted: current.unconverted, nowMs: ctx.now.getTime() };
  },
  present({ facts, previousFacts, nowMs }, _ctx, pagination) {
    const statusCounts = new Map<ShipmentStatus, number>();
    for (const fact of facts) statusCounts.set(fact.status, (statusCounts.get(fact.status) ?? 0) + 1);

    // Shipments still moving (or stuck) long after leaving the warehouse.
    // Labels without a dispatch scan have not shipped yet and are excluded.
    const delayed = facts
      .filter((fact) => ['in_transit', 'out_for_delivery', 'exception'].includes(fact.status) || (fact.status === 'label_created' && fact.dispatchedAt))
      .map((fact) => ({ fact, since: fact.dispatchedAt ?? fact.labelAt }))
      .filter((entry): entry is { fact: ShipmentFact; since: Date } => Boolean(entry.since) && nowMs - entry.since!.getTime() > DELAY_THRESHOLD_HOURS * 3_600_000)
      .map(({ fact, since }) => ({
        order_reference: fact.orderReference,
        tracking_number: fact.trackingNumber,
        carrier: fact.carrier,
        status: fact.status,
        status_label_ar: shipmentStatusLabel(fact.status),
        days_since_dispatch: Math.floor((nowMs - since.getTime()) / 86_400_000),
      }))
      .sort((a, b) => b.days_since_dispatch - a.days_since_dispatch || a.order_reference.localeCompare(b.order_reference));

    const exceptions = facts
      .filter((fact) => fact.status === 'exception')
      .map((fact) => ({
        order_reference: fact.orderReference,
        tracking_number: fact.trackingNumber,
        carrier: fact.carrier,
        reason: fact.exceptionReason,
      }))
      .sort((a, b) => a.order_reference.localeCompare(b.order_reference));

    const carriers = new Map<string, ShipmentFact[]>();
    for (const fact of facts) carriers.set(fact.carrier ?? 'unknown', [...(carriers.get(fact.carrier ?? 'unknown') ?? []), fact]);

    const overall = successRate(facts);
    const previousRate = previousFacts ? successRate(previousFacts) : null;

    return {
      shipments_total: {
        value: facts.length,
        ...(previousFacts ? { comparison: change(facts.length, previousFacts.length) } : {}),
      },
      shipments_by_status: Array.from(statusCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([code, count]) => ({ code, label_ar: shipmentStatusLabel(code), count })),
      average_hours_order_to_label: average(facts.map((fact) => hoursBetween(fact.placedAt, fact.labelAt))),
      average_hours_order_to_dispatch: average(facts.map((fact) => hoursBetween(fact.placedAt, fact.dispatchedAt))),
      average_hours_dispatch_to_delivery: average(facts.map((fact) => hoursBetween(fact.dispatchedAt, fact.deliveredAt))),
      delivery_success_rate: {
        ...overall,
        ...(previousRate ? { comparison: { previous: previousRate.percent } } : {}),
      },
      delayed_shipments: { threshold_days: DELAY_THRESHOLD_HOURS / 24, total: delayed.length, ...paginate(delayed, pagination) },
      delivery_exceptions: { total: exceptions.length, ...paginate(exceptions, pagination) },
      carrier_performance: Array.from(carriers.entries())
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([code, list]) => ({
          carrier: code,
          label_ar: carrierLabel(code as CarrierCode) ?? 'غير معروف',
          shipments: list.length,
          carrier_tracked: list.filter((fact) => fact.carrierTracked).length,
          exceptions: list.filter((fact) => fact.status === 'exception').length,
          delivery_success_rate: successRate(list),
          average_hours_dispatch_to_delivery: average(list.map((fact) => hoursBetween(fact.dispatchedAt, fact.deliveredAt))),
        })),
      coverage: {
        with_carrier_tracking: facts.filter((fact) => fact.carrierTracked).length,
        with_warehouse_dispatch_scan: facts.filter((fact) => fact.dispatchedAt).length,
      },
    };
  },
  definitions: {
    shipments_total: 'Orders placed in the range that have a shipping label, a warehouse dispatch scan or a local-courier shipment.',
    shipments_by_status: 'Carrier status (AJEX/SMSA live tracking or local courier) when available; otherwise derived from the order status.',
    average_hours_order_to_label: 'Order placement → Salla shipping label created.',
    average_hours_order_to_dispatch: 'Order placement → outgoing warehouse scan.',
    average_hours_dispatch_to_delivery: 'Outgoing warehouse scan → carrier-confirmed delivery. Only shipments with both events count (see sample_size).',
    delivery_success_rate: 'delivered ÷ (delivered + returned to sender), over shipments with carrier tracking only.',
    delayed_shipments: 'As of now: dispatched shipments not yet delivered more than threshold_days after dispatch (or label creation when no scan exists).',
    delivery_exceptions: 'Carrier-reported failed delivery/pickup, held shipments or address problems.',
  },
});

// ----------------------------------------------------------- customer analytics

async function computeCustomerStats(store: HermesStore, merchantId: string, range: UtcRange, filters: ReportFilters) {
  const [{ orders, unconverted }, firstOrders] = await Promise.all([
    loadOrders(store, merchantId, range, filters),
    store.loadFirstOrderDates(merchantId, range),
  ]);
  const firstByCustomer = new Map(firstOrders.map((row) => [row.customerId, row.firstPlacedAt]));
  const sales = orders.filter(isSale);

  const customers = new Map<string, { name: string | null; city: string | null; orders: number; revenue: Decimal }>();
  let unidentified = 0;
  for (const row of sales) {
    if (!row.customerId) {
      unidentified += 1;
      continue;
    }
    const entry = customers.get(row.customerId) ?? { name: row.customerName, city: row.customerCity, orders: 0, revenue: ZERO };
    entry.orders += 1;
    entry.revenue = entry.revenue.plus(moneyFor(row).total);
    customers.set(row.customerId, entry);
  }

  let newCustomers = 0;
  for (const customerId of customers.keys()) {
    const first = firstByCustomer.get(customerId);
    if (first && first >= range.start && first < range.end) newCustomers += 1;
  }
  const repeat = Array.from(customers.values()).filter((entry) => entry.orders >= 2).length;

  const cities = new Map<string, { customers: Set<string>; orders: number; revenue: Decimal }>();
  for (const row of sales) {
    const city = row.customerCity?.trim() || 'غير محدد';
    const entry = cities.get(city) ?? { customers: new Set<string>(), orders: 0, revenue: ZERO };
    if (row.customerId) entry.customers.add(row.customerId);
    entry.orders += 1;
    entry.revenue = entry.revenue.plus(moneyFor(row).total);
    cities.set(city, entry);
  }

  return {
    totalCustomers: customers.size,
    newCustomers,
    returningCustomers: customers.size - newCustomers,
    repeatCustomers: repeat,
    unidentified,
    customers,
    cities,
    unconverted,
  };
}

export const customerReport = runReport({
  action: 'reports.customers',
  async compute(ctx, params) {
    const merchantId = ctx.credential.merchantId;
    const [current, previous] = await Promise.all([
      computeCustomerStats(ctx.store, merchantId, utcRange(params.range, params.timeZone), params.filters),
      params.comparison
        ? computeCustomerStats(ctx.store, merchantId, utcRange(params.comparison, params.timeZone), params.filters)
        : Promise.resolve(null),
    ]);
    return { current, previous, unconverted: current.unconverted };
  },
  present({ current, previous }, ctx, pagination) {
    const metric = (value: number, prev?: number) => ({ value, ...(previous && prev !== undefined ? { comparison: change(value, prev) } : {}) });
    const repeatRate = ratio(current.repeatCustomers, current.totalCustomers);
    const cities = Array.from(current.cities.entries())
      .map(([city, entry]) => ({ city, customers: entry.customers.size, orders: entry.orders, revenue: money(entry.revenue) }))
      .sort((a, b) => b.orders - a.orders || a.city.localeCompare(b.city));

    const includeTop = canSeeFullPii(ctx.credential.scopes);
    const top = Array.from(current.customers.entries())
      .sort((a, b) => b[1].revenue.comparedTo(a[1].revenue) || b[1].orders - a[1].orders || a[0].localeCompare(b[0]))
      .slice(0, TOP_CUSTOMERS)
      .map(([customerId, entry]) => ({
        customer_ref: customerRef(ctx.credential.merchantId, customerId),
        name: entry.name,
        city: entry.city,
        orders: entry.orders,
        revenue: money(entry.revenue),
      }));

    return {
      customers_total: metric(current.totalCustomers, previous?.totalCustomers),
      new_customers: metric(current.newCustomers, previous?.newCustomers),
      returning_customers: metric(current.returningCustomers, previous?.returningCustomers),
      repeat_purchase_rate: {
        percent: repeatRate,
        customers_with_2_plus_orders: current.repeatCustomers,
        ...(previous ? { comparison: { previous: ratio(previous.repeatCustomers, previous.totalCustomers) } } : {}),
      },
      orders_without_customer_id: current.unidentified,
      customers_by_city: paginate(cities, pagination),
      top_customers: includeTop
        ? { items: top }
        : { items: null, omitted_reason: `requires scope ${HERMES_SCOPES.MANAGER_PII}` },
      customer_lifetime_value: {
        available: false,
        reason:
          'Not reported: order history only starts in September 2025 and product costs are not stored, so lifetime value cannot be calculated reliably.',
      },
    };
  },
  definitions: {
    customers_total: 'Distinct Salla customer ids with at least one sale order (see sales definitions) placed in the range.',
    new_customers: 'Customers whose first-ever order with the store (any status, since data begins) falls inside the range.',
    returning_customers: 'customers_total − new_customers.',
    repeat_purchase_rate: 'Share of customers with two or more sale orders inside the range.',
    customers_by_city: 'City from the order\'s customer record; revenue in SAR.',
    top_customers: `Top ${TOP_CUSTOMERS} customers by revenue in the range. Requires ${HERMES_SCOPES.MANAGER_PII}.`,
  },
});

// ---------------------------------------------------------- product performance

async function computeProductStats(store: HermesStore, merchantId: string, range: UtcRange, filters: ReportFilters) {
  const [{ orders, unconverted }, items, returnItems] = await Promise.all([
    loadOrders(store, merchantId, range, filters),
    store.loadReportItems(merchantId, range),
    store.loadReportReturnItems(merchantId, range),
  ]);
  const sales = new Map(orders.filter(isSale).map((row) => [row.id, row]));
  const ordersWithItems = new Set<string>();

  interface ProductEntry {
    productId: string | null;
    name: string | null;
    units: number;
    orders: Set<string>;
    revenue: Decimal;
    variants: Map<string, { sku: string; name: string | null; units: number; revenue: Decimal }>;
  }
  const products = new Map<string, ProductEntry>();
  for (const item of items) {
    const order = sales.get(item.orderRowId);
    if (!order) continue;
    ordersWithItems.add(item.orderRowId);
    const key = item.productId ?? item.sku ?? item.name ?? 'unknown';
    const entry = products.get(key) ?? { productId: item.productId, name: item.name, units: 0, orders: new Set(), revenue: ZERO, variants: new Map() };
    const revenue = toSar(item.totalAmount, moneyFor(order).rate) ?? ZERO;
    entry.units += item.quantity;
    entry.orders.add(item.orderRowId);
    entry.revenue = entry.revenue.plus(revenue);
    if (item.sku) {
      const variant = entry.variants.get(item.sku) ?? { sku: item.sku, name: item.name, units: 0, revenue: ZERO };
      variant.units += item.quantity;
      variant.revenue = variant.revenue.plus(revenue);
      entry.variants.set(item.sku, variant);
    }
    products.set(key, entry);
  }

  const returned = new Map<string, { name: string; returned: number; exchanged: number; reasons: Map<string, number> }>();
  for (const item of returnItems) {
    if (item.status === 'cancelled' || item.status === 'rejected') continue;
    const entry = returned.get(item.productId) ?? { name: item.productName, returned: 0, exchanged: 0, reasons: new Map() };
    if (item.type === 'exchange') entry.exchanged += item.quantity;
    else entry.returned += item.quantity;
    entry.reasons.set(item.reason, (entry.reasons.get(item.reason) ?? 0) + item.quantity);
    returned.set(item.productId, entry);
  }

  return { products, returned, saleOrders: sales.size, ordersWithItems: ordersWithItems.size, unconverted };
}

export const productReport = runReport({
  action: 'reports.products',
  async compute(ctx, params) {
    const merchantId = ctx.credential.merchantId;
    const [current, previous] = await Promise.all([
      computeProductStats(ctx.store, merchantId, utcRange(params.range, params.timeZone), params.filters),
      params.comparison
        ? computeProductStats(ctx.store, merchantId, utcRange(params.comparison, params.timeZone), params.filters)
        : Promise.resolve(null),
    ]);
    return { current, previous, unconverted: current.unconverted };
  },
  present({ current, previous }, _ctx, pagination) {
    const rows = Array.from(current.products.entries()).map(([key, entry]) => {
      const prev = previous?.products.get(key);
      const unitsReturned = entry.productId ? current.returned.get(entry.productId) : undefined;
      return {
        product_id: entry.productId,
        name: entry.name,
        units_sold: entry.units,
        orders: entry.orders.size,
        revenue: money(entry.revenue),
        ...(previous ? { comparison: { units_sold: change(entry.units, prev?.units ?? 0), revenue: change(entry.revenue, prev?.revenue ?? ZERO) } } : {}),
        units_returned: unitsReturned?.returned ?? 0,
        units_exchanged: unitsReturned?.exchanged ?? 0,
        variants: Array.from(entry.variants.values())
          .sort((a, b) => b.units - a.units || a.sku.localeCompare(b.sku))
          .map((variant) => ({ sku: variant.sku, units_sold: variant.units, revenue: money(variant.revenue) })),
        _revenue: entry.revenue,
      };
    });
    const strip = ({ _revenue, ...rest }: (typeof rows)[number]) => {
      void _revenue;
      return rest;
    };
    const byUnits = [...rows].sort((a, b) => b.units_sold - a.units_sold || b._revenue.comparedTo(a._revenue) || String(a.product_id).localeCompare(String(b.product_id)));
    const byRevenue = [...rows].sort((a, b) => b._revenue.comparedTo(a._revenue) || b.units_sold - a.units_sold || String(a.product_id).localeCompare(String(b.product_id)));
    const returns = Array.from(current.returned.entries())
      .map(([productId, entry]) => {
        const sold = rows.find((row) => row.product_id === productId)?.units_sold ?? 0;
        return {
          product_id: productId,
          name: entry.name,
          units_returned: entry.returned,
          units_exchanged: entry.exchanged,
          units_sold_in_range: sold,
          return_rate_percent: ratio(entry.returned + entry.exchanged, sold),
          reasons: Array.from(entry.reasons.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([code, units]) => ({ code, label_ar: returnReasonLabel(code), units })),
        };
      })
      .sort((a, b) => b.units_returned + b.units_exchanged - (a.units_returned + a.units_exchanged) || a.product_id.localeCompare(b.product_id));

    return {
      products_sold: rows.length,
      units_sold: rows.reduce((total, row) => total + row.units_sold, 0),
      best_sellers_by_units: paginate(byUnits.map(strip), pagination),
      revenue_by_product: paginate(byRevenue.map(strip), pagination),
      low_performers: [...byUnits].reverse().slice(0, LOW_PERFORMERS).map(strip),
      returns_by_product: paginate(returns, pagination),
      revenue_by_category: { available: false, reason: 'Product categories are not stored locally.' },
      inventory: { available: false, reason: 'Stock levels are read live from Salla and not stored, so inventory metrics are not reported.' },
      coverage: { sale_orders: current.saleOrders, sale_orders_with_items: current.ordersWithItems },
    };
  },
  definitions: {
    units_sold: 'Quantities of stored order lines (SallaOrderItem) on sale orders placed in the range.',
    revenue: 'Line totals as reported by Salla (VAT included, before order-level discounts), converted to SAR.',
    variants: 'Per SKU; each Salla variant has its own SKU.',
    low_performers: `The ${LOW_PERFORMERS} products with the fewest units among products that sold at least once in the range (products with zero sales are not visible here).`,
    returns_by_product: 'Units on return/exchange requests created in the range (cancelled/rejected excluded), with the customer-selected reasons. return_rate_percent compares them with units sold in the same range, so it is approximate.',
  },
});

// ---------------------------------------------------------------- daily trend

async function computeDailySeries(store: HermesStore, merchantId: string, range: DateRange, timeZone: string, filters: ReportFilters) {
  const window = utcRange(range, timeZone);
  const [{ orders, unconverted }, restored, labels] = await Promise.all([
    loadOrders(store, merchantId, window, filters),
    store.loadRestoredOrders(merchantId, window),
    store.loadLabelCreationTimes(merchantId, window),
  ]);
  const days = new Map(eachDate(range.from, range.to).map((date) => [date, { orders: 0, revenue: ZERO, refunds: ZERO, shipments: 0 }]));
  for (const row of orders.filter(isSale)) {
    const day = days.get(localDateKey(row.placedAt, timeZone));
    if (!day) continue;
    const amounts = moneyFor(row);
    day.orders += 1;
    day.revenue = day.revenue.plus(amounts.total);
    if (!RETURN_STAGES.includes(orderStage(row.statusSlug))) day.refunds = day.refunds.plus(amounts.partialRefund);
  }
  for (const row of restored.filter((entry) => matchesFilters(entry, filters))) {
    const day = days.get(localDateKey(row.restoredAt, timeZone));
    if (day) day.refunds = day.refunds.plus(moneyFor(row).total);
  }
  for (const createdAt of labels) {
    const day = days.get(localDateKey(createdAt, timeZone));
    if (day) day.shipments += 1;
  }
  return { days, unconverted };
}

export const dailyTrendReport = runReport({
  action: 'reports.daily_trend',
  async compute(ctx, params) {
    const merchantId = ctx.credential.merchantId;
    const [current, previous] = await Promise.all([
      computeDailySeries(ctx.store, merchantId, params.range, params.timeZone, params.filters),
      params.comparison
        ? computeDailySeries(ctx.store, merchantId, params.comparison, params.timeZone, params.filters)
        : Promise.resolve(null),
    ]);
    return { current, previous, unconverted: current.unconverted };
  },
  present({ current, previous }) {
    const previousDays = previous ? Array.from(previous.days.entries()) : [];
    return {
      series: Array.from(current.days.entries()).map(([date, day], index) => {
        const prev = previousDays[index];
        return {
          date,
          orders: day.orders,
          revenue: money(day.revenue),
          refunds: money(day.refunds),
          shipments: day.shipments,
          ...(prev
            ? {
                comparison: {
                  date: prev[0],
                  orders: prev[1].orders,
                  revenue: money(prev[1].revenue),
                  refunds: money(prev[1].refunds),
                  shipments: prev[1].shipments,
                },
              }
            : {}),
        };
      }),
    };
  },
  definitions: {
    date: 'Local calendar date in the requested time zone.',
    orders: 'Sale orders placed that day (excludes awaiting payment, cancelled, deleted).',
    revenue: 'Order totals of those orders in SAR.',
    refunds: 'Full refunds dated by the order\'s first "restored" status, plus partial refunds dated by order placement.',
    shipments: 'Shipping labels created that day (Salla shipments and local-courier shipments). Filters do not apply.',
    comparison: 'Aligned by position: day N of the range against day N of the comparison range.',
  },
});

export const REPORT_PARAMS = reportParamNames();
