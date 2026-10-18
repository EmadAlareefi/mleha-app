import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
  CarrierEventRow,
  CredentialRecord,
  DialInfoRow,
  FirstOrderRow,
  Freshness,
  HermesStore,
  LocalShipmentRow,
  OrderDetailBundle,
  OrderDetailRow,
  OrderSummaryRow,
  ReportItemRow,
  ReportOrderRow,
  ReportReturnItemRow,
  ReportReturnRequestRow,
  RestoredOrderRow,
  ReturnRow,
  SallaShipmentRow,
  ScanRow,
  ShipmentFactRow,
  ShipmentSources,
  UtcRange,
} from './store';

/**
 * Prisma implementation of `HermesStore`. All values reach SQL as bound
 * parameters (Prisma.sql / ORM filters); nothing is string-concatenated.
 * Every business query is filtered by `merchantId`, except lookups keyed by
 * identifiers that were themselves read from merchant-scoped rows
 * (warehouse scans and SMSA events by tracking number, webhook events by
 * Salla order id).
 */

const ORDER_SUMMARY_SELECT = {
  id: true,
  merchantId: true,
  orderId: true,
  referenceId: true,
  orderNumber: true,
  statusSlug: true,
  statusName: true,
  paymentMethod: true,
  currency: true,
  totalAmount: true,
  customerId: true,
  customerName: true,
  customerMobile: true,
  customerEmail: true,
  customerCity: true,
  customerCountry: true,
  fulfillmentCompany: true,
  trackingNumber: true,
  placedAt: true,
} satisfies Prisma.SallaOrderSelect;

const ORDER_DETAIL_SELECT = {
  ...ORDER_SUMMARY_SELECT,
  fulfillmentStatus: true,
  subtotalAmount: true,
  taxAmount: true,
  shippingAmount: true,
  updatedAt: true,
  rawOrder: true,
} satisfies Prisma.SallaOrderSelect;

const ORDER_BY_NEWEST = [{ placedAt: 'desc' as const }, { id: 'asc' as const }];

const LOCAL_SHIPMENT_SELECT = {
  orderId: true,
  orderNumber: true,
  trackingNumber: true,
  status: true,
  shippingCity: true,
  deliveredAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  assignment: { select: { status: true, failedAt: true } },
} satisfies Prisma.LocalShipmentSelect;

const RETURN_SELECT = {
  id: true,
  orderId: true,
  orderNumber: true,
  type: true,
  status: true,
  reason: true,
  totalRefundAmount: true,
  currency: true,
  couponCode: true,
  smsaTrackingNumber: true,
  exchangeOrderNumber: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      productId: true,
      productName: true,
      productSku: true,
      variantName: true,
      quantity: true,
      price: true,
    },
  },
} satisfies Prisma.ReturnRequestSelect;

const SCAN_SELECT = {
  trackingNumber: true,
  company: true,
  scannedAt: true,
  handoverScannedAt: true,
  smsaLiveStatus: true,
  smsaLiveStatusUpdatedAt: true,
  ajexLiveStatus: true,
  ajexLiveStatusUpdatedAt: true,
  ajexLiveStatusEventAt: true,
} satisfies Prisma.ShipmentSelect;

type LocalShipmentQueryRow = Prisma.LocalShipmentGetPayload<{ select: typeof LOCAL_SHIPMENT_SELECT }>;
type ReturnQueryRow = Prisma.ReturnRequestGetPayload<{ select: typeof RETURN_SELECT }>;

function toLocalShipment(row: LocalShipmentQueryRow): LocalShipmentRow {
  return {
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    trackingNumber: row.trackingNumber,
    status: row.status,
    shippingCity: row.shippingCity,
    deliveredAt: row.deliveredAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assignmentStatus: row.assignment?.status ?? null,
    failedAt: row.assignment?.failedAt ?? null,
  };
}

function toReturn(row: ReturnQueryRow): ReturnRow {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    type: row.type,
    status: row.status,
    reason: row.reason,
    totalRefundAmount: row.totalRefundAmount,
    currency: row.currency,
    couponIssued: Boolean(row.couponCode),
    returnTrackingNumber: row.smsaTrackingNumber,
    exchangeOrderNumber: row.exchangeOrderNumber,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: row.items,
  };
}

/** Salla shipments are read with SQL so only `tracking_link` leaves the JSON payload. */
async function querySallaShipments(where: Prisma.Sql): Promise<SallaShipmentRow[]> {
  return prisma.$queryRaw<SallaShipmentRow[]>`
    SELECT s."orderId", s."orderNumber", s."trackingNumber", s."courierName", s."courierCode", s.status,
           s."shipmentData"->>'tracking_link' AS "trackingLink", s."createdAt", s."updatedAt"
    FROM "SallaShipment" s
    WHERE ${where}
    ORDER BY s."createdAt" DESC
    LIMIT 20`;
}

/**
 * Columns for report rows. Discounts, partial refunds, the pending-payment
 * flag and the exchange rate only exist inside the Salla payload, so they are
 * precomputed at write time (`app/lib/salla-order-facts.ts`). Rows written
 * before that (`factsComputedAt IS NULL`) fall back to reading the JSON with
 * the same rules; CASE is evaluated lazily, so backfilled rows never touch
 * `rawOrder`.
 */
const REPORT_COLUMNS = Prisma.sql`
  o.id, o."orderId", o."referenceId", o."orderNumber", o."placedAt", o."statusSlug", o."paymentMethod",
  o.currency, o."subtotalAmount", o."shippingAmount", o."taxAmount", o."totalAmount",
  CASE WHEN o."factsComputedAt" IS NOT NULL THEN COALESCE(o."discountTotal", 0) ELSE COALESCE((
    SELECT SUM(CASE WHEN (d->>'discount') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (d->>'discount')::numeric ELSE 0 END)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o."rawOrder"->'amounts'->'discounts') = 'array'
                                   THEN o."rawOrder"->'amounts'->'discounts' ELSE '[]'::jsonb END) d
  ), 0) END AS "discountTotal",
  CASE WHEN o."factsComputedAt" IS NOT NULL THEN COALESCE(o."refundedItemsTotal", 0) ELSE COALESCE((
    SELECT SUM(CASE WHEN jsonb_typeof(r->'amounts'->'total'->'amount') = 'number'
                    THEN (r->'amounts'->'total'->>'amount')::numeric ELSE 0 END)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o."rawOrder"->'refunded_items') = 'array'
                                   THEN o."rawOrder"->'refunded_items' ELSE '[]'::jsonb END) r
  ), 0) END AS "refundedItemsTotal",
  CASE WHEN o."factsComputedAt" IS NOT NULL THEN COALESCE(o."refundedItemsCount", 0) ELSE
    (CASE WHEN jsonb_typeof(o."rawOrder"->'refunded_items') = 'array'
          THEN jsonb_array_length(o."rawOrder"->'refunded_items') ELSE 0 END) END::int AS "refundedItemsCount",
  CASE WHEN o."factsComputedAt" IS NOT NULL THEN o."isPendingPayment" ELSE
    (CASE WHEN jsonb_typeof(o."rawOrder"->'is_pending_payment') = 'boolean'
          THEN (o."rawOrder"->>'is_pending_payment')::boolean END) END AS "isPendingPayment",
  CASE WHEN o."factsComputedAt" IS NOT NULL THEN o."exchangeRate" ELSE o."rawOrder"->'exchange_rate' END AS "exchangeRate",
  o."customerId", o."customerName", o."customerCity", o."customerCountry", o."fulfillmentCompany", o."campaignSource"`;

export const prismaHermesStore: HermesStore = {
  async findCredentialByKeyId(keyId): Promise<CredentialRecord | null> {
    return prisma.hermesApiCredential.findUnique({
      where: { keyId },
      select: {
        id: true,
        keyId: true,
        secretHash: true,
        name: true,
        merchantId: true,
        scopes: true,
        revokedAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    });
  },

  async touchCredential(id, at) {
    await prisma.hermesApiCredential.update({ where: { id }, data: { lastUsedAt: at }, select: { id: true } });
  },

  async countUsage(credentialId, recentSince, missesSince, missActions) {
    const earliest = recentSince < missesSince ? recentSince : missesSince;
    const [row] = await prisma.$queryRaw<{ recent: number; misses: number }[]>`
      SELECT COUNT(*) FILTER (WHERE "createdAt" >= ${recentSince})::int AS recent,
             COUNT(*) FILTER (WHERE "createdAt" >= ${missesSince} AND outcome = 'not_found'
                              AND action = ANY(${[...missActions]}))::int AS misses
      FROM "HermesAuditLog"
      WHERE "credentialId" = ${credentialId} AND "createdAt" >= ${earliest}`;
    return { recent: row?.recent ?? 0, misses: row?.misses ?? 0 };
  },

  async writeAudit(record) {
    await prisma.hermesAuditLog.create({ data: record, select: { id: true } });
  },

  async findOrdersByReference(merchantId, reference): Promise<OrderSummaryRow[]> {
    return prisma.sallaOrder.findMany({
      where: { merchantId, OR: [{ referenceId: reference }, { orderNumber: reference }] },
      select: ORDER_SUMMARY_SELECT,
      orderBy: ORDER_BY_NEWEST,
      take: 5,
    });
  },

  async findOrdersByPhoneVariants(merchantId, variants, limit) {
    return prisma.sallaOrder.findMany({
      where: { merchantId, customerMobile: { in: variants } },
      select: ORDER_SUMMARY_SELECT,
      orderBy: ORDER_BY_NEWEST,
      take: limit,
    });
  },

  async loadDialInfo(merchantId, orderRowIds): Promise<DialInfoRow[]> {
    if (orderRowIds.length === 0) return [];
    return prisma.$queryRaw<DialInfoRow[]>`
      SELECT o.id,
             COALESCE(o."rawOrder"->'customer'->>'mobile', o."rawOrder"->'customer'->>'phone') AS mobile,
             o."rawOrder"->'customer'->>'mobile_code' AS "mobileCode"
      FROM "SallaOrder" o
      WHERE o."merchantId" = ${merchantId} AND o.id = ANY(${orderRowIds})`;
  },

  async findOrdersByEmails(merchantId, emails, limit) {
    // Indexed exact match first. About a sixth of stored emails carry upper
    // case, so a miss falls back to a case-insensitive scan of the merchant's
    // orders. Prisma implements that with ILIKE, where `_`/`%` are wildcards,
    // so callers must re-verify every row (see orders search).
    const exact = await prisma.sallaOrder.findMany({
      where: { merchantId, customerEmail: { in: emails } },
      select: ORDER_SUMMARY_SELECT,
      orderBy: ORDER_BY_NEWEST,
      take: limit,
    });
    if (exact.length > 0) return exact;
    return prisma.sallaOrder.findMany({
      where: { merchantId, customerEmail: { equals: emails[0], mode: 'insensitive' } },
      select: ORDER_SUMMARY_SELECT,
      orderBy: ORDER_BY_NEWEST,
      take: limit,
    });
  },

  async findOrdersByTracking(merchantId, trackingVariants, limit) {
    const [direct, sallaShipments, localShipments] = await Promise.all([
      prisma.sallaOrder.findMany({
        where: { merchantId, trackingNumber: { in: trackingVariants } },
        select: { orderId: true },
        take: limit,
      }),
      prisma.sallaShipment.findMany({
        where: { merchantId, trackingNumber: { in: trackingVariants } },
        select: { orderId: true },
        take: limit,
      }),
      prisma.localShipment.findMany({
        where: { merchantId, trackingNumber: { in: trackingVariants } },
        select: { orderId: true },
        take: limit,
      }),
    ]);
    const orderIds = Array.from(new Set([...direct, ...sallaShipments, ...localShipments].map((row) => row.orderId)));
    if (orderIds.length === 0) return [];
    return prisma.sallaOrder.findMany({
      where: { merchantId, orderId: { in: orderIds } },
      select: ORDER_SUMMARY_SELECT,
      orderBy: ORDER_BY_NEWEST,
      take: limit,
    });
  },

  async findOrdersByCustomerId(merchantId, customerId, limit) {
    return prisma.sallaOrder.findMany({
      where: { merchantId, customerId },
      select: ORDER_SUMMARY_SELECT,
      orderBy: ORDER_BY_NEWEST,
      take: limit,
    });
  },

  async countOrdersByCustomerId(merchantId, customerId) {
    return prisma.sallaOrder.count({ where: { merchantId, customerId } });
  },

  async loadOrderDetail(merchantId, orderRowId): Promise<OrderDetailBundle | null> {
    const order: OrderDetailRow | null = await prisma.sallaOrder.findFirst({
      where: { id: orderRowId, merchantId },
      select: ORDER_DETAIL_SELECT,
    });
    if (!order) return null;

    const key = { merchantId, orderId: order.orderId };
    // Tracking numbers from the order itself and every shipment in its Salla
    // payload; label and local-courier ones are added inside the scan query
    // so scans load in the same parallel batch.
    const knownTracking = [
      order.trackingNumber,
      ...(Array.isArray((order.rawOrder as { shipments?: unknown })?.shipments)
        ? ((order.rawOrder as { shipments: { tracking_number?: unknown }[] }).shipments.map((entry) => entry?.tracking_number))
        : []),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    const [items, sallaShipments, localShipments, returns, events, highPriority, doNotShip, gift, scans] = await Promise.all([
      prisma.sallaOrderItem.findMany({
        where: key,
        select: {
          itemId: true,
          productId: true,
          sku: true,
          name: true,
          quantity: true,
          priceAmount: true,
          totalAmount: true,
          currency: true,
        },
        orderBy: { itemId: 'asc' },
      }),
      querySallaShipments(Prisma.sql`s."merchantId" = ${merchantId} AND s."orderId" = ${order.orderId}`),
      prisma.localShipment.findMany({ where: key, select: LOCAL_SHIPMENT_SELECT, orderBy: { createdAt: 'desc' } }),
      prisma.returnRequest.findMany({ where: key, select: RETURN_SELECT, orderBy: { createdAt: 'desc' } }),
      // Status + time only — the webhook payload column is never selected.
      prisma.webhookEvent.findMany({
        where: { orderId: order.orderId },
        select: { status: true, receivedAt: true },
        orderBy: { receivedAt: 'asc' },
        take: 200,
      }),
      prisma.highPriorityOrder.findUnique({ where: { merchantId_orderId: key }, select: { id: true } }),
      prisma.orderDoNotShipFlag.findUnique({ where: { merchantId_orderId: key }, select: { id: true } }),
      prisma.orderGiftFlag.findUnique({ where: { merchantId_orderId: key }, select: { id: true } }),
      prisma.$queryRaw<ScanRow[]>`
        SELECT sc."trackingNumber", sc.company, sc."scannedAt", sc."handoverScannedAt", sc."smsaLiveStatus",
               sc."smsaLiveStatusUpdatedAt", sc."ajexLiveStatus", sc."ajexLiveStatusUpdatedAt", sc."ajexLiveStatusEventAt"
        FROM "Shipment" sc
        WHERE sc.type = 'outgoing' AND sc."trackingNumber" IN (
          SELECT s."trackingNumber" FROM "SallaShipment" s WHERE s."merchantId" = ${merchantId} AND s."orderId" = ${order.orderId}
          UNION ALL
          SELECT l."trackingNumber" FROM "LocalShipment" l WHERE l."merchantId" = ${merchantId} AND l."orderId" = ${order.orderId}
          UNION ALL
          SELECT unnest(${knownTracking}::text[])
        )`,
    ]);

    return {
      order,
      items,
      sallaShipment: sallaShipments[0] ?? null,
      localShipments: localShipments.map(toLocalShipment),
      returns: returns.map(toReturn),
      events,
      scans,
      flags: { highPriority: Boolean(highPriority), doNotShip: Boolean(doNotShip), gift: Boolean(gift) },
    };
  },

  async loadReturnsForOrders(merchantId, orderIds) {
    if (orderIds.length === 0) return [];
    const rows = await prisma.returnRequest.findMany({
      where: { merchantId, orderId: { in: orderIds } },
      select: RETURN_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toReturn);
  },

  async loadLocalShipmentsForOrders(merchantId, orderIds) {
    if (orderIds.length === 0) return [];
    const rows = await prisma.localShipment.findMany({
      where: { merchantId, orderId: { in: orderIds } },
      select: LOCAL_SHIPMENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toLocalShipment);
  },

  async findShipmentSources(merchantId, trackingVariants): Promise<ShipmentSources> {
    const [sallaShipments, localShipments, directOrders] = await Promise.all([
      querySallaShipments(Prisma.sql`s."merchantId" = ${merchantId} AND s."trackingNumber" = ANY(${trackingVariants})`),
      prisma.localShipment.findMany({
        where: { merchantId, trackingNumber: { in: trackingVariants } },
        select: LOCAL_SHIPMENT_SELECT,
        take: 20,
      }),
      prisma.sallaOrder.findMany({
        where: { merchantId, trackingNumber: { in: trackingVariants } },
        select: { orderId: true },
        take: 20,
      }),
    ]);
    const orderIds = Array.from(
      new Set([...sallaShipments, ...localShipments, ...directOrders].map((row) => row.orderId))
    );
    const orders =
      orderIds.length === 0
        ? []
        : await prisma.sallaOrder.findMany({
            where: { merchantId, orderId: { in: orderIds } },
            select: ORDER_DETAIL_SELECT,
            orderBy: ORDER_BY_NEWEST,
            take: 20,
          });
    return { sallaShipments, localShipments: localShipments.map(toLocalShipment), orders };
  },

  async loadScans(trackingNumbers): Promise<ScanRow[]> {
    if (trackingNumbers.length === 0) return [];
    return prisma.shipment.findMany({
      where: { trackingNumber: { in: trackingNumbers }, type: 'outgoing' },
      select: SCAN_SELECT,
    });
  },

  async loadCarrierEvents(trackingNumbers): Promise<CarrierEventRow[]> {
    if (trackingNumbers.length === 0) return [];
    const shipments = await prisma.smsaWebhookShipment.findMany({
      where: { awb: { in: trackingNumbers } },
      select: {
        awb: true,
        // receivedBy (a person's name) is deliberately not selected.
        scans: {
          select: { scanType: true, scanDescription: true, city: true, scanDateTime: true, scanTimeZone: true },
          take: 100,
        },
      },
    });
    return shipments.flatMap((shipment) =>
      shipment.scans.map((scan) => ({
        trackingNumber: shipment.awb,
        scanType: scan.scanType,
        description: scan.scanDescription,
        city: scan.city,
        scanDateTime: scan.scanDateTime,
        scanTimeZone: scan.scanTimeZone,
      }))
    );
  },

  async loadReportOrders(merchantId, range: UtcRange): Promise<ReportOrderRow[]> {
    return prisma.$queryRaw<ReportOrderRow[]>`
      SELECT ${REPORT_COLUMNS}
      FROM "SallaOrder" o
      WHERE o."merchantId" = ${merchantId} AND o."placedAt" >= ${range.start} AND o."placedAt" < ${range.end}`;
  },

  async loadRestoredOrders(merchantId, range): Promise<RestoredOrderRow[]> {
    // The first time Salla reported the order as "restored" is when the refund
    // happened; WebhookEvent keeps that history (status + time only is read).
    // Only events inside the range are scanned (WebhookEvent(status, receivedAt)
    // index); orders already restored before the range are excluded.
    return prisma.$queryRaw<RestoredOrderRow[]>`
      SELECT ${REPORT_COLUMNS}, f."restoredAt"
      FROM (
        SELECT w."orderId", MIN(w."receivedAt") AS "restoredAt"
        FROM "WebhookEvent" w
        WHERE w.status = 'restored' AND w."receivedAt" >= ${range.start} AND w."receivedAt" < ${range.end}
        GROUP BY w."orderId"
      ) f
      JOIN "SallaOrder" o ON o."merchantId" = ${merchantId} AND o."orderId" = f."orderId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "WebhookEvent" e
        WHERE e."orderId" = f."orderId" AND e.status = 'restored' AND e."receivedAt" < ${range.start}
      )`;
  },

  async loadFirstOrderDates(merchantId, range): Promise<FirstOrderRow[]> {
    return prisma.$queryRaw<FirstOrderRow[]>`
      SELECT c."customerId", MIN(a."placedAt") AS "firstPlacedAt"
      FROM (
        SELECT DISTINCT "customerId" FROM "SallaOrder"
        WHERE "merchantId" = ${merchantId} AND "placedAt" >= ${range.start} AND "placedAt" < ${range.end}
          AND "customerId" IS NOT NULL
      ) c
      JOIN "SallaOrder" a ON a."merchantId" = ${merchantId} AND a."customerId" = c."customerId"
      GROUP BY c."customerId"`;
  },

  async loadShipmentFacts(merchantId, range): Promise<ShipmentFactRow[]> {
    return prisma.$queryRaw<ShipmentFactRow[]>`
      SELECT o.id AS "orderRowId", COALESCE(ss."trackingNumber", o."trackingNumber") AS "trackingNumber", ss."courierName", ss.status AS "sallaShipmentStatus", ss."createdAt" AS "labelCreatedAt",
             sc."scannedAt", sc."handoverScannedAt", sc.company AS "scanCompany",
             sc."smsaLiveStatus", sc."ajexLiveStatus", sc."ajexLiveStatusEventAt",
             ls.status AS "localStatus", ls."createdAt" AS "localCreatedAt", ls."deliveredAt" AS "localDeliveredAt"
      FROM "SallaOrder" o
      LEFT JOIN "SallaShipment" ss ON ss."merchantId" = o."merchantId" AND ss."orderId" = o."orderId"
      LEFT JOIN "Shipment" sc ON sc."trackingNumber" = COALESCE(ss."trackingNumber", o."trackingNumber") AND sc.type = 'outgoing'
      LEFT JOIN LATERAL (
        SELECT l.status, l."createdAt", l."deliveredAt" FROM "LocalShipment" l
        WHERE l."merchantId" = o."merchantId" AND l."orderId" = o."orderId"
        ORDER BY l."createdAt" DESC LIMIT 1
      ) ls ON TRUE
      WHERE o."merchantId" = ${merchantId} AND o."placedAt" >= ${range.start} AND o."placedAt" < ${range.end}`;
  },

  async loadLabelCreationTimes(merchantId, range) {
    const rows = await prisma.$queryRaw<{ createdAt: Date }[]>`
      SELECT "createdAt" FROM "SallaShipment"
      WHERE "merchantId" = ${merchantId} AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}
      UNION ALL
      SELECT "createdAt" FROM "LocalShipment"
      WHERE "merchantId" = ${merchantId} AND "createdAt" >= ${range.start} AND "createdAt" < ${range.end}`;
    return rows.map((row) => row.createdAt);
  },

  async loadReportItems(merchantId, range): Promise<ReportItemRow[]> {
    return prisma.$queryRaw<ReportItemRow[]>`
      SELECT o.id AS "orderRowId", i."productId", i.sku, i.name, i.quantity, i."totalAmount"
      FROM "SallaOrderItem" i
      JOIN "SallaOrder" o ON o."merchantId" = i."merchantId" AND o."orderId" = i."orderId"
      WHERE o."merchantId" = ${merchantId} AND o."placedAt" >= ${range.start} AND o."placedAt" < ${range.end}`;
  },

  async loadReportReturnItems(merchantId, range): Promise<ReportReturnItemRow[]> {
    return prisma.$queryRaw<ReportReturnItemRow[]>`
      SELECT ri."productId", ri."productName", ri."productSku", ri.quantity, rr.type, rr.status
      FROM "ReturnItem" ri
      JOIN "ReturnRequest" rr ON rr.id = ri."returnRequestId"
      WHERE rr."merchantId" = ${merchantId} AND rr."createdAt" >= ${range.start} AND rr."createdAt" < ${range.end}`;
  },

  async loadReportReturnRequests(merchantId, range): Promise<ReportReturnRequestRow[]> {
    return prisma.returnRequest.findMany({
      where: { merchantId, createdAt: { gte: range.start, lt: range.end } },
      select: { type: true, status: true, createdAt: true },
    });
  },

  async loadOpenOrders(merchantId, statusSlugs, placedSince) {
    return prisma.$queryRaw<ReportOrderRow[]>`
      SELECT ${REPORT_COLUMNS}
      FROM "SallaOrder" o
      WHERE o."merchantId" = ${merchantId} AND o."statusSlug" = ANY(${statusSlugs}) AND o."placedAt" >= ${placedSince}`;
  },

  async countPendingReturnRequests(merchantId) {
    return prisma.returnRequest.count({ where: { merchantId, status: 'pending_review' } });
  },

  async loadFreshness(merchantId): Promise<Freshness> {
    const [orders, webhooks] = await Promise.all([
      prisma.sallaOrder.aggregate({ where: { merchantId }, _max: { placedAt: true } }),
      prisma.webhookEvent.aggregate({ _max: { receivedAt: true } }),
    ]);
    return { lastOrderPlacedAt: orders._max.placedAt, lastWebhookAt: webhooks._max.receivedAt };
  },
};
