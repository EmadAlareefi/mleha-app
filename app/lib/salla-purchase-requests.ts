import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { getSallaProductLiveStats } from '@/app/lib/salla-api';

const purchaseRequestSelect = {
  id: true,
  merchantId: true,
  productId: true,
  productName: true,
  productSku: true,
  productImageUrl: true,
  variantId: true,
  variantName: true,
  variantSku: true,
  variantBarcode: true,
  variantOptions: true,
  quantity: true,
  status: true,
  notes: true,
  expectedArrivalAt: true,
  requestedBy: true,
  requestedByUser: true,
  requestedAt: true,
  movedToWayBy: true,
  movedToWayAt: true,
  removedBy: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type PurchaseRequestStatus = 'requested' | 'on_the_way' | 'purchased';

export type PurchaseRequestRecord = Prisma.SallaPurchaseRequestGetPayload<{
  select: typeof purchaseRequestSelect;
}>;

export type ManufacturerLinkedProductStats = {
  productId: number;
  productName: string | null;
  productSku: string | null;
  merchantId: string | null;
  remainingQuantity: number | null;
  requestedQuantity: number;
  onTheWayQuantity: number;
  totalPurchaseQuantity: number;
  soldQuantity: number;
  soldAmount: number;
  currency: string | null;
  orderCount: number;
  lastSoldAt: string | null;
};

export type CreatePurchaseRequestInput = {
  productId: number;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  variantSku?: string | null;
  variantBarcode?: string | null;
  variantOptions?: Prisma.InputJsonValue | null;
  merchantId?: string | null;
  quantity: number;
  status?: Extract<PurchaseRequestStatus, 'requested' | 'on_the_way'>;
  expectedArrivalAt?: Date | null;
  notes?: string | null;
  requestedBy: string;
  requestedByUser?: string | null;
};

export type ListPurchaseRequestsInput = {
  status?: PurchaseRequestStatus;
};

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePositiveInt(value: unknown): number | null {
  const parsed = normalizeNumber(value);
  if (parsed == null || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function getRawItemQuantity(item: unknown): number {
  if (!item || typeof item !== 'object') {
    return 1;
  }
  const record = item as Record<string, any>;
  return normalizePositiveInt(record.quantity ?? record.qty) ?? 1;
}

function getRawItemTotal(item: unknown, quantity: number): number {
  if (!item || typeof item !== 'object') {
    return 0;
  }
  const record = item as Record<string, any>;
  const total = normalizeNumber(
    record.amounts?.total?.amount ??
      record.total?.amount ??
      record.total_amount?.amount ??
      record.total_amount ??
      record.total ??
      record.amount
  );
  if (total != null) {
    return total;
  }
  const unitPrice = normalizeNumber(
    record.amounts?.price_without_tax?.amount ??
      record.price?.amount ??
      record.price ??
      record.product?.price?.amount ??
      record.product?.price
  );
  return unitPrice != null ? unitPrice * quantity : 0;
}

function getRawItemCurrency(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, any>;
  return normalizeText(
    record.currency ??
      record.amounts?.total?.currency ??
      record.total?.currency ??
      record.price?.currency
  );
}

export async function listPurchaseRequests(
  params: ListPurchaseRequestsInput = {}
): Promise<PurchaseRequestRecord[]> {
  const where: Prisma.SallaPurchaseRequestWhereInput = {};

  if (params.status) {
    where.status = params.status;
  } else {
    // Default board view: active requests only, never archived/purchased.
    where.status = { in: ['requested', 'on_the_way'] };
  }

  return prisma.sallaPurchaseRequest.findMany({
    where,
    orderBy: [{ requestedAt: 'desc' }],
    select: purchaseRequestSelect,
  });
}

export async function getManufacturerUserId(userId: string | null | undefined): Promise<string | null> {
  if (!userId || userId === 'admin-1') {
    return null;
  }

  const user = await prisma.orderUser.findFirst({
    where: { id: userId, isActive: true, userType: 'manufacturer' },
    select: { id: true },
  });

  return user?.id ?? null;
}

const ORDER_STATUS_EXCLUDED = ['canceled', 'cancelled', 'refunded', 'restored', 'deleted'];
const LIVE_STATS_CONCURRENCY = 6;

type LinkedOrderItemRow = {
  order_record_id: string;
  placed_at: Date | null;
  order_currency: string | null;
  product_id: string | null;
  item: unknown;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function listManufacturerLinkedProductStats(
  userId: string
): Promise<ManufacturerLinkedProductStats[]> {
  const links = await prisma.sallaProductSupplier.findMany({
    where: { userId },
    orderBy: [{ productName: 'asc' }, { updatedAt: 'desc' }],
    select: {
      productId: true,
      productName: true,
      sku: true,
      merchantId: true,
    },
  });

  const linkedProducts = links
    .map((link) => {
      const productId = normalizePositiveInt(link.productId);
      return productId
        ? {
            productId,
            productName: link.productName,
            productSku: link.sku,
            merchantId: link.merchantId,
          }
        : null;
    })
    .filter((link): link is NonNullable<typeof link> => Boolean(link));

  if (linkedProducts.length === 0) {
    return [];
  }

  const productIds = linkedProducts.map((link) => link.productId);

  // Salla API calls (and the orders scan) target the store's resolved merchant, not the
  // supplier link's merchantId — those links are frequently null.
  const resolvedMerchant = await resolveSallaMerchantId();
  const merchantId = resolvedMerchant.merchantId;

  const stats = new Map<number, ManufacturerLinkedProductStats>();
  linkedProducts.forEach((link) => {
    stats.set(link.productId, {
      ...link,
      remainingQuantity: null,
      requestedQuantity: 0,
      onTheWayQuantity: 0,
      totalPurchaseQuantity: 0,
      soldQuantity: 0,
      soldAmount: 0,
      currency: null,
      orderCount: 0,
      lastSoldAt: null,
    });
  });

  // 1) Pending purchase demand — cheap indexed aggregation.
  const purchaseRequests = await prisma.sallaPurchaseRequest.groupBy({
    by: ['productId', 'status'],
    where: {
      productId: { in: productIds },
      status: { in: ['requested', 'on_the_way'] },
    },
    _sum: { quantity: true },
  });

  purchaseRequests.forEach((row) => {
    const stat = stats.get(row.productId);
    if (!stat) {
      return;
    }
    const quantity = row._sum.quantity ?? 0;
    if (row.status === 'requested') {
      stat.requestedQuantity += quantity;
    }
    if (row.status === 'on_the_way') {
      stat.onTheWayQuantity += quantity;
    }
    stat.totalPurchaseQuantity += quantity;
  });

  // 2) Sales — aggregate inside Postgres so we only transfer the line items that match the
  // linked products, instead of pulling every order's full rawOrder JSON into Node.
  if (merchantId) {
    const productIdStrings = productIds.map(String);
    const rows = await prisma.$queryRaw<LinkedOrderItemRow[]>(Prisma.sql`
      SELECT
        o.id AS order_record_id,
        o."placedAt" AS placed_at,
        o.currency AS order_currency,
        COALESCE(
          item->>'product_id', item->>'productId',
          item#>>'{product,id}', item#>>'{product,product_id}', item#>>'{product,productId}'
        ) AS product_id,
        item AS item
      FROM "SallaOrder" o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(o."rawOrder"->'items') = 'array' THEN o."rawOrder"->'items'
          WHEN jsonb_typeof(o."rawOrder"#>'{order,items}') = 'array' THEN o."rawOrder"#>'{order,items}'
          ELSE '[]'::jsonb
        END
      ) AS item
      WHERE o."merchantId" = ${merchantId}
        AND (o."statusSlug" IS NULL OR lower(o."statusSlug") NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDED)}))
        AND COALESCE(
          item->>'product_id', item->>'productId',
          item#>>'{product,id}', item#>>'{product,product_id}', item#>>'{product,productId}'
        ) IN (${Prisma.join(productIdStrings)})
    `);

    const ordersByProduct = new Map<number, Set<string>>();
    for (const row of rows) {
      const productId = normalizePositiveInt(row.product_id);
      if (!productId) {
        continue;
      }
      const stat = stats.get(productId);
      if (!stat) {
        continue;
      }
      const quantity = getRawItemQuantity(row.item);
      stat.soldQuantity += quantity;
      stat.soldAmount += getRawItemTotal(row.item, quantity);
      stat.currency = stat.currency ?? getRawItemCurrency(row.item) ?? row.order_currency ?? null;

      const seen = ordersByProduct.get(productId) ?? new Set<string>();
      seen.add(row.order_record_id);
      ordersByProduct.set(productId, seen);

      if (row.placed_at) {
        const placed = row.placed_at instanceof Date ? row.placed_at : new Date(row.placed_at);
        if (!Number.isNaN(placed.getTime())) {
          const current = stat.lastSoldAt ? new Date(stat.lastSoldAt) : null;
          if (!current || placed.getTime() > current.getTime()) {
            stat.lastSoldAt = placed.toISOString();
          }
        }
      }
    }

    ordersByProduct.forEach((orderSet, productId) => {
      const stat = stats.get(productId);
      if (stat) {
        stat.orderCount = orderSet.size;
      }
    });
  }

  // 3) Remaining stock — fetched live from Salla per product (bounded concurrency).
  if (merchantId) {
    const liveStats = await mapWithConcurrency(linkedProducts, LIVE_STATS_CONCURRENCY, (link) =>
      getSallaProductLiveStats(merchantId, link.productId).catch(() => null)
    );
    liveStats.forEach((live, index) => {
      if (!live) {
        return;
      }
      const stat = stats.get(linkedProducts[index].productId);
      if (stat) {
        stat.remainingQuantity = live.remainingQuantity;
      }
    });
  }

  return Array.from(stats.values()).sort((a, b) => {
    if (b.soldQuantity !== a.soldQuantity) {
      return b.soldQuantity - a.soldQuantity;
    }
    return b.soldAmount - a.soldAmount;
  });
}

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.create({
    data: {
      productId: input.productId,
      productName: input.productName,
      productSku: input.productSku ?? null,
      productImageUrl: input.productImageUrl ?? null,
      variantId: input.variantId ?? null,
      variantName: input.variantName ?? null,
      variantSku: input.variantSku ?? null,
      variantBarcode: input.variantBarcode ?? null,
      variantOptions: input.variantOptions ?? undefined,
      merchantId: input.merchantId ?? null,
      quantity: input.quantity,
      notes: input.notes ?? null,
      requestedBy: input.requestedBy,
      requestedByUser: input.requestedByUser ?? null,
      status: input.status ?? 'requested',
      expectedArrivalAt: input.expectedArrivalAt ?? null,
      movedToWayBy: input.status === 'on_the_way' ? input.requestedBy : null,
      movedToWayAt: input.status === 'on_the_way' ? new Date() : null,
    },
    select: purchaseRequestSelect,
  });
}

export async function incrementPurchaseRequestQuantity(
  id: string,
  by: number
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.update({
    where: { id },
    data: { quantity: { increment: by } },
    select: purchaseRequestSelect,
  });
}

export async function movePurchaseRequestOnTheWay(
  id: string,
  movedToWayBy: string
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.update({
    where: { id },
    data: {
      status: 'on_the_way',
      movedToWayBy,
      movedToWayAt: new Date(),
    },
    select: purchaseRequestSelect,
  });
}

export async function archivePurchaseRequest(
  id: string,
  removedBy: string
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.update({
    where: { id },
    data: {
      status: 'purchased',
      removedBy,
      removedAt: new Date(),
    },
    select: purchaseRequestSelect,
  });
}

export async function deletePurchaseRequest(id: string): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.delete({
    where: { id },
    select: purchaseRequestSelect,
  });
}
