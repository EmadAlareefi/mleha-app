import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

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

function getRawOrderItems(rawOrder: unknown): unknown[] {
  if (!rawOrder || typeof rawOrder !== 'object') {
    return [];
  }
  const order = rawOrder as Record<string, any>;
  if (Array.isArray(order.items)) {
    return order.items;
  }
  if (order.order && typeof order.order === 'object' && Array.isArray(order.order.items)) {
    return order.order.items;
  }
  return [];
}

function getRawItemProductId(item: unknown): number | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, any>;
  return normalizePositiveInt(
    record.product_id ??
      record.productId ??
      record.product?.id ??
      record.product?.product_id ??
      record.product?.productId
  );
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

function getOrderTimestamp(order: { placedAt: Date | null; rawOrder: unknown }): Date | null {
  if (order.placedAt) {
    return order.placedAt;
  }
  const rawOrder = order.rawOrder as Record<string, any> | null;
  if (!rawOrder || typeof rawOrder !== 'object') {
    return null;
  }
  const candidates = [
    rawOrder.date?.created,
    rawOrder.created_at,
    rawOrder.createdAt,
    rawOrder.date?.updated,
    rawOrder.updated_at,
    rawOrder.updatedAt,
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

function shouldCountOrderAsSold(order: { statusSlug: string | null; rawOrder: unknown }): boolean {
  const rawOrder = order.rawOrder as Record<string, any> | null;
  const status = normalizeText(
    order.statusSlug ??
      rawOrder?.status?.slug ??
      rawOrder?.status_slug ??
      rawOrder?.statusSlug
  )?.toLowerCase();

  if (!status) {
    return true;
  }

  return !['canceled', 'cancelled', 'refunded', 'restored', 'deleted'].includes(status);
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
  const linkedProductIdSet = new Set(productIds);
  const merchantIds = Array.from(
    new Set(linkedProducts.map((link) => link.merchantId).filter((value): value is string => Boolean(value)))
  );

  const [purchaseRequests, orders] = await Promise.all([
    prisma.sallaPurchaseRequest.groupBy({
      by: ['productId', 'status'],
      where: {
        productId: { in: productIds },
        status: { in: ['requested', 'on_the_way'] },
      },
      _sum: { quantity: true },
    }),
    prisma.sallaOrder.findMany({
      where: merchantIds.length > 0 ? { merchantId: { in: merchantIds } } : undefined,
      orderBy: [{ placedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        merchantId: true,
        statusSlug: true,
        currency: true,
        placedAt: true,
        rawOrder: true,
      },
    }),
  ]);

  const stats = new Map<number, ManufacturerLinkedProductStats>();
  linkedProducts.forEach((link) => {
    stats.set(link.productId, {
      ...link,
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

  orders.forEach((order) => {
    if (!shouldCountOrderAsSold(order)) {
      return;
    }

    const orderProductIds = new Set<number>();
    const orderDate = getOrderTimestamp(order);

    getRawOrderItems(order.rawOrder).forEach((item) => {
      const productId = getRawItemProductId(item);
      if (!productId || !linkedProductIdSet.has(productId)) {
        return;
      }
      const stat = stats.get(productId);
      if (!stat) {
        return;
      }

      const quantity = getRawItemQuantity(item);
      stat.soldQuantity += quantity;
      stat.soldAmount += getRawItemTotal(item, quantity);
      stat.currency = stat.currency ?? getRawItemCurrency(item) ?? order.currency ?? null;
      orderProductIds.add(productId);

      if (orderDate) {
        const current = stat.lastSoldAt ? new Date(stat.lastSoldAt) : null;
        if (!current || orderDate.getTime() > current.getTime()) {
          stat.lastSoldAt = orderDate.toISOString();
        }
      }
    });

    orderProductIds.forEach((productId) => {
      const stat = stats.get(productId);
      if (stat) {
        stat.orderCount += 1;
      }
    });
  });

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
