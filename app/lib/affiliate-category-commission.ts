import { Prisma } from '@prisma/client';
import { getCategoryNamesByProductId } from '@/lib/returns/policy';
import { isNationalDayOffersCategory } from '@/app/lib/affiliate-metrics';

type AffiliateOrderWithItems = {
  id: string;
  merchantId: string;
  items: Array<{
    productId: string | null;
    totalAmount: Prisma.Decimal | number | null;
  }>;
};

/**
 * Category membership is looked up product by product against the Salla API, so an
 * affiliate dashboard covering hundreds of orders would otherwise refetch the same
 * products on every load. Cache the National Day verdict per product for a few minutes
 * and resolve unknown products in bounded batches.
 */
const CATEGORY_CACHE_TTL_MS = 10 * 60 * 1000;
const PRODUCT_LOOKUP_BATCH_SIZE = 20;

const nationalDayProductCache = new Map<string, { isNationalDay: boolean; expiresAt: number }>();

const cacheKey = (merchantId: string, productId: string) => `${merchantId}:${productId}`;

function readCachedVerdict(merchantId: string, productId: string): boolean | null {
  const entry = nationalDayProductCache.get(cacheKey(merchantId, productId));
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    nationalDayProductCache.delete(cacheKey(merchantId, productId));
    return null;
  }
  return entry.isNationalDay;
}

async function resolveNationalDayProductIds(
  merchantId: string,
  productIds: string[]
): Promise<Set<string>> {
  const nationalDayProductIds = new Set<string>();
  const unresolved: string[] = [];

  for (const productId of productIds) {
    const cached = readCachedVerdict(merchantId, productId);
    if (cached === null) {
      unresolved.push(productId);
    } else if (cached) {
      nationalDayProductIds.add(productId);
    }
  }

  for (let index = 0; index < unresolved.length; index += PRODUCT_LOOKUP_BATCH_SIZE) {
    const batch = unresolved.slice(index, index + PRODUCT_LOOKUP_BATCH_SIZE);
    const categories = await getCategoryNamesByProductId(merchantId, batch);
    const expiresAt = Date.now() + CATEGORY_CACHE_TTL_MS;
    for (const productId of batch) {
      const names = categories[productId] ?? [];
      const isNationalDay = names.some(isNationalDayOffersCategory);
      nationalDayProductCache.set(cacheKey(merchantId, productId), { isNationalDay, expiresAt });
      if (isNationalDay) {
        nationalDayProductIds.add(productId);
      }
    }
  }

  return nationalDayProductIds;
}

/** Returns the National Day line-item total to remove from each order's commission base. */
export async function getExcludedNationalDayAmounts(
  orders: AffiliateOrderWithItems[]
): Promise<Map<string, number>> {
  const productIdsByMerchant = new Map<string, Set<string>>();
  for (const order of orders) {
    const productIds = productIdsByMerchant.get(order.merchantId) ?? new Set<string>();
    for (const item of order.items) {
      if (item.productId) productIds.add(item.productId);
    }
    productIdsByMerchant.set(order.merchantId, productIds);
  }

  const nationalDayProductsByMerchant = new Map<string, Set<string>>();
  await Promise.all(
    Array.from(productIdsByMerchant.entries()).map(async ([merchantId, productIds]) => {
      nationalDayProductsByMerchant.set(
        merchantId,
        await resolveNationalDayProductIds(merchantId, Array.from(productIds))
      );
    })
  );

  const excludedByOrder = new Map<string, number>();
  for (const order of orders) {
    const nationalDayProductIds = nationalDayProductsByMerchant.get(order.merchantId);
    const excluded = order.items.reduce((sum, item) => {
      if (!item.productId || !nationalDayProductIds?.has(item.productId)) return sum;
      return sum + Number(item.totalAmount ?? 0);
    }, 0);
    excludedByOrder.set(order.id, excluded);
  }
  return excludedByOrder;
}
