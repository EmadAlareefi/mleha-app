import type { Prisma } from '@prisma/client';

/**
 * Data access contract for the Hermes API. Every method that reads business
 * data takes the credential's `merchantId` and must filter by it — that is
 * the tenant boundary. Selections are narrow on purpose: nothing here ever
 * returns password hashes, tokens, webhook payloads or internal notes.
 *
 * The production implementation is `store-prisma.ts`; tests use an in-memory
 * implementation over anonymised fixtures.
 */

type Dec = Prisma.Decimal;

export interface CredentialRecord {
  id: string;
  keyId: string;
  secretHash: string;
  name: string;
  merchantId: string;
  scopes: string[];
  revokedAt: Date | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}

export interface AuditRecord {
  requestId: string;
  credentialId: string | null;
  merchantId: string | null;
  action: string;
  scopeUsed: string | null;
  targetType: string | null;
  targetId: string | null;
  outcome: 'success' | 'not_found' | 'denied' | 'unauthenticated' | 'invalid' | 'rate_limited' | 'error';
  httpStatus: number;
  classification: string;
  resultCount: number | null;
  durationMs: number | null;
  ipHash: string | null;
  actorId: string | null;
  actorChannel: string | null;
  actorVerified: boolean;
}

export interface UsageCounts {
  /** Requests in the short window (rate limit). */
  recent: number;
  /** `not_found` lookups in the miss window (enumeration budget). */
  misses: number;
}

export interface OrderSummaryRow {
  id: string;
  merchantId: string;
  orderId: string;
  referenceId: string | null;
  orderNumber: string | null;
  statusSlug: string | null;
  statusName: string | null;
  paymentMethod: string | null;
  currency: string | null;
  totalAmount: Dec | null;
  customerId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  customerCity: string | null;
  customerCountry: string | null;
  fulfillmentCompany: string | null;
  trackingNumber: string | null;
  placedAt: Date | null;
}

export interface OrderDetailRow extends OrderSummaryRow {
  fulfillmentStatus: string | null;
  subtotalAmount: Dec | null;
  taxAmount: Dec | null;
  shippingAmount: Dec | null;
  updatedAt: Date;
  /** Full Salla payload; only allow-listed paths may be read from it. */
  rawOrder: unknown;
}

export interface DialInfoRow {
  id: string;
  mobile: string | null;
  mobileCode: string | null;
}

export interface OrderItemRow {
  itemId: string;
  productId: string | null;
  sku: string | null;
  name: string | null;
  quantity: number;
  priceAmount: Dec | null;
  totalAmount: Dec | null;
  currency: string | null;
}

export interface SallaShipmentRow {
  orderId: string;
  orderNumber: string;
  trackingNumber: string;
  courierName: string;
  courierCode: string;
  status: string;
  /** Only `tracking_link` is read from Salla's shipment payload. */
  trackingLink: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalShipmentRow {
  orderId: string;
  orderNumber: string;
  trackingNumber: string;
  status: string;
  shippingCity: string;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** From ShipmentAssignment; free-text reasons are internal and not loaded. */
  assignmentStatus: string | null;
  failedAt: Date | null;
}

export interface ScanRow {
  trackingNumber: string;
  company: string;
  scannedAt: Date;
  handoverScannedAt: Date | null;
  smsaLiveStatus: unknown;
  smsaLiveStatusUpdatedAt: Date | null;
  ajexLiveStatus: unknown;
  ajexLiveStatusUpdatedAt: Date | null;
  ajexLiveStatusEventAt: Date | null;
}

export interface CarrierEventRow {
  trackingNumber: string;
  scanType: string | null;
  description: string | null;
  city: string | null;
  scanDateTime: string | null;
  scanTimeZone: string | null;
}

export interface ReturnItemRow {
  productId: string;
  productName: string;
  productSku: string | null;
  variantName: string | null;
  quantity: number;
  price: Dec;
}

export interface ReturnRow {
  id: string;
  orderId: string;
  orderNumber: string | null;
  type: string;
  status: string;
  reason: string;
  totalRefundAmount: Dec | null;
  currency: string;
  couponIssued: boolean;
  returnTrackingNumber: string | null;
  exchangeOrderNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: ReturnItemRow[];
}

export interface StatusEventRow {
  status: string | null;
  receivedAt: Date;
}

export interface OrderFlags {
  highPriority: boolean;
  doNotShip: boolean;
  gift: boolean;
}

export interface OrderDetailBundle {
  order: OrderDetailRow;
  items: OrderItemRow[];
  sallaShipment: SallaShipmentRow | null;
  localShipments: LocalShipmentRow[];
  returns: ReturnRow[];
  events: StatusEventRow[];
  scans: ScanRow[];
  flags: OrderFlags;
}

export interface ShipmentSources {
  sallaShipments: SallaShipmentRow[];
  localShipments: LocalShipmentRow[];
  orders: OrderDetailRow[];
}

export interface ReportOrderRow {
  id: string;
  orderId: string;
  referenceId: string | null;
  orderNumber: string | null;
  placedAt: Date;
  statusSlug: string | null;
  paymentMethod: string | null;
  currency: string | null;
  subtotalAmount: Dec | null;
  shippingAmount: Dec | null;
  taxAmount: Dec | null;
  totalAmount: Dec | null;
  /** Σ amounts.discounts[].discount from the Salla payload. */
  discountTotal: Dec;
  /** Σ refunded_items[].amounts.total.amount (partial refunds). */
  refundedItemsTotal: Dec;
  refundedItemsCount: number;
  isPendingPayment: boolean | null;
  exchangeRate: unknown;
  customerId: string | null;
  customerName: string | null;
  customerCity: string | null;
  customerCountry: string | null;
  fulfillmentCompany: string | null;
  campaignSource: string | null;
}

export interface RestoredOrderRow extends ReportOrderRow {
  restoredAt: Date;
}

export interface ShipmentFactRow {
  orderRowId: string;
  trackingNumber: string | null;
  courierName: string | null;
  sallaShipmentStatus: string | null;
  labelCreatedAt: Date | null;
  scannedAt: Date | null;
  handoverScannedAt: Date | null;
  scanCompany: string | null;
  smsaLiveStatus: unknown;
  ajexLiveStatus: unknown;
  ajexLiveStatusEventAt: Date | null;
  localStatus: string | null;
  localCreatedAt: Date | null;
  localDeliveredAt: Date | null;
}

export interface ReportItemRow {
  orderRowId: string;
  productId: string | null;
  sku: string | null;
  name: string | null;
  quantity: number;
  totalAmount: Dec | null;
}

export interface ReportReturnItemRow {
  productId: string;
  productName: string;
  productSku: string | null;
  quantity: number;
  type: string;
  status: string;
}

export interface ReportReturnRequestRow {
  type: string;
  status: string;
  createdAt: Date;
}

export interface FirstOrderRow {
  customerId: string;
  firstPlacedAt: Date;
}

export interface Freshness {
  lastOrderPlacedAt: Date | null;
  lastWebhookAt: Date | null;
}

export interface UtcRange {
  start: Date;
  /** Exclusive. */
  end: Date;
}

export interface HermesStore {
  // credentials and audit
  findCredentialByKeyId(keyId: string): Promise<CredentialRecord | null>;
  touchCredential(id: string, at: Date): Promise<void>;
  countUsage(credentialId: string, recentSince: Date, missesSince: Date, missActions: readonly string[]): Promise<UsageCounts>;
  writeAudit(record: AuditRecord): Promise<void>;

  // lookups
  findOrdersByReference(merchantId: string, reference: string): Promise<OrderSummaryRow[]>;
  findOrdersByPhoneVariants(merchantId: string, variants: string[], limit: number): Promise<OrderSummaryRow[]>;
  loadDialInfo(merchantId: string, orderRowIds: string[]): Promise<DialInfoRow[]>;
  findOrdersByEmails(merchantId: string, emails: string[], limit: number): Promise<OrderSummaryRow[]>;
  findOrdersByTracking(merchantId: string, trackingVariants: string[], limit: number): Promise<OrderSummaryRow[]>;
  findOrdersByCustomerId(merchantId: string, customerId: string, limit: number): Promise<OrderSummaryRow[]>;
  countOrdersByCustomerId(merchantId: string, customerId: string): Promise<number>;
  loadOrderDetail(merchantId: string, orderRowId: string): Promise<OrderDetailBundle | null>;
  loadReturnsForOrders(merchantId: string, orderIds: string[]): Promise<ReturnRow[]>;
  loadLocalShipmentsForOrders(merchantId: string, orderIds: string[]): Promise<LocalShipmentRow[]>;
  findShipmentSources(merchantId: string, trackingVariants: string[]): Promise<ShipmentSources>;
  loadScans(trackingNumbers: string[]): Promise<ScanRow[]>;
  loadCarrierEvents(trackingNumbers: string[]): Promise<CarrierEventRow[]>;

  // reports
  loadReportOrders(merchantId: string, range: UtcRange): Promise<ReportOrderRow[]>;
  loadRestoredOrders(merchantId: string, range: UtcRange): Promise<RestoredOrderRow[]>;
  loadFirstOrderDates(merchantId: string, range: UtcRange): Promise<FirstOrderRow[]>;
  loadShipmentFacts(merchantId: string, range: UtcRange): Promise<ShipmentFactRow[]>;
  loadLabelCreationTimes(merchantId: string, range: UtcRange): Promise<Date[]>;
  loadReportItems(merchantId: string, range: UtcRange): Promise<ReportItemRow[]>;
  loadReportReturnItems(merchantId: string, range: UtcRange): Promise<ReportReturnItemRow[]>;
  loadReportReturnRequests(merchantId: string, range: UtcRange): Promise<ReportReturnRequestRow[]>;
  loadOpenOrders(merchantId: string, statusSlugs: string[], placedSince: Date): Promise<ReportOrderRow[]>;
  countPendingReturnRequests(merchantId: string): Promise<number>;
  loadFreshness(merchantId: string): Promise<Freshness>;
}
