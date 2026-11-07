import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { isOneRiyalOfferCategory, normalizeCategoryName } from '@/lib/returns/categories';

/**
 * Store catalog for the replacement picker on /returns. Read-only and public
 * (it is the same catalog the storefront shows), cached briefly per instance.
 * Prices are VAT-inclusive, as the customer sees them.
 */

export interface CatalogOptionValue {
  id: string;
  name: string;
}
export interface CatalogOption {
  id: string;
  name: string;
  values: CatalogOptionValue[];
}
export interface CatalogSku {
  id: string;
  sku: string | null;
  optionValueIds: string[];
  price: number;
  regularPrice: number;
  stock: number | null; // null = unlimited
  inStock: boolean;
}
export interface CatalogProductSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  price: number;
  regularPrice: number;
  currency: string;
}
export interface CatalogProduct extends CatalogProductSummary {
  images: string[];
  options: CatalogOption[];
  skus: CatalogSku[];
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}
export function clearExchangeCatalogCache() {
  cache.clear();
}

const amount = (value: any): number => {
  const raw = typeof value === 'object' && value !== null ? value.amount ?? value.value : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Sale price when there is a real discount, else the regular price. */
export function effectivePrice(regular: number, sale: number): number {
  return sale > 0 && (regular <= 0 || sale < regular) ? sale : regular;
}

const excludedCategoryNames = () =>
  new Set(
    (process.env.RETURNS_EXCHANGE_EXCLUDED_CATEGORIES || '')
      .split(',')
      .map((name) => normalizeCategoryName(name))
      .filter((name): name is string => Boolean(name)),
  );

export function isExcludedProduct(raw: any): boolean {
  const names: string[] = [
    raw?.category,
    ...((Array.isArray(raw?.categories) ? raw.categories : []).map((c: any) => c?.name)),
  ].filter(Boolean);
  const excluded = excludedCategoryNames();
  return names.some((name) => isOneRiyalOfferCategory(name) || excluded.has(normalizeCategoryName(name) || ''));
}

export function isSellable(raw: any): boolean {
  const status = String(raw?.status || 'sale');
  return status === 'sale' && raw?.is_available !== false && !raw?.hidden;
}

export function normalizeSummary(raw: any): CatalogProductSummary {
  const regular = amount(raw?.regular_price ?? raw?.price);
  const sale = amount(raw?.sale_price);
  return {
    id: String(raw?.id),
    name: String(raw?.name || ''),
    imageUrl: raw?.main_image || raw?.thumbnail || raw?.image?.url || raw?.images?.[0]?.url || null,
    price: effectivePrice(regular, sale),
    regularPrice: regular,
    currency: raw?.price?.currency || raw?.currency || 'SAR',
  };
}

export function normalizeProduct(raw: any): CatalogProduct {
  const summary = normalizeSummary(raw);
  const options: CatalogOption[] = (Array.isArray(raw?.options) ? raw.options : []).map((option: any) => ({
    id: String(option?.id),
    name: String(option?.name || ''),
    values: (Array.isArray(option?.values) ? option.values : []).map((value: any) => ({
      id: String(value?.id),
      name: String(value?.name || value?.display_value || ''),
    })),
  }));
  const unlimited = raw?.unlimited_quantity === true;
  const skus: CatalogSku[] = (Array.isArray(raw?.skus) ? raw.skus : []).map((sku: any) => {
    // On SKUs `price` is the current selling price and `regular_price` the
    // pre-discount one (live data: price 69, regular_price 270).
    const current = amount(sku?.price) || summary.price;
    const sale = amount(sku?.sale_price);
    const price = sale > 0 && sale < current ? sale : current;
    const regular = Math.max(amount(sku?.regular_price), current, summary.regularPrice);
    const stock = unlimited || sku?.unlimited_quantity ? null : Number(sku?.stock_quantity ?? sku?.quantity ?? 0);
    return {
      id: String(sku?.id),
      sku: sku?.sku ? String(sku.sku) : null,
      optionValueIds: (Array.isArray(sku?.related_option_values) ? sku.related_option_values : []).map(String),
      price,
      regularPrice: regular,
      stock,
      inStock: stock === null || stock > 0,
    };
  });
  // Products without options have no SKU rows; treat the product itself as one SKU.
  if (skus.length === 0) {
    const stock = unlimited ? null : Number(raw?.quantity ?? 0);
    skus.push({
      id: summary.id,
      sku: raw?.sku ? String(raw.sku) : null,
      optionValueIds: [],
      price: summary.price,
      regularPrice: summary.regularPrice,
      stock,
      inStock: stock === null || stock > 0,
    });
  }
  const images = (Array.isArray(raw?.images) ? raw.images : []).map((image: any) => image?.url).filter(Boolean);
  return { ...summary, images: images.length ? images : summary.imageUrl ? [summary.imageUrl] : [], options, skus };
}

/** The option payload POST /orders expects for one SKU: [{ id: optionId, value: [valueId] }]. */
export function skuOrderOptions(product: CatalogProduct, sku: CatalogSku) {
  return product.options
    .map((option) => {
      const value = option.values.find((v) => sku.optionValueIds.includes(v.id));
      return value ? { id: option.id, value: [value.id] } : null;
    })
    .filter((entry): entry is { id: string; value: string[] } => entry !== null);
}

export function skuLabel(product: CatalogProduct, sku: CatalogSku) {
  return product.options
    .map((option) => option.values.find((v) => sku.optionValueIds.includes(v.id))?.name)
    .filter(Boolean)
    .join(' / ');
}

export async function searchExchangeProducts(
  merchantId: string,
  params: { keyword?: string; category?: string; page?: number },
): Promise<{ products: CatalogProductSummary[]; hasMore: boolean }> {
  const page = Math.max(1, Math.min(50, Math.floor(params.page || 1)));
  const keyword = (params.keyword || '').trim().slice(0, 60);
  const category = (params.category || '').replace(/\D/g, '');
  const query = new URLSearchParams({ status: 'sale', per_page: '24', page: String(page) });
  if (keyword) query.set('keyword', keyword);
  if (category) query.set('category', category);
  return cached(`list:${merchantId}:${query}`, async () => {
    const body = await sallaMakeRequest<any>(merchantId, `/products?${query}`, { throwOnError: true });
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    const products = rows
      .filter((raw) => isSellable(raw) && !isExcludedProduct(raw))
      .filter((raw) => raw?.unlimited_quantity || Number(raw?.quantity ?? 1) > 0)
      .map(normalizeSummary);
    const pagination = body?.pagination || {};
    return { products, hasMore: Number(pagination.currentPage || page) < Number(pagination.totalPages || page) };
  });
}

export async function getExchangeProduct(merchantId: string, productId: string, options: { fresh?: boolean } = {}) {
  const id = String(productId).replace(/\D/g, '');
  if (!id) return null;
  const load = async () => {
    const body = await sallaMakeRequest<any>(merchantId, `/products/${id}`, { throwOnError: true });
    const raw = body?.data;
    if (!raw || !isSellable(raw) || isExcludedProduct(raw)) return null;
    return normalizeProduct(raw);
  };
  return options.fresh ? load() : cached(`product:${merchantId}:${id}`, load);
}
