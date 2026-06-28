import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import {
  getSallaProductBySku,
  getSallaProductVariations,
  listSallaProducts,
  searchSallaProductsBySku,
  type SallaProductSummary,
  type SallaProductVariation,
} from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const MAX_PRODUCTS = 20;
const MAX_ORDER_SCAN = 1500;
const MAX_ORDERS_PER_PRODUCT = 80;

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeSku(value: unknown): string | null {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  return null;
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
  const parsed = normalizeNumber(
    record.product_id ??
      record.productId ??
      record.product?.id ??
      record.product?.product_id ??
      record.product?.productId
  );
  return parsed && parsed > 0 ? Math.floor(parsed) : null;
}

function getRawItemQuantity(item: unknown): number {
  if (!item || typeof item !== 'object') {
    return 1;
  }
  const record = item as Record<string, any>;
  const parsed = normalizeNumber(record.quantity ?? record.qty);
  return parsed && parsed > 0 ? Math.floor(parsed) : 1;
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
  const price = normalizeNumber(
    record.amounts?.price_without_tax?.amount ??
      record.price?.amount ??
      record.price ??
      record.product?.price?.amount ??
      record.product?.price
  );
  return price != null ? price * quantity : 0;
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

function getRawItemSku(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, any>;
  return normalizeSku(record.sku ?? record.product?.sku ?? record.variant?.sku ?? record.variant_sku);
}

function getRawItemName(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, any>;
  return normalizeText(record.name ?? record.product?.name);
}

function getRawItemVariantName(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, any>;
  return normalizeText(record.variant?.name ?? record.variant_name ?? record.option);
}

function getOrderTimestamp(order: { placedAt: Date | null; updatedAtRemote: Date | null; rawOrder: unknown }) {
  if (order.placedAt) {
    return order.placedAt;
  }
  if (order.updatedAtRemote) {
    return order.updatedAtRemote;
  }
  const rawOrder = order.rawOrder as Record<string, any> | null;
  const candidates = [
    rawOrder?.date?.created,
    rawOrder?.created_at,
    rawOrder?.createdAt,
    rawOrder?.date?.updated,
    rawOrder?.updated_at,
    rawOrder?.updatedAt,
  ];
  for (const value of candidates) {
    const text = normalizeText(value);
    if (!text) {
      continue;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function dedupeProducts(products: Array<SallaProductSummary | null | undefined>) {
  const seen = new Set<number>();
  const result: SallaProductSummary[] = [];
  for (const product of products) {
    if (!product || !Number.isFinite(product.id) || seen.has(product.id)) {
      continue;
    }
    seen.add(product.id);
    result.push(product);
    if (result.length >= MAX_PRODUCTS) {
      break;
    }
  }
  return result;
}

async function fetchVariations(merchantId: string, products: SallaProductSummary[]) {
  const entries = await Promise.allSettled(
    products.map(async (product) => ({
      productId: product.id,
      variations: await getSallaProductVariations(merchantId, product.id),
    }))
  );

  const variations: Record<number, SallaProductVariation[]> = {};
  const failed: Array<{ productId: number; message: string }> = [];

  entries.forEach((entry) => {
    if (entry.status === 'fulfilled') {
      variations[entry.value.productId] = entry.value.variations;
    } else {
      log.warn('Product search could not load variations', { error: entry.reason });
    }
  });

  products.forEach((product) => {
    if (!variations[product.id]) {
      variations[product.id] = Array.isArray(product.variations) ? product.variations : [];
      if (variations[product.id].length === 0) {
        failed.push({ productId: product.id, message: 'تعذر تحميل متغيرات المنتج' });
      }
    }
  });

  return { variations, failed };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = normalizeText(searchParams.get('q'));
    const requestedMerchant = searchParams.get('merchantId');

    if (!query) {
      return NextResponse.json({ error: 'يرجى إدخال اسم المنتج أو SKU' }, { status: 400 });
    }

    const resolved = await resolveSallaMerchantId(requestedMerchant);
    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const [exactProduct, skuMatches, keywordResult] = await Promise.all([
      getSallaProductBySku(resolved.merchantId, query).catch(() => null),
      searchSallaProductsBySku(resolved.merchantId, query, {
        perPage: 50,
        maxResults: MAX_PRODUCTS,
      }).catch(() => []),
      listSallaProducts(resolved.merchantId, {
        page: 1,
        perPage: MAX_PRODUCTS,
        keyword: query,
      }).catch(() => ({ products: [] as SallaProductSummary[], pagination: null })),
    ]);

    const products = dedupeProducts([
      exactProduct,
      ...skuMatches,
      ...keywordResult.products,
    ]);

    if (products.length === 0) {
      return NextResponse.json({
        success: true,
        merchantId: resolved.merchantId,
        query,
        products: [],
        variationErrors: [],
        scannedOrders: 0,
      });
    }

    const productIds = products.map((product) => product.id);
    const { variations, failed } = await fetchVariations(resolved.merchantId, products);
    const productIdsSet = new Set(productIds);
    const skuToProductIds = new Map<string, number[]>();

    products.forEach((product) => {
      const productSku = normalizeSku(product.sku);
      if (productSku) {
        skuToProductIds.set(productSku, [...(skuToProductIds.get(productSku) ?? []), product.id]);
      }
      (variations[product.id] ?? []).forEach((variation) => {
        const variantSku = normalizeSku(variation.sku);
        if (variantSku) {
          skuToProductIds.set(variantSku, [...(skuToProductIds.get(variantSku) ?? []), product.id]);
        }
      });
    });

    const [purchaseRequests, orders] = await Promise.all([
      prisma.sallaPurchaseRequest.findMany({
        where: {
          productId: { in: productIds },
          status: { in: ['requested', 'on_the_way'] },
        },
        orderBy: [{ requestedAt: 'desc' }],
      }),
      prisma.sallaOrder.findMany({
        where: { merchantId: resolved.merchantId },
        orderBy: [{ placedAt: 'desc' }, { createdAt: 'desc' }],
        take: MAX_ORDER_SCAN,
        select: {
          id: true,
          orderId: true,
          orderNumber: true,
          referenceId: true,
          statusSlug: true,
          statusName: true,
          currency: true,
          totalAmount: true,
          customerName: true,
          customerMobile: true,
          placedAt: true,
          updatedAtRemote: true,
          rawOrder: true,
        },
      }),
    ]);

    const requestsByProductId = new Map<number, typeof purchaseRequests>();
    purchaseRequests.forEach((purchaseRequest) => {
      requestsByProductId.set(purchaseRequest.productId, [
        ...(requestsByProductId.get(purchaseRequest.productId) ?? []),
        purchaseRequest,
      ]);
    });

    const ordersByProductId = new Map<number, any[]>();

    orders.forEach((order) => {
      const orderedAt = getOrderTimestamp(order);
      getRawOrderItems(order.rawOrder).forEach((item) => {
        const itemProductId = getRawItemProductId(item);
        const itemSku = getRawItemSku(item);
        const matchedProductIds = itemProductId && productIdsSet.has(itemProductId)
          ? [itemProductId]
          : itemSku
            ? skuToProductIds.get(itemSku) ?? []
            : [];

        matchedProductIds.forEach((productId) => {
          const current = ordersByProductId.get(productId) ?? [];
          if (current.length >= MAX_ORDERS_PER_PRODUCT) {
            return;
          }
          const quantity = getRawItemQuantity(item);
          current.push({
            orderRecordId: order.id,
            orderId: order.orderId,
            orderNumber: order.orderNumber,
            referenceId: order.referenceId,
            orderedAt: orderedAt?.toISOString() ?? null,
            statusSlug: order.statusSlug,
            statusName: order.statusName,
            customerName: order.customerName,
            customerMobile: order.customerMobile,
            itemName: getRawItemName(item),
            itemSku,
            variantName: getRawItemVariantName(item),
            quantity,
            totalAmount: getRawItemTotal(item, quantity),
            currency: getRawItemCurrency(item) ?? order.currency,
            orderTotalAmount: normalizeNumber(order.totalAmount),
          });
          ordersByProductId.set(productId, current);
        });
      });
    });

    const enrichedProducts = products.map((product) => {
      const productOrders = ordersByProductId.get(product.id) ?? [];
      const productRequests = requestsByProductId.get(product.id) ?? [];
      const requestedQuantity = productRequests
        .filter((entry) => entry.status === 'requested')
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const onTheWayQuantity = productRequests
        .filter((entry) => entry.status === 'on_the_way')
        .reduce((sum, entry) => sum + entry.quantity, 0);
      const soldQuantity = productOrders.reduce((sum, entry) => sum + entry.quantity, 0);
      const soldAmount = productOrders.reduce((sum, entry) => sum + entry.totalAmount, 0);

      return {
        product: {
          ...product,
          variations: variations[product.id] ?? product.variations ?? [],
        },
        stats: {
          orderCount: new Set(productOrders.map((entry) => entry.orderRecordId)).size,
          soldQuantity,
          soldAmount,
          requestedQuantity,
          onTheWayQuantity,
          activePurchaseRequests: productRequests.length,
          lastOrderedAt: productOrders[0]?.orderedAt ?? null,
        },
        orders: productOrders,
        purchaseRequests: productRequests,
      };
    });

    return NextResponse.json({
      success: true,
      merchantId: resolved.merchantId,
      query,
      products: enrichedProducts,
      variationErrors: failed,
      scannedOrders: orders.length,
    });
  } catch (error) {
    log.error('Failed to search Salla products with order context', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'تعذر البحث عن المنتجات' },
      { status: 500 }
    );
  }
}
