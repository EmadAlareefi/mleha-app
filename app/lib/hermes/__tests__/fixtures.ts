import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { extractSallaOrderFacts } from '@/app/lib/salla-order-facts';
import { generateApiKey } from '../credentials';
import type {
  AuditRecord,
  CarrierEventRow,
  CredentialRecord,
  HermesStore,
  LocalShipmentRow,
  OrderDetailRow,
  OrderItemRow,
  ReportOrderRow,
  ReturnRow,
  SallaShipmentRow,
  ScanRow,
  UtcRange,
} from '../store';

/**
 * Anonymised fixtures and an in-memory HermesStore. Every value here is
 * invented; none is copied from production. Sentinel strings (SECRET_*) are
 * planted in fields that must never reach a response.
 */

export const TEST_PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';
export const MERCHANT_A = '1000000001';
export const MERCHANT_B = '2000000002';

export const SENTINELS = {
  cardTransaction: 'SECRET_TXN_REF_4111',
  gatewayPayload: 'SECRET_GATEWAY_PAYLOAD',
  costPrice: 'SECRET_COST_PRICE_77',
  orderNote: 'SECRET_ORDER_LEVEL_NOTE',
  shipperEmail: 'secret-shipper@store.invalid',
  sourceIp: '203.0.113.99',
  returnDetails: 'SECRET_RETURN_REASON_DETAILS',
};

const dec = (value: number | string | null | undefined) =>
  value === null || value === undefined ? null : new Prisma.Decimal(value);

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${++sequence}`;

export type FixtureOrder = OrderDetailRow;

export function makeRawOrder(options: {
  discounts?: string[];
  refundedItems?: number[];
  isPendingPayment?: boolean;
  currency?: string;
  exchangeRate?: Record<string, unknown> | null;
  mobile?: string | number;
  mobileCode?: string;
  shipments?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
} = {}) {
  return {
    currency: options.currency ?? 'SAR',
    notes: SENTINELS.orderNote,
    is_pending_payment: options.isPendingPayment ?? false,
    exchange_rate: options.exchangeRate === undefined ? { rate: '1', base_currency: 'SAR', exchange_currency: options.currency ?? 'SAR' } : options.exchangeRate,
    amounts: {
      discounts: (options.discounts ?? []).map((discount, index) => ({ code: `CODE${index}`, title: 'خصم تجريبي', discount, type: 'normal' })),
      cash_on_delivery: { amount: 0, currency: 'SAR' },
    },
    refunded_items: (options.refundedItems ?? []).map((amount, index) => ({
      id: index + 1,
      name: 'منتج مسترد',
      amounts: { total: { amount, currency: 'SAR' } },
      product: { id: 1, cost_price: SENTINELS.costPrice },
    })),
    customer: { id: 1, mobile: options.mobile ?? 500000001, mobile_code: options.mobileCode ?? '+966', email: 'customer@example.test' },
    payment_methods: [{ amount: '100', provider: 'mada', transaction_reference: SENTINELS.cardTransaction }],
    payment_actions: { refund_action: { gateway_payload: SENTINELS.gatewayPayload } },
    source_details: { ip: SENTINELS.sourceIp },
    shipping: {
      shipper: { email: SENTINELS.shipperEmail },
      receiver: { name: 'مستلم تجريبي', phone: '+966500000009' },
      address: { city: 'الرياض', country: 'السعودية', block: 'حي تجريبي', street_number: '1234', postal_code: '12345', short_address: 'ABCD1234', shipping_address: 'شارع تجريبي 1' },
      shipment: { tracking_link: null },
    },
    shipments: options.shipments ?? [],
    items: options.items ?? [],
  };
}

export function makeOrder(overrides: Partial<FixtureOrder> & { raw?: Parameters<typeof makeRawOrder>[0] } = {}): FixtureOrder {
  const { raw, ...rest } = overrides;
  const n = ++sequence;
  return {
    id: `row_${n}`,
    merchantId: MERCHANT_A,
    orderId: `${900000 + n}`,
    referenceId: `${70000000 + n}`,
    orderNumber: `${70000000 + n}`,
    statusSlug: 'delivered',
    statusName: 'تم التوصيل',
    paymentMethod: 'mada',
    currency: 'SAR',
    totalAmount: dec(115),
    customerId: `${5000 + n}`,
    customerName: 'عميل تجريبي',
    customerMobile: '+966500000001',
    customerEmail: 'customer@example.test',
    customerCity: 'الرياض',
    customerCountry: 'السعودية',
    fulfillmentCompany: 'سمسا',
    trackingNumber: null,
    placedAt: new Date('2026-10-05T10:00:00Z'),
    fulfillmentStatus: 'shipping_ready',
    subtotalAmount: dec(100),
    taxAmount: dec(15),
    shippingAmount: dec(0),
    updatedAt: new Date('2026-10-06T10:00:00Z'),
    rawOrder: makeRawOrder(raw),
    ...rest,
  };
}

export interface FixtureDb {
  credentials: CredentialRecord[];
  audits: AuditRecord[];
  orders: FixtureOrder[];
  items: (OrderItemRow & { merchantId: string; orderId: string })[];
  sallaShipments: (SallaShipmentRow & { merchantId: string })[];
  localShipments: (LocalShipmentRow & { merchantId: string })[];
  returns: (ReturnRow & { merchantId: string })[];
  events: { orderId: string; status: string; receivedAt: Date }[];
  scans: ScanRow[];
  carrierEvents: CarrierEventRow[];
  flags: { merchantId: string; orderId: string; kind: 'highPriority' | 'doNotShip' | 'gift' }[];
}

export function emptyDb(): FixtureDb {
  return { credentials: [], audits: [], orders: [], items: [], sallaShipments: [], localShipments: [], returns: [], events: [], scans: [], carrierEvents: [], flags: [] };
}

export function addCredential(
  db: FixtureDb,
  scopes: string[],
  options: { merchantId?: string; revokedAt?: Date | null; expiresAt?: Date | null } = {}
): { apiKey: string; credential: CredentialRecord } {
  const generated = generateApiKey(TEST_PEPPER);
  const credential: CredentialRecord = {
    id: nextId('cred'),
    keyId: generated.keyId,
    secretHash: generated.secretHash,
    name: 'test credential',
    merchantId: options.merchantId ?? MERCHANT_A,
    scopes,
    revokedAt: options.revokedAt ?? null,
    expiresAt: options.expiresAt ?? null,
    lastUsedAt: null,
  };
  db.credentials.push(credential);
  return { apiKey: generated.apiKey, credential };
}

/** Same LIKE semantics Postgres applies for Prisma's case-insensitive equals. */
function ilike(value: string | null, pattern: string): boolean {
  if (value === null) return false;
  const regex = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${regex}$`, 'is').test(value);
}

const inRange = (date: Date | null, range: UtcRange) => Boolean(date && date >= range.start && date < range.end);

function toReportRow(order: FixtureOrder): ReportOrderRow {
  const facts = extractSallaOrderFacts(order.rawOrder);
  const raw = order.rawOrder as Record<string, unknown>;
  return {
    id: order.id,
    orderId: order.orderId,
    referenceId: order.referenceId,
    orderNumber: order.orderNumber,
    placedAt: order.placedAt!,
    statusSlug: order.statusSlug,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotalAmount: order.subtotalAmount,
    shippingAmount: order.shippingAmount,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    discountTotal: facts.discountTotal,
    refundedItemsTotal: facts.refundedItemsTotal,
    refundedItemsCount: facts.refundedItemsCount,
    isPendingPayment: facts.isPendingPayment,
    exchangeRate: raw.exchange_rate ?? null,
    customerId: order.customerId,
    customerName: order.customerName,
    customerCity: order.customerCity,
    customerCountry: order.customerCountry,
    fulfillmentCompany: order.fulfillmentCompany,
    campaignSource: null,
  };
}

export interface CallLog {
  [method: string]: number;
}

export function createMemoryStore(db: FixtureDb, calls: CallLog = {}): HermesStore {
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const newest = <T extends { placedAt: Date | null; id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => (b.placedAt?.getTime() ?? 0) - (a.placedAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
  const summary = (order: FixtureOrder) => {
    const { fulfillmentStatus, subtotalAmount, taxAmount, shippingAmount, updatedAt, rawOrder, ...rest } = order;
    void fulfillmentStatus; void subtotalAmount; void taxAmount; void shippingAmount; void updatedAt; void rawOrder;
    return rest;
  };
  const strip = <T extends { merchantId: string }>({ merchantId, ...rest }: T) => {
    void merchantId;
    return rest;
  };

  const store: HermesStore = {
    async findCredentialByKeyId(keyId) {
      count('findCredentialByKeyId');
      return db.credentials.find((row) => row.keyId === keyId) ?? null;
    },
    async touchCredential(id, at) {
      count('touchCredential');
      const row = db.credentials.find((entry) => entry.id === id);
      if (row) row.lastUsedAt = at;
    },
    async countUsage(credentialId, recentSince, missesSince, missActions) {
      count('countUsage');
      const rows = db.audits.filter((row) => row.credentialId === credentialId);
      const at = (row: AuditRecord) => (row as AuditRecord & { createdAt?: Date }).createdAt ?? new Date();
      return {
        recent: rows.filter((row) => at(row) >= recentSince).length,
        misses: rows.filter((row) => at(row) >= missesSince && row.outcome === 'not_found' && missActions.includes(row.action)).length,
      };
    },
    async writeAudit(record) {
      count('writeAudit');
      db.audits.push({ ...record, createdAt: new Date() } as AuditRecord);
    },
    async findOrdersByReference(merchantId, reference) {
      count('findOrdersByReference');
      return newest(db.orders.filter((o) => o.merchantId === merchantId && (o.referenceId === reference || o.orderNumber === reference))).slice(0, 5).map(summary);
    },
    async findOrdersByPhoneVariants(merchantId, variants, limit) {
      count('findOrdersByPhoneVariants');
      return newest(db.orders.filter((o) => o.merchantId === merchantId && o.customerMobile !== null && variants.includes(o.customerMobile))).slice(0, limit).map(summary);
    },
    async loadDialInfo(merchantId, ids) {
      count('loadDialInfo');
      return db.orders
        .filter((o) => o.merchantId === merchantId && ids.includes(o.id))
        .map((o) => {
          const customer = (o.rawOrder as { customer?: { mobile?: unknown; mobile_code?: unknown } }).customer;
          return { id: o.id, mobile: customer?.mobile == null ? null : String(customer.mobile), mobileCode: (customer?.mobile_code as string) ?? null };
        });
    },
    async findOrdersByEmails(merchantId, emails, limit) {
      count('findOrdersByEmails');
      const exact = db.orders.filter((o) => o.merchantId === merchantId && o.customerEmail !== null && emails.includes(o.customerEmail));
      if (exact.length) return newest(exact).slice(0, limit).map(summary);
      return newest(db.orders.filter((o) => o.merchantId === merchantId && ilike(o.customerEmail, emails[0]))).slice(0, limit).map(summary);
    },
    async findOrdersByTracking(merchantId, variants, limit) {
      count('findOrdersByTracking');
      const ids = new Set([
        ...db.orders.filter((o) => o.merchantId === merchantId && o.trackingNumber && variants.includes(o.trackingNumber)).map((o) => o.orderId),
        ...db.sallaShipments.filter((s) => s.merchantId === merchantId && variants.includes(s.trackingNumber)).map((s) => s.orderId),
        ...db.localShipments.filter((s) => s.merchantId === merchantId && variants.includes(s.trackingNumber)).map((s) => s.orderId),
      ]);
      return newest(db.orders.filter((o) => o.merchantId === merchantId && ids.has(o.orderId))).slice(0, limit).map(summary);
    },
    async findOrdersByCustomerId(merchantId, customerId, limit) {
      count('findOrdersByCustomerId');
      return newest(db.orders.filter((o) => o.merchantId === merchantId && o.customerId === customerId)).slice(0, limit).map(summary);
    },
    async countOrdersByCustomerId(merchantId, customerId) {
      count('countOrdersByCustomerId');
      return db.orders.filter((o) => o.merchantId === merchantId && o.customerId === customerId).length;
    },
    async loadOrderDetail(merchantId, orderRowId) {
      count('loadOrderDetail');
      const order = db.orders.find((o) => o.id === orderRowId && o.merchantId === merchantId);
      if (!order) return null;
      const same = (row: { merchantId: string; orderId: string }) => row.merchantId === merchantId && row.orderId === order.orderId;
      const sallaShipment = db.sallaShipments.find(same);
      const localShipments = db.localShipments.filter(same).map(strip);
      const rawShipments = ((order.rawOrder as { shipments?: { tracking_number?: string }[] }).shipments ?? []).map((entry) => entry.tracking_number);
      const tracking = [order.trackingNumber, sallaShipment?.trackingNumber, ...localShipments.map((l) => l.trackingNumber), ...rawShipments].filter(Boolean);
      return {
        order,
        items: db.items.filter(same).map(({ merchantId: m, orderId: o, ...rest }) => { void m; void o; return rest; }),
        sallaShipment: sallaShipment ? strip(sallaShipment) : null,
        localShipments,
        returns: db.returns.filter((r) => r.merchantId === merchantId && r.orderId === order.orderId).map(strip),
        events: db.events.filter((e) => e.orderId === order.orderId).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
        scans: db.scans.filter((s) => tracking.includes(s.trackingNumber)),
        flags: {
          highPriority: db.flags.some((f) => same(f) && f.kind === 'highPriority'),
          doNotShip: db.flags.some((f) => same(f) && f.kind === 'doNotShip'),
          gift: db.flags.some((f) => same(f) && f.kind === 'gift'),
        },
      };
    },
    async loadReturnsForOrders(merchantId, orderIds) {
      count('loadReturnsForOrders');
      return db.returns.filter((r) => r.merchantId === merchantId && orderIds.includes(r.orderId)).map(strip);
    },
    async loadLocalShipmentsForOrders(merchantId, orderIds) {
      count('loadLocalShipmentsForOrders');
      return db.localShipments.filter((l) => l.merchantId === merchantId && orderIds.includes(l.orderId)).map(strip);
    },
    async findShipmentSources(merchantId, variants) {
      count('findShipmentSources');
      const sallaShipments = db.sallaShipments.filter((s) => s.merchantId === merchantId && variants.includes(s.trackingNumber)).map(strip);
      const localShipments = db.localShipments.filter((s) => s.merchantId === merchantId && variants.includes(s.trackingNumber)).map(strip);
      const ids = new Set([
        ...sallaShipments.map((s) => s.orderId),
        ...localShipments.map((s) => s.orderId),
        ...db.orders.filter((o) => o.merchantId === merchantId && o.trackingNumber && variants.includes(o.trackingNumber)).map((o) => o.orderId),
      ]);
      return { sallaShipments, localShipments, orders: newest(db.orders.filter((o) => o.merchantId === merchantId && ids.has(o.orderId))) };
    },
    async loadScans(trackingNumbers) {
      count('loadScans');
      return db.scans.filter((s) => trackingNumbers.includes(s.trackingNumber));
    },
    async loadCarrierEvents(trackingNumbers) {
      count('loadCarrierEvents');
      return db.carrierEvents.filter((e) => trackingNumbers.includes(e.trackingNumber));
    },
    async loadReportOrders(merchantId, range) {
      count('loadReportOrders');
      return db.orders.filter((o) => o.merchantId === merchantId && inRange(o.placedAt, range)).map(toReportRow);
    },
    async loadRestoredOrders(merchantId, range) {
      count('loadRestoredOrders');
      const first = new Map<string, Date>();
      for (const event of db.events.filter((e) => e.status === 'restored' && e.receivedAt < range.end)) {
        const existing = first.get(event.orderId);
        if (!existing || event.receivedAt < existing) first.set(event.orderId, event.receivedAt);
      }
      return db.orders
        .filter((o) => o.merchantId === merchantId && first.has(o.orderId) && first.get(o.orderId)! >= range.start)
        .map((o) => ({ ...toReportRow(o), restoredAt: first.get(o.orderId)! }));
    },
    async loadFirstOrderDates(merchantId, range) {
      count('loadFirstOrderDates');
      const ids = new Set(db.orders.filter((o) => o.merchantId === merchantId && inRange(o.placedAt, range) && o.customerId).map((o) => o.customerId!));
      return Array.from(ids).map((customerId) => ({
        customerId,
        firstPlacedAt: new Date(Math.min(...db.orders.filter((o) => o.merchantId === merchantId && o.customerId === customerId).map((o) => o.placedAt!.getTime()))),
      }));
    },
    async loadShipmentFacts(merchantId, range) {
      count('loadShipmentFacts');
      return db.orders
        .filter((o) => o.merchantId === merchantId && inRange(o.placedAt, range))
        .map((o) => {
          const ss = db.sallaShipments.find((s) => s.merchantId === merchantId && s.orderId === o.orderId);
          const tracking = ss?.trackingNumber ?? o.trackingNumber;
          const scan = db.scans.find((s) => s.trackingNumber === tracking);
          const local = db.localShipments.filter((l) => l.merchantId === merchantId && l.orderId === o.orderId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
          return {
            orderRowId: o.id,
            trackingNumber: tracking ?? null,
            courierName: ss?.courierName ?? null,
            sallaShipmentStatus: ss?.status ?? null,
            labelCreatedAt: ss?.createdAt ?? null,
            scannedAt: scan?.scannedAt ?? null,
            handoverScannedAt: scan?.handoverScannedAt ?? null,
            scanCompany: scan?.company ?? null,
            smsaLiveStatus: scan?.smsaLiveStatus ?? null,
            ajexLiveStatus: scan?.ajexLiveStatus ?? null,
            ajexLiveStatusEventAt: scan?.ajexLiveStatusEventAt ?? null,
            localStatus: local?.status ?? null,
            localCreatedAt: local?.createdAt ?? null,
            localDeliveredAt: local?.deliveredAt ?? null,
          };
        });
    },
    async loadLabelCreationTimes(merchantId, range) {
      count('loadLabelCreationTimes');
      return [...db.sallaShipments, ...db.localShipments].filter((s) => s.merchantId === merchantId && inRange(s.createdAt, range)).map((s) => s.createdAt);
    },
    async loadReportItems(merchantId, range) {
      count('loadReportItems');
      return db.items.flatMap((item) => {
        const order = db.orders.find((o) => o.merchantId === merchantId && item.merchantId === merchantId && o.orderId === item.orderId && inRange(o.placedAt, range));
        return order ? [{ orderRowId: order.id, productId: item.productId, sku: item.sku, name: item.name, quantity: item.quantity, totalAmount: item.totalAmount }] : [];
      });
    },
    async loadReportReturnItems(merchantId, range) {
      count('loadReportReturnItems');
      return db.returns
        .filter((r) => r.merchantId === merchantId && inRange(r.createdAt, range))
        .flatMap((r) => r.items.map((item) => ({ productId: item.productId, productName: item.productName, productSku: item.productSku, quantity: item.quantity, type: r.type, status: r.status, reason: r.reason })));
    },
    async loadReportReturnRequests(merchantId, range) {
      count('loadReportReturnRequests');
      return db.returns.filter((r) => r.merchantId === merchantId && inRange(r.createdAt, range)).map((r) => ({ type: r.type, status: r.status, reason: r.reason, createdAt: r.createdAt }));
    },
    async loadOpenOrders(merchantId, slugs, since) {
      count('loadOpenOrders');
      return db.orders.filter((o) => o.merchantId === merchantId && slugs.includes(o.statusSlug ?? '') && o.placedAt! >= since).map(toReportRow);
    },
    async countPendingReturnRequests(merchantId) {
      count('countPendingReturnRequests');
      return db.returns.filter((r) => r.merchantId === merchantId && r.status === 'pending_review').length;
    },
    async loadFreshness(merchantId) {
      count('loadFreshness');
      const placed = db.orders.filter((o) => o.merchantId === merchantId).map((o) => o.placedAt!.getTime());
      return { lastOrderPlacedAt: placed.length ? new Date(Math.max(...placed)) : null, lastWebhookAt: null };
    },
  };
  return store;
}

export function request(
  path: string,
  options: { apiKey?: string | null; method?: string; headers?: Record<string, string>; body?: unknown; proto?: string } = {}
): NextRequest {
  const headers: Record<string, string> = { 'x-forwarded-proto': options.proto ?? 'https', ...options.headers };
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`https://hermes.test${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export function routeParams(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}
