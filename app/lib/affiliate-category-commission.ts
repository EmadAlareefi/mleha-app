import { Prisma } from '@prisma/client';
import { log } from '@/app/lib/logger';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { isNationalDayOffersCategory } from '@/app/lib/affiliate-metrics';

type AffiliateOrderWithItems = {
  id: string;
  merchantId: string;
  items: Array<{
    productId: string | null;
    totalAmount: Prisma.Decimal | number | null;
  }>;
};

type CategoryProductsPage = {
  productIds: string[];
  totalPages: number;
};

/**
 * Looking products up one by one (`/products/:id`) made wide date ranges fire hundreds
 * of Salla requests, which hit 429s, timeouts and out-of-memory kills. Instead, list the
 * National Day category's products once per merchant (a handful of pages) and cache the
 * id set. Salla ignores `category=`; `categories[]=` is the filter that works, and the
 * token has no categories.read scope, so the category id cannot be resolved by name.
 */
export const NATIONAL_DAY_OFFERS_CATEGORY_ID = '273740384';
const CATEGORY_CACHE_TTL_MS = 10 * 60 * 1000;
const PRODUCTS_PER_PAGE = 65; // Salla clamps /products to 65 per page.
const PAGE_CONCURRENCY = 4;
const PAGE_ATTEMPTS = 3;

const nationalDayProductCache = new Map<string, { productIds: Set<string>; expiresAt: number }>();
const inFlightLookups = new Map<string, Promise<Set<string>>>();

async function fetchNationalDayProductsPage(
  merchantId: string,
  page: number
): Promise<CategoryProductsPage> {
  const query = new URLSearchParams({ per_page: String(PRODUCTS_PER_PAGE), page: String(page) });
  query.append('categories[]', NATIONAL_DAY_OFFERS_CATEGORY_ID);
  const endpoint = `/products?${query.toString()}`;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await sallaMakeRequest<{
        data?: Array<{ id?: number | string; categories?: Array<{ name?: string }> }>;
        pagination?: { totalPages?: number; total_pages?: number };
      }>(merchantId, endpoint, { throwOnError: true });
      // Keep only ids so full product payloads can be collected page by page.
      const productIds = (response?.data ?? [])
        .filter((product) =>
          product.categories?.some((category) => isNationalDayOffersCategory(String(category?.name ?? '')))
        )
        .map((product) => String(product.id ?? ''))
        .filter(Boolean);
      return {
        productIds,
        totalPages: response?.pagination?.totalPages ?? response?.pagination?.total_pages ?? 1,
      };
    } catch (error) {
      if (attempt >= PAGE_ATTEMPTS) throw error;
      // Mostly transient 429s; back off before retrying.
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

export async function loadNationalDayProductIds(
  merchantId: string,
  fetchPage: (merchantId: string, page: number) => Promise<CategoryProductsPage> = fetchNationalDayProductsPage
): Promise<Set<string>> {
  const first = await fetchPage(merchantId, 1);
  const productIds = new Set(first.productIds);

  for (let page = 2; page <= first.totalPages; page += PAGE_CONCURRENCY) {
    const pages = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, first.totalPages - page + 1) },
      (_, index) => page + index
    );
    const results = await Promise.all(pages.map((pageNumber) => fetchPage(merchantId, pageNumber)));
    results.forEach((result) => result.productIds.forEach((productId) => productIds.add(productId)));
  }

  if (productIds.size === 0) {
    log.warn('National Day offers category returned no products', {
      merchantId,
      categoryId: NATIONAL_DAY_OFFERS_CATEGORY_ID,
    });
  }
  return productIds;
}

async function getNationalDayProductIds(merchantId: string): Promise<Set<string>> {
  const cached = nationalDayProductCache.get(merchantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.productIds;
  }

  let pending = inFlightLookups.get(merchantId);
  if (!pending) {
    pending = loadNationalDayProductIds(merchantId)
      .then((productIds) => {
        nationalDayProductCache.set(merchantId, { productIds, expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS });
        return productIds;
      })
      .finally(() => inFlightLookups.delete(merchantId));
    inFlightLookups.set(merchantId, pending);
  }

  try {
    return await pending;
  } catch (error) {
    if (cached) {
      log.warn('Using stale National Day product list after Salla lookup failed', { merchantId, error });
      return cached.productIds;
    }
    throw error;
  }
}

/** Returns the National Day line-item total to remove from each order's commission base. */
export async function getExcludedNationalDayAmounts(
  orders: AffiliateOrderWithItems[],
  resolveProductIds: (merchantId: string) => Promise<Set<string>> = getNationalDayProductIds
): Promise<Map<string, number>> {
  const merchantIds = new Set(
    orders.filter((order) => order.items.some((item) => item.productId)).map((order) => order.merchantId)
  );

  const nationalDayProductsByMerchant = new Map<string, Set<string>>();
  await Promise.all(
    Array.from(merchantIds).map(async (merchantId) => {
      nationalDayProductsByMerchant.set(merchantId, await resolveProductIds(merchantId));
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
