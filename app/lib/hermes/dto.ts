import type { AjexLiveStatus } from '@/types/ajex';
import type { SmsaLiveStatus } from '@/types/smsa';
import { returnReasonLabel } from '@/lib/returns/reasons';
import { buildTrackingUrl } from '@/lib/tracking-url';
import { extractSallaOrderFacts } from '@/app/lib/salla-order-facts';
import { formatMoney, toDecimal } from './money';
import { presentEmail, presentPhone } from './pii';
import {
  ajexStatusView,
  carrierLabel,
  derivePaymentState,
  deriveFulfillmentState,
  localShipmentStatus,
  normalizeCarrier,
  orderStage,
  orderStageLabel,
  presentOrderStatus,
  returnStatusLabel,
  returnTypeLabel,
  shipmentStatusFromOrderStatus,
  shipmentStatusLabel,
  smsaStatusView,
  type CarrierCode,
  type CarrierStatusView,
  type ShipmentStatus,
} from './statuses';
import { parseLooseDate } from './time';
import type {
  CarrierEventRow,
  LocalShipmentRow,
  OrderDetailBundle,
  OrderDetailRow,
  OrderItemRow,
  OrderSummaryRow,
  ReturnRow,
  SallaShipmentRow,
  ScanRow,
  StatusEventRow,
} from './store';

/**
 * Response DTOs. Every field is listed explicitly; values read from the Salla
 * payload come from named paths only, so new upstream fields (card data,
 * gateway payloads, cost prices, internal notes) can never leak through.
 */

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown, max = 200): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};
const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

export function orderReference(order: Pick<OrderSummaryRow, 'referenceId' | 'orderNumber' | 'orderId'>): string {
  return order.referenceId || order.orderNumber || order.orderId;
}

export interface PresentOptions {
  fullPii: boolean;
  customerRefFor: (customerId: string | null) => string | null;
}

// --------------------------------------------------------------- order summary

export function toOrderSummary(order: OrderSummaryRow, options: PresentOptions) {
  const carrier = normalizeCarrier(order.fulfillmentCompany);
  return {
    order_reference: orderReference(order),
    created_at: iso(order.placedAt),
    status: presentOrderStatus(order.statusSlug, order.statusName),
    payment: {
      method: order.paymentMethod,
      ...derivePaymentState({ statusSlug: order.statusSlug, paymentMethod: order.paymentMethod }),
    },
    total: { amount: formatMoney(order.totalAmount), currency: order.currency },
    customer: {
      customer_ref: options.customerRefFor(order.customerId),
      name: order.customerName,
      phone: presentPhone(order.customerMobile, options.fullPii),
    },
    shipping_city: order.customerCity,
    carrier: carrier ? { code: carrier, label_ar: carrierLabel(carrier) } : null,
    tracking_number: order.trackingNumber,
  };
}

// ------------------------------------------------------------------ shipments

export interface ShipmentView {
  shipment_reference: string;
  order_reference: string;
  direction: 'outbound' | 'return';
  carrier: { code: CarrierCode | null; label_ar: string | null; name: string | null };
  tracking_number: string;
  tracking_url: string | null;
  status: { code: ShipmentStatus; label_ar: string; source: 'carrier' | 'local_courier' | 'salla' | 'order_status' };
  carrier_status: { code: string | null; text: string | null } | null;
  label_created_at: string | null;
  shipped_at: string | null;
  estimated_delivery_at: string | null;
  delivered_at: string | null;
  last_update_at: string | null;
  exception_reason: string | null;
}

interface ShipmentDraft {
  trackingNumber: string;
  direction: 'outbound' | 'return';
  courierName: string | null;
  trackingLink: string | null;
  sallaStatus: string | null;
  createdAt: Date | null;
  estimatedDeliveryAt: Date | null;
  deliveredAt: Date | null;
  updatedAt: Date | null;
  local: LocalShipmentRow | null;
}

function safeTrackingUrl(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function collectShipmentDrafts(
  order: OrderDetailRow,
  sallaShipments: SallaShipmentRow[],
  localShipments: LocalShipmentRow[]
): ShipmentDraft[] {
  const drafts = new Map<string, ShipmentDraft>();
  const merge = (draft: Omit<Partial<ShipmentDraft>, 'trackingNumber'> & { trackingNumber: string | null }) => {
    const tracking = draft.trackingNumber?.trim();
    if (!tracking) return;
    const existing = drafts.get(tracking);
    if (!existing) {
      drafts.set(tracking, {
        trackingNumber: tracking,
        direction: draft.direction ?? 'outbound',
        courierName: draft.courierName ?? null,
        trackingLink: draft.trackingLink ?? null,
        sallaStatus: draft.sallaStatus ?? null,
        createdAt: draft.createdAt ?? null,
        estimatedDeliveryAt: draft.estimatedDeliveryAt ?? null,
        deliveredAt: draft.deliveredAt ?? null,
        updatedAt: draft.updatedAt ?? null,
        local: draft.local ?? null,
      });
      return;
    }
    for (const key of Object.keys(draft) as (keyof ShipmentDraft)[]) {
      if (existing[key] === null && draft[key] != null) (existing as unknown as AnyRecord)[key] = draft[key];
    }
  };

  for (const local of localShipments) {
    merge({ trackingNumber: local.trackingNumber, courierName: 'مندوب توصيل', createdAt: local.createdAt, deliveredAt: local.deliveredAt, updatedAt: local.updatedAt, local });
  }

  const raw = asRecord(order.rawOrder);
  for (const entry of asArray(raw?.shipments)) {
    const shipment = asRecord(entry);
    if (!shipment) continue;
    merge({
      trackingNumber: asText(shipment.tracking_number) ?? asText(shipment.shipping_number),
      direction: asText(shipment.type) === 'return' ? 'return' : 'outbound',
      courierName: asText(shipment.courier_name),
      trackingLink: asText(shipment.tracking_link, 500),
      sallaStatus: asText(shipment.status),
      createdAt: parseLooseDate(shipment.created_at),
      estimatedDeliveryAt: parseLooseDate(shipment.estimated_delivery_at),
      deliveredAt: parseLooseDate(shipment.actual_delivered_at),
    });
  }

  for (const shipment of sallaShipments) {
    merge({
      trackingNumber: shipment.trackingNumber,
      courierName: shipment.courierName,
      trackingLink: shipment.trackingLink,
      sallaStatus: shipment.status,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
    });
  }

  const shippingShipment = asRecord(asRecord(raw?.shipping)?.shipment);
  merge({
    trackingNumber: order.trackingNumber,
    courierName: order.fulfillmentCompany,
    trackingLink: asText(shippingShipment?.tracking_link, 500),
    sallaStatus: order.statusSlug,
  });

  return Array.from(drafts.values());
}

function liveView(scan: ScanRow | undefined, carrier: CarrierCode | null): CarrierStatusView | null {
  if (!scan) return null;
  const ajex = ajexStatusView(scan.ajexLiveStatus as AjexLiveStatus | null);
  const smsa = smsaStatusView(scan.smsaLiveStatus as SmsaLiveStatus | null);
  const company = normalizeCarrier(scan.company) ?? carrier;
  return company === 'ajex' ? ajex ?? smsa : smsa ?? ajex;
}

function rawShipmentStatus(status: string | null): ShipmentStatus {
  const value = status?.trim().toLowerCase();
  if (value === 'created' || value === 'pending') return 'label_created';
  return shipmentStatusFromOrderStatus(value);
}

export function buildShipmentViews(
  order: OrderDetailRow,
  sallaShipments: SallaShipmentRow[],
  localShipments: LocalShipmentRow[],
  scans: ScanRow[]
): ShipmentView[] {
  const scanByTracking = new Map(scans.map((scan) => [scan.trackingNumber, scan]));
  const reference = orderReference(order);

  return collectShipmentDrafts(order, sallaShipments, localShipments).map((draft) => {
    const carrier = draft.local ? 'local_courier' : normalizeCarrier(draft.courierName, order.fulfillmentCompany);
    const scan = scanByTracking.get(draft.trackingNumber);
    const live = liveView(scan, carrier);

    let status: ShipmentStatus;
    let source: ShipmentView['status']['source'];
    if (draft.local) {
      status = draft.local.assignmentStatus === 'failed' ? 'exception' : localShipmentStatus(draft.local.status);
      source = 'local_courier';
    } else if (live && live.status !== 'unknown') {
      status = live.status;
      source = 'carrier';
    } else if (draft.sallaStatus && draft.sallaStatus !== order.statusSlug) {
      status = rawShipmentStatus(draft.sallaStatus);
      source = 'salla';
    } else {
      status = shipmentStatusFromOrderStatus(order.statusSlug);
      source = 'order_status';
    }

    const liveAt = parseLooseDate(live?.event_at);
    const deliveredAt =
      draft.deliveredAt ??
      (status === 'delivered' && source === 'carrier' ? scan?.ajexLiveStatusEventAt ?? liveAt : null);
    const updates = [draft.updatedAt, scan?.ajexLiveStatusUpdatedAt ?? null, scan?.smsaLiveStatusUpdatedAt ?? null, liveAt]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime());

    const trackingUrl =
      safeTrackingUrl(draft.trackingLink) ??
      (() => {
        const built = buildTrackingUrl(draft.trackingNumber, carrier ?? draft.courierName ?? undefined);
        return built && built.type !== 'generic' ? built.url : null;
      })();

    return {
      shipment_reference: draft.trackingNumber,
      order_reference: reference,
      direction: draft.direction,
      carrier: { code: carrier, label_ar: carrierLabel(carrier), name: draft.courierName },
      tracking_number: draft.trackingNumber,
      tracking_url: trackingUrl,
      status: { code: status, label_ar: shipmentStatusLabel(status), source },
      carrier_status: live ? { code: live.carrier_status_code, text: live.carrier_status_text } : null,
      label_created_at: iso(draft.createdAt),
      shipped_at: iso(scan?.handoverScannedAt ?? scan?.scannedAt ?? null),
      estimated_delivery_at: iso(draft.estimatedDeliveryAt),
      delivered_at: iso(deliveredAt),
      last_update_at: iso(updates[0] ?? null),
      exception_reason: status === 'exception' ? live?.exception_reason ?? null : null,
    };
  });
}

export function buildShipmentEvents(
  shipment: ShipmentView,
  scan: ScanRow | undefined,
  carrierEvents: CarrierEventRow[],
  local: LocalShipmentRow | undefined
) {
  const events: { at: string | null; at_local: string | null; code: string | null; description: string | null; city: string | null; source: string }[] = [];

  if (shipment.label_created_at) {
    events.push({ at: shipment.label_created_at, at_local: null, code: 'label_created', description: 'تم إنشاء البوليصة', city: null, source: 'store' });
  }
  if (scan?.scannedAt) {
    events.push({ at: iso(scan.scannedAt), at_local: null, code: 'warehouse_dispatch', description: 'خرجت الشحنة من المستودع', city: null, source: 'warehouse' });
  }
  for (const event of carrierEvents) {
    const at = parseLooseDate(event.scanDateTime);
    events.push({
      at: iso(at),
      at_local: at ? null : asText(event.scanDateTime, 40),
      code: asText(event.scanType, 20),
      description: asText(event.description, 200),
      city: asText(event.city, 80),
      source: 'carrier',
    });
  }
  const ajex = ajexStatusView(scan?.ajexLiveStatus as AjexLiveStatus | null);
  if (ajex && carrierEvents.length === 0) {
    events.push({
      at: iso(scan?.ajexLiveStatusEventAt ?? parseLooseDate(ajex.event_at)),
      at_local: null,
      code: ajex.carrier_status_code,
      description: ajex.carrier_status_text,
      city: ajex.location_city,
      source: 'carrier',
    });
  }
  if (local?.deliveredAt) {
    events.push({ at: iso(local.deliveredAt), at_local: null, code: 'delivered', description: 'تم التسليم', city: local.shippingCity, source: 'local_courier' });
  }
  if (local?.failedAt) {
    events.push({ at: iso(local.failedAt), at_local: null, code: 'failed', description: 'تعذر التسليم', city: local.shippingCity, source: 'local_courier' });
  }

  return events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

// --------------------------------------------------------------- order detail

function presentItems(items: OrderItemRow[], rawOrder: unknown) {
  const rawItems = new Map<string, AnyRecord>();
  for (const entry of asArray(asRecord(rawOrder)?.items)) {
    const record = asRecord(entry);
    const id = asText(record?.id);
    if (record && id) rawItems.set(id, record);
  }

  const fromRows = items.map((item) => ({ item, raw: rawItems.get(item.itemId) ?? null }));
  // Orders that predate item storage fall back to the payload's items.
  const source =
    fromRows.length > 0
      ? fromRows
      : Array.from(rawItems.entries()).map(([id, raw]) => {
          const amounts = asRecord(raw.amounts);
          const withoutTax = toDecimal(asRecord(amounts?.price_without_tax)?.amount as number);
          const tax = toDecimal(asRecord(asRecord(amounts?.tax)?.amount)?.amount as number);
          return {
            item: {
              itemId: id,
              productId: asText(asRecord(raw.product)?.id),
              sku: asText(raw.sku),
              name: asText(raw.name),
              quantity: Number(raw.quantity) || 0,
              priceAmount: withoutTax && tax ? withoutTax.plus(tax) : null,
              totalAmount: toDecimal(asRecord(amounts?.total)?.amount as number),
              currency: asText(raw.currency),
            } satisfies OrderItemRow,
            raw,
          };
        });

  return source.map(({ item, raw }) => ({
    name: item.name,
    sku: item.sku,
    product_id: item.productId,
    quantity: item.quantity,
    options: asArray(raw?.options)
      .map((entry) => {
        const option = asRecord(entry);
        const value = asRecord(option?.value);
        const name = asText(option?.name, 80);
        const text = asText(value?.name, 120) ?? asText(option?.value, 120);
        return name && text ? { name, value: text } : null;
      })
      .filter(Boolean),
    unit_price: formatMoney(item.priceAmount),
    line_total: formatMoney(item.totalAmount),
    customer_note: asText(raw?.notes, 300),
  }));
}

function presentAmounts(order: OrderDetailRow) {
  const raw = asRecord(order.rawOrder);
  const amounts = asRecord(raw?.amounts);
  const facts = extractSallaOrderFacts(order.rawOrder);
  return {
    currency: order.currency,
    subtotal: formatMoney(order.subtotalAmount),
    discount_total: formatMoney(facts.discountTotal),
    discounts: asArray(amounts?.discounts)
      .map((entry) => {
        const discount = asRecord(entry);
        if (!discount) return null;
        return {
          code: asText(discount.code, 60),
          title: asText(discount.title, 120),
          amount: formatMoney(asText(discount.discount, 30)),
        };
      })
      .filter(Boolean),
    shipping: formatMoney(order.shippingAmount),
    cash_on_delivery_fee: formatMoney(asRecord(amounts?.cash_on_delivery)?.amount as number),
    tax: formatMoney(order.taxAmount),
    total: formatMoney(order.totalAmount),
  };
}

function presentAddress(order: OrderDetailRow, fullPii: boolean) {
  const raw = asRecord(order.rawOrder);
  const shipTo = asRecord(asRecord(asArray(raw?.shipments)[0])?.ship_to);
  const address = asRecord(asRecord(raw?.shipping)?.address);
  const receiver = asRecord(asRecord(raw?.shipping)?.receiver);
  const base = {
    country: asText(shipTo?.country) ?? asText(address?.country) ?? order.customerCountry,
    region: asText(asRecord(shipTo?.region)?.name),
    city: asText(shipTo?.city) ?? asText(address?.city) ?? order.customerCity,
    district: asText(asRecord(shipTo?.district)?.name) ?? asText(address?.block),
  };
  const receiverPhone = asText(receiver?.phone, 40);
  return {
    ...base,
    receiver_name: asText(receiver?.name, 120),
    receiver_phone: presentPhone(receiverPhone, fullPii),
    // Street-level detail and the national short address are manager/PII only.
    ...(fullPii
      ? {
          address_line: asText(shipTo?.address_line, 300) ?? asText(address?.shipping_address, 300),
          street_number: asText(shipTo?.street_number) ?? asText(address?.street_number),
          building_number: asText(shipTo?.building_number) ?? asText(address?.building_number),
          postal_code: asText(shipTo?.postal_code) ?? asText(address?.postal_code),
          short_address: asText(shipTo?.short_address) ?? asText(address?.short_address),
        }
      : {}),
  };
}

export function presentTimeline(events: StatusEventRow[]) {
  const timeline: { status: string; label_ar: string; salla_status: string | null; at: string }[] = [];
  for (const event of events) {
    const slug = event.status?.trim().toLowerCase() ?? null;
    // Webhooks occasionally carry an object instead of a slug; skip those.
    if (!slug || slug.startsWith('[object')) continue;
    if (timeline.length > 0 && timeline[timeline.length - 1].salla_status === slug) continue;
    const stage = orderStage(slug);
    timeline.push({ status: stage, label_ar: orderStageLabel(stage), salla_status: slug, at: event.receivedAt.toISOString() });
  }
  return timeline;
}

export function presentReturn(row: ReturnRow) {
  return {
    order_reference: row.orderNumber,
    type: row.type,
    type_label_ar: returnTypeLabel(row.type),
    status: row.status,
    status_label_ar: returnStatusLabel(row.status),
    // Predefined reason code only; the customer's free-text details are not returned.
    reason: row.reason,
    reason_label_ar: returnReasonLabel(row.reason),
    created_at: iso(row.createdAt),
    updated_at: iso(row.updatedAt),
    refund_amount: formatMoney(row.totalRefundAmount),
    currency: row.currency,
    coupon_issued: row.couponIssued,
    return_tracking_number: row.returnTrackingNumber,
    exchange_order_reference: row.exchangeOrderNumber,
    items: row.items.map((item) => ({
      product_name: item.productName,
      sku: item.productSku,
      variant: item.variantName,
      quantity: item.quantity,
    })),
  };
}

export function toOrderDetail(bundle: OrderDetailBundle, options: PresentOptions) {
  const { order } = bundle;
  const facts = extractSallaOrderFacts(order.rawOrder);
  const stage = orderStage(order.statusSlug);
  const shipments = buildShipmentViews(
    order,
    bundle.sallaShipment ? [bundle.sallaShipment] : [],
    bundle.localShipments,
    bundle.scans
  );

  return {
    order_reference: orderReference(order),
    created_at: iso(order.placedAt),
    last_updated_at: iso(order.updatedAt),
    status: presentOrderStatus(order.statusSlug, order.statusName),
    payment: {
      method: order.paymentMethod,
      ...derivePaymentState({
        statusSlug: order.statusSlug,
        paymentMethod: order.paymentMethod,
        isPendingPayment: facts.isPendingPayment,
      }),
    },
    fulfillment: {
      ...deriveFulfillmentState(order.statusSlug),
      salla_fulfillment_status: order.fulfillmentStatus,
    },
    customer: {
      customer_ref: options.customerRefFor(order.customerId),
      name: order.customerName,
      phone: presentPhone(order.customerMobile, options.fullPii),
      email: presentEmail(order.customerEmail, options.fullPii),
    },
    shipping_address: presentAddress(order, options.fullPii),
    items: presentItems(bundle.items, order.rawOrder),
    amounts: presentAmounts(order),
    shipments,
    timeline: presentTimeline(bundle.events),
    returns: bundle.returns.map(presentReturn),
    refunds: {
      fully_refunded: stage === 'returned',
      refund_in_progress: stage === 'return_in_progress',
      partially_refunded_items: facts.refundedItemsCount,
      partially_refunded_amount: formatMoney(facts.refundedItemsTotal),
      currency: order.currency,
    },
    flags: {
      high_priority: bundle.flags.highPriority,
      do_not_ship: bundle.flags.doNotShip,
      gift: bundle.flags.gift,
    },
    // Staff notes (assignment, return review, delivery and flag notes) are
    // internal and never returned. Salla's order-level `notes` is excluded too:
    // it is not documented as customer-authored. Item notes above are the
    // customer's own text from products with notes enabled.
  };
}
