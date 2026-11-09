import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { getSallaOrderItems } from '@/app/lib/salla-api';

/**
 * "One per customer" promotion guard.
 *
 * Every product in the promo category (sold at 1 SAR) may be bought at most
 * PROMO_LIMIT_MAX_PER_CUSTOMER times per order, across the whole category. The
 * storefront script on mleha.com blocks it in the cart; order-prep and
 * order-shipping re-check it here in case an order slipped through anyway.
 * Earlier promo orders by the same customer no longer block preparing or
 * shipping a new one — only promo units within the order itself count.
 */

/** "القسم المجاني" on mleha.com — the hidden category holding the 1 SAR products. */
const DEFAULT_PROMO_CATEGORY_IDS = ['289631972'];
const DEFAULT_MAX_PER_CUSTOMER = 1;

/** Orders in these states never shipped, so they don't use up the customer's allowance. */
export const PROMO_EXCLUDED_ORDER_STATUSES = ['canceled', 'cancelled', 'refunded', 'restored', 'deleted'];

/**
 * Products that were in the promo category and dropped out of it once they sold
 * out (seen on 2026-11-03), so the grow-only list below never saw them.
 */
const PREVIOUSLY_PROMO_PRODUCT_IDS: Record<string, string[]> = {
  '289631972': ['1462778376', '2007888048'],
};

const CACHE_SETTINGS_KEY = 'promo_limit.product_ids_cache';
const CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 60;
const MAX_PAGES = 50;

export interface PromoLimitConfig {
  enabled: boolean;
  categoryIds: string[];
  maxPerCustomer: number;
}

/** PROMO_LIMIT_CATEGORY_IDS: comma-separated category ids, or "off" to disable the guard. */
export function getPromoLimitConfig(env: Record<string, string | undefined> = process.env): PromoLimitConfig {
  const rawIds = (env.PROMO_LIMIT_CATEGORY_IDS ?? '').trim();
  if (rawIds.toLowerCase() === 'off') {
    return { enabled: false, categoryIds: [], maxPerCustomer: DEFAULT_MAX_PER_CUSTOMER };
  }
  const categoryIds = rawIds
    ? rawIds.split(',').map((id) => id.trim()).filter((id) => /^\d+$/.test(id))
    : DEFAULT_PROMO_CATEGORY_IDS;
  const parsedMax = Number.parseInt(env.PROMO_LIMIT_MAX_PER_CUSTOMER ?? '', 10);
  const maxPerCustomer = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_PER_CUSTOMER;
  return { enabled: categoryIds.length > 0, categoryIds, maxPerCustomer };
}

// ---------------------------------------------------------------------------
// Promo product ids (cached)
// ---------------------------------------------------------------------------

interface ProductIdsCache {
  key: string;
  productIds: string[];
  fetchedAt: number;
}

let memoryCache: ProductIdsCache | null = null;
let inflight: Promise<string[]> | null = null;

function cacheKeyFor(config: PromoLimitConfig): string {
  return [...config.categoryIds].sort().join(',');
}

type CategoryPage = {
  success?: boolean;
  data?: Array<{ id?: number | string }>;
  pagination?: { total?: number; totalPages?: number; total_pages?: number };
};

const PAGE_CONCURRENCY = 5;

async function fetchCategoryPage(merchantId: string, categoryId: string, page: number): Promise<CategoryPage> {
  // Salla ignores `category=`; only the array form `categories[]=` filters.
  const query = `categories[]=${encodeURIComponent(categoryId)}&per_page=${PAGE_SIZE}&page=${page}`;
  const response = await sallaMakeRequest<CategoryPage>(merchantId, `/products?${query}`);
  if (!response || response.success === false || !Array.isArray(response.data)) {
    throw new Error(`Salla products request failed for category ${categoryId} page ${page}`);
  }
  return response;
}

async function fetchCategoryProductIds(merchantId: string, categoryId: string): Promise<string[]> {
  const ids = new Set<string>();
  const add = (response: CategoryPage) => {
    for (const product of response.data ?? []) {
      if (product?.id != null) ids.add(String(product.id));
    }
  };
  // Page 1 gives the page count; the rest load a few at a time in parallel
  // (one at a time took ~30s for ~300 products).
  const first = await fetchCategoryPage(merchantId, categoryId, 1);
  add(first);
  const total = typeof first.pagination?.total === 'number' ? first.pagination.total : Infinity;
  const totalPages = Math.min(
    MAX_PAGES,
    first.pagination?.totalPages ?? first.pagination?.total_pages ?? (Number.isFinite(total) ? Math.ceil(total / PAGE_SIZE) : 1)
  );
  for (let start = 2; start <= totalPages; start += PAGE_CONCURRENCY) {
    const pages = Array.from({ length: Math.min(PAGE_CONCURRENCY, totalPages - start + 1) }, (_, index) => start + index);
    (await Promise.all(pages.map((page) => fetchCategoryPage(merchantId, categoryId, page)))).forEach(add);
  }
  if (Number.isFinite(total) && ids.size < total) {
    log.warn('Promo category listing returned fewer products than reported', {
      categoryId,
      collected: ids.size,
      total,
    });
  }
  return Array.from(ids);
}

async function readPersistedCache(): Promise<ProductIdsCache | null> {
  try {
    const row = await prisma.settings.findUnique({ where: { key: CACHE_SETTINGS_KEY } });
    if (!row) return null;
    const parsed = JSON.parse(row.value) as ProductIdsCache;
    return Array.isArray(parsed?.productIds) ? parsed : null;
  } catch {
    return null;
  }
}

async function writePersistedCache(cache: ProductIdsCache): Promise<void> {
  try {
    const value = JSON.stringify(cache);
    await prisma.settings.upsert({
      where: { key: CACHE_SETTINGS_KEY },
      create: { key: CACHE_SETTINGS_KEY, value, description: 'Cached product ids of the one-per-customer promo category' },
      update: { value },
    });
  } catch (error) {
    log.warn('Failed to persist promo product id cache', { error });
  }
}

/** Union of id lists, in first-seen order. */
export function mergePromoProductIds(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat().map(String)));
}

/**
 * Product ids that are or ever were in the promo category(ies). The list only
 * grows: Salla drops a sold-out product from the category, and forgetting it
 * would let its buyer take another promo item. Refreshed from Salla every 10
 * minutes (memory + Settings table); if Salla is unreachable the last known list
 * is used, so a Salla outage never silently switches the guard off.
 */
export async function getPromoProductIds(
  merchantId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<string[]> {
  const config = getPromoLimitConfig();
  if (!config.enabled) return [];
  const key = cacheKeyFor(config);
  const now = Date.now();

  if (!options.forceRefresh && memoryCache?.key === key && now - memoryCache.fetchedAt < CACHE_TTL_MS) {
    return memoryCache.productIds;
  }

  const persisted = await readPersistedCache();
  if (!options.forceRefresh && persisted?.key === key && now - persisted.fetchedAt < CACHE_TTL_MS) {
    memoryCache = persisted;
    return persisted.productIds;
  }

  // Stale-while-revalidate: with any earlier list on hand, answer with it at
  // once and refresh in the background. The list only grows, so a slightly old
  // one is safe, and no staff page waits on Salla for it.
  const stale = memoryCache?.key === key ? memoryCache : persisted?.key === key ? persisted : null;
  if (stale && !options.forceRefresh) {
    if (memoryCache !== stale) memoryCache = stale;
    void refreshPromoProductIds(merchantId, config, key, persisted).catch(() => undefined);
    return stale.productIds;
  }
  return refreshPromoProductIds(merchantId, config, key, persisted);
}

function refreshPromoProductIds(
  merchantId: string,
  config: PromoLimitConfig,
  key: string,
  persisted: ProductIdsCache | null
): Promise<string[]> {
  if (!inflight) {
    inflight = (async () => {
      try {
        const lists = await Promise.all(
          config.categoryIds.map((categoryId) => fetchCategoryProductIds(merchantId, categoryId))
        );
        // Grow-only: a product leaves the category when it sells out, but the
        // customers who bought it must still have used their allowance.
        const productIds = mergePromoProductIds(
          lists.flat(),
          persisted?.key === key ? persisted.productIds : [],
          memoryCache?.key === key ? memoryCache.productIds : [],
          config.categoryIds.flatMap((categoryId) => PREVIOUSLY_PROMO_PRODUCT_IDS[categoryId] ?? [])
        );
        const fresh: ProductIdsCache = { key, productIds, fetchedAt: Date.now() };
        memoryCache = fresh;
        await writePersistedCache(fresh);
        return productIds;
      } catch (error) {
        const stale = memoryCache?.key === key ? memoryCache : persisted?.key === key ? persisted : null;
        log.error('Failed to refresh promo category product ids', {
          error: error instanceof Error ? error.message : error,
          usingStale: Boolean(stale),
        });
        if (stale) return stale.productIds;
        throw error;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export interface PromoLineItem {
  productId: string | null;
  quantity: number;
  name?: string | null;
  sku?: string | null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function idString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/** Line items from a Salla order payload (webhook body, /orders/{id} detail or prep orderData). */
export function extractPromoLineItems(orderData: unknown): PromoLineItem[] {
  let order = asRecord(orderData);
  if (!order) return [];
  if (asRecord(order.data)) order = asRecord(order.data)!;
  if (asRecord(order.order)) order = asRecord(order.order)!;
  const items = Array.isArray(order.items) ? order.items : [];
  return items
    .map((raw: unknown) => {
      const item = asRecord(raw) || {};
      const product = asRecord(item.product) || {};
      const quantity = Number(item.quantity);
      return {
        productId: idString(product.id) ?? idString(item.product_id),
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
        name: typeof item.name === 'string' ? item.name : typeof product.name === 'string' ? product.name : null,
        sku: typeof item.sku === 'string' ? item.sku : typeof product.sku === 'string' ? product.sku : null,
      };
    })
    .filter((item: PromoLineItem) => item.quantity > 0);
}

export function countPromoUnits(items: PromoLineItem[], promoIds: Set<string>): number {
  return items.reduce((sum, item) => (item.productId && promoIds.has(item.productId) ? sum + item.quantity : sum), 0);
}

// ---------------------------------------------------------------------------
// Customer history
// ---------------------------------------------------------------------------

export interface PromoPriorOrder {
  orderId: string;
  orderNumber: string | null;
  placedAt: string | null;
  statusName: string | null;
  quantity: number;
}

/**
 * Earlier (non-cancelled) orders of the same customer containing promo items.
 * Matches by Salla customer id, and by mobile/email when given, so a second
 * account with the same phone is still caught on the staff side.
 */
export async function findPriorPromoOrders(params: {
  merchantId: string;
  promoProductIds: string[];
  customerId?: string | null;
  customerMobile?: string | null;
  customerEmail?: string | null;
  excludeOrderId?: string | null;
  placedBefore?: Date | null;
}): Promise<PromoPriorOrder[]> {
  const { merchantId, promoProductIds } = params;
  if (promoProductIds.length === 0) return [];

  const identity: Array<Record<string, string>> = [];
  if (params.customerId) identity.push({ customerId: params.customerId });
  if (params.customerMobile) identity.push({ customerMobile: params.customerMobile });
  if (params.customerEmail) identity.push({ customerEmail: params.customerEmail });
  if (identity.length === 0) return [];

  const items = await prisma.sallaOrderItem.findMany({
    where: {
      merchantId,
      productId: { in: promoProductIds },
      ...(params.excludeOrderId ? { orderId: { not: params.excludeOrderId } } : {}),
      order: {
        AND: [
          { OR: identity },
          // Spelled out so orders with no status yet (NULL) still count — a bare
          // NOT IN would silently drop them in SQL.
          { OR: [{ statusSlug: null }, { statusSlug: { notIn: PROMO_EXCLUDED_ORDER_STATUSES } }] },
        ],
        ...(params.placedBefore ? { placedAt: { lt: params.placedBefore } } : {}),
      },
    },
    select: {
      orderId: true,
      quantity: true,
      order: { select: { orderNumber: true, placedAt: true, statusName: true } },
    },
  });

  const byOrder = new Map<string, PromoPriorOrder>();
  for (const item of items) {
    const existing = byOrder.get(item.orderId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      byOrder.set(item.orderId, {
        orderId: item.orderId,
        orderNumber: item.order.orderNumber,
        placedAt: item.order.placedAt ? item.order.placedAt.toISOString() : null,
        statusName: item.order.statusName,
        quantity: item.quantity,
      });
    }
  }
  return Array.from(byOrder.values()).sort((a, b) => (a.placedAt || '').localeCompare(b.placedAt || ''));
}

// ---------------------------------------------------------------------------
// Staff-side order check (order-prep / order-shipping)
// ---------------------------------------------------------------------------

export interface PromoOrderCheck {
  enabled: boolean;
  violation: boolean;
  maxPerCustomer: number;
  promoUnitsInOrder: number;
  promoItems: Array<{ productId: string; name: string | null; sku: string | null; quantity: number }>;
  priorOrders: PromoPriorOrder[];
  priorUnits: number;
  message: string | null;
  /** True when the promo list could not be loaded; the check is then inconclusive. */
  unavailable?: boolean;
}

export function buildPromoViolationMessage(check: Pick<PromoOrderCheck, 'maxPerCustomer' | 'promoUnitsInOrder'>): string {
  return `هذا الطلب يحتوي على ${check.promoUnitsInOrder} قطع من عرض الريال الواحد. الحد المسموح ${check.maxPerCustomer} قطعة فقط في الطلب من قسم العرض. لا تقم بتجهيز أو شحن القطع الزائدة قبل مراجعة الطلب.`;
}

export function evaluatePromoUsage(input: {
  maxPerCustomer: number;
  items: PromoLineItem[];
  promoIds: Set<string>;
  priorOrders: PromoPriorOrder[];
}): Omit<PromoOrderCheck, 'enabled'> {
  const promoItems = input.items
    .filter((item) => item.productId && input.promoIds.has(item.productId))
    .map((item) => ({ productId: item.productId!, name: item.name ?? null, sku: item.sku ?? null, quantity: item.quantity }));
  const promoUnitsInOrder = promoItems.reduce((sum, item) => sum + item.quantity, 0);
  const priorOrders = promoUnitsInOrder > 0 ? input.priorOrders : [];
  const priorUnits = priorOrders.reduce((sum, order) => sum + order.quantity, 0);
  // Earlier promo orders are reported but never block: only this order's units count.
  const violation = promoUnitsInOrder > input.maxPerCustomer;
  const base = { maxPerCustomer: input.maxPerCustomer, promoUnitsInOrder, promoItems, priorOrders, priorUnits };
  return { ...base, violation, message: violation ? buildPromoViolationMessage(base) : null };
}

/**
 * Checks one order against the promo limit. Items come from the order payload
 * the staff page is looking at when given, else the stored line items, else a
 * live Salla fetch. Only the units in this order count; a customer's earlier
 * promo orders do not block it.
 */
export async function checkOrderPromoLimit(params: {
  merchantId: string;
  orderId: string;
  orderData?: unknown;
  /**
   * false when `orderData` was just fetched from Salla (prep assignment): its
   * items are trusted first and no second live request is made.
   */
  fetchLive?: boolean;
}): Promise<PromoOrderCheck> {
  const config = getPromoLimitConfig();
  const empty: PromoOrderCheck = {
    enabled: config.enabled,
    violation: false,
    maxPerCustomer: config.maxPerCustomer,
    promoUnitsInOrder: 0,
    promoItems: [],
    priorOrders: [],
    priorUnits: 0,
    message: null,
  };
  if (!config.enabled) return empty;

  let promoProductIds: string[];
  try {
    promoProductIds = await getPromoProductIds(params.merchantId);
  } catch {
    return { ...empty, unavailable: true };
  }
  const promoIds = new Set(promoProductIds);

  const storedOrder = await prisma.sallaOrder.findUnique({
    where: { merchantId_orderId: { merchantId: params.merchantId, orderId: params.orderId } },
    select: {
      customerId: true,
      customerMobile: true,
      customerEmail: true,
      placedAt: true,
      items: { select: { productId: true, quantity: true, name: true, sku: true } },
    },
  });

  // Live Salla items first: once staff remove the extra promo items in Salla the
  // order must pass, and a prep/shipping snapshot taken earlier would still show
  // them. Stored webhook items, then the caller's snapshot, are fallbacks.
  const stored = () => (storedOrder?.items ?? []).map((item) => ({ ...item, quantity: item.quantity }));
  let items: PromoLineItem[];
  if (params.fetchLive === false) {
    items = extractPromoLineItems(params.orderData);
    if (items.length === 0) items = stored();
  } else {
    const live = await getSallaOrderItems(params.merchantId, params.orderId).catch(() => null);
    items = extractPromoLineItems({ items: live || [] });
    if (items.length === 0) items = stored();
    if (items.length === 0) items = extractPromoLineItems(params.orderData);
  }

  if (countPromoUnits(items, promoIds) === 0) return empty;

  // Earlier promo orders by the customer don't block this one, so they are not looked up.
  return { enabled: true, ...evaluatePromoUsage({ maxPerCustomer: config.maxPerCustomer, items, promoIds, priorOrders: [] }) };
}

/** Error code returned by guarded staff endpoints when the order breaks the promo limit. */
export const PROMO_LIMIT_ERROR_CODE = 'PROMO_LIMIT_EXCEEDED';

/**
 * Shared server guard for staff actions (completing prep, creating shipments).
 * Returns the 409 body when the order breaks the promo limit — there is no
 * override: the order has to be fixed in Salla (extra promo items removed)
 * before it can be prepared or shipped. Returns
 * null when the action may proceed. A check that errors out is logged and
 * allowed, so a Salla outage never stops the warehouse.
 */
export async function promoLimitBlock(params: {
  merchantId: string;
  orderId: string;
  orderData?: unknown;
  context: string;
  userId?: string | null;
  orderNumber?: string | null;
}): Promise<{ code: string; error: string; promoLimit: PromoOrderCheck } | null> {
  try {
    const check = await checkOrderPromoLimit({
      merchantId: params.merchantId,
      orderId: params.orderId,
      orderData: params.orderData,
    });
    if (!check.violation) return null;
    const details = {
      context: params.context,
      orderId: params.orderId,
      orderNumber: params.orderNumber ?? null,
      userId: params.userId ?? null,
      promoUnitsInOrder: check.promoUnitsInOrder,
      priorOrders: check.priorOrders.map((order) => order.orderNumber || order.orderId),
    };
    log.warn('Blocked staff action on promo limit violation', details);
    return { code: PROMO_LIMIT_ERROR_CODE, error: check.message || 'تجاوز حد عرض الريال', promoLimit: check };
  } catch (error) {
    log.error('Promo limit guard failed; allowing action', {
      context: params.context,
      orderId: params.orderId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
