import { sallaMakeRequest } from './salla-oauth';
import { log } from './logger';

// Salla API Types
export interface SallaOrder {
  id: number;
  reference_id: string;
  order_number?: string | number;
  status: {
    name: string;
    slug: string;
  };
  amounts: {
    total: {
      amount: number;
      currency: string;
    };
    shipping_cost?: {
      amount: number;
      currency: string;
      taxable?: boolean;
    };
    shipping_tax?: {
      amount?: number;
      currency?: string;
    };
  };
  date: {
    created: string;
    updated: string;
  };
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    name?: string;
    mobile: string;
    email: string;
    city?: string;
    full_name?: string;
  };
  items: SallaOrderItem[];
  shipping?: {
    pickup_address?: any;
    company?: string;
    tracking_number?: string;
  };
}

export interface SallaOrderItem {
  id: number;
  name: string;
  sku?: string;
  quantity: number;
  currency: string;
  weight?: number;
  weight_label?: string;
  amounts: {
    price_without_tax: {
      amount: number;
      currency: string;
    };
    total_discount: {
      amount: number;
      currency: string;
    };
    tax: {
      percent: string;
      amount: {
        amount: number;
        currency: string;
      };
    };
    total: {
      amount: number;
      currency: string;
    };
  };
  notes?: string;
  options?: any[];
  images?: any[];
  codes?: any[];
  files?: any[];
  reservations?: any[];
  // Legacy fields for backward compatibility
  product?: {
    id: number;
    name: string;
    sku?: string;
    price: number;
    thumbnail?: string;
  };
  variant?: {
    id: number;
    name: string;
  };
}

export interface SallaOrdersResponse {
  status: number;
  success: boolean;
  data: SallaOrder[];
  pagination?: {
    count: number;
    total: number;
    per_page: number;
    current_page: number;
    total_pages: number;
  };
}

export interface SallaSingleOrderResponse {
  status: number;
  success: boolean;
  data: SallaOrder;
}

/**
 * Fetches order items with full details including prices
 */
export async function getSallaOrderItems(
  merchantId: string,
  orderId: string
): Promise<SallaOrderItem[] | null> {
  try {
    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      data: SallaOrderItem[];
    }>(
      merchantId,
      `/orders/items?order_id=${orderId}`
    );

    if (!response || !response.success) {
      log.error('Failed to fetch Salla order items', { merchantId, orderId, response });
      return null;
    }

    log.info('Fetched order items', {
      merchantId,
      orderId,
      itemCount: response.data.length,
      firstItemKeys: response.data[0] ? Object.keys(response.data[0]) : []
    });

    return response.data;
  } catch (error) {
    log.error('Error fetching Salla order items', { merchantId, orderId, error });
    return null;
  }
}

/**
 * Fetches a specific order by ID from Salla
 */
export async function getSallaOrder(
  merchantId: string,
  orderId: string
): Promise<SallaOrder | null> {
  try {
    const response = await sallaMakeRequest<SallaSingleOrderResponse>(
      merchantId,
      `/orders/${orderId}`
    );

    if (!response || !response.success) {
      log.error('Failed to fetch Salla order', { merchantId, orderId, response });
      return null;
    }

    // Fetch full item details
    const items = await getSallaOrderItems(merchantId, orderId);
    if (items) {
      response.data.items = items;
    }

    return response.data;
  } catch (error) {
    log.error('Error fetching Salla order', { merchantId, orderId, error });
    return null;
  }
}

/**
 * Fetches a specific order by reference ID (order number) from Salla
 */
export async function getSallaOrderByReference(
  merchantId: string,
  referenceId: string
): Promise<SallaOrder | null> {
  try {
    // First, search by reference_id to get the order ID
    const searchResponse = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/orders?reference_id=${encodeURIComponent(referenceId)}`
    );

    if (!searchResponse || !searchResponse.success || !searchResponse.data || searchResponse.data.length === 0) {
      log.warn('Order not found by reference', { merchantId, referenceId });
      return null;
    }

    const orderId = searchResponse.data[0].id;

    // Now fetch the complete order details by ID (includes full item info with prices)
    log.info('Fetching full order details', { merchantId, orderId, referenceId });
    const fullOrder = await getSallaOrder(merchantId, orderId.toString());

    if (!fullOrder) {
      log.error('Failed to fetch full order details', { merchantId, orderId });
      return searchResponse.data[0]; // Fallback to search result
    }

    // Log the actual response structure for debugging
    log.info('Salla order fetched successfully', {
      merchantId,
      referenceId,
      orderId,
      itemsCount: fullOrder.items?.length,
      firstItemKeys: fullOrder.items?.[0] ? Object.keys(fullOrder.items[0]) : []
    });

    return fullOrder;
  } catch (error) {
    log.error('Error fetching Salla order by reference', { merchantId, referenceId, error });
    return null;
  }
}

/**
 * Fetches recent orders for a specific customer
 */
export async function getCustomerOrders(
  merchantId: string,
  customerId: string,
  limit: number = 10
): Promise<SallaOrder[]> {
  try {
    const response = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/orders?customer=${customerId}&per_page=${limit}&sort_by=created&sort=desc`
    );

    if (!response || !response.success) {
      log.error('Failed to fetch customer orders', { merchantId, customerId });
      return [];
    }

    return response.data || [];
  } catch (error) {
    log.error('Error fetching customer orders', { merchantId, customerId, error });
    return [];
  }
}

/**
 * Fetches orders by customer email or phone
 */
export async function findOrdersByCustomerContact(
  merchantId: string,
  emailOrPhone: string
): Promise<SallaOrder[]> {
  try {
    // Try searching by email first
    let response = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/orders?email=${encodeURIComponent(emailOrPhone)}&per_page=20&sort_by=created&sort=desc`
    );

    if (response && response.success && response.data && response.data.length > 0) {
      return response.data;
    }

    // Try searching by phone if email didn't work
    response = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/orders?mobile=${encodeURIComponent(emailOrPhone)}&per_page=20&sort_by=created&sort=desc`
    );

    if (response && response.success) {
      return response.data || [];
    }

    return [];
  } catch (error) {
    log.error('Error finding orders by contact', { merchantId, emailOrPhone, error });
    return [];
  }
}

/**
 * Validates if an order can be returned/exchanged
 * Returns true if the order is in a returnable state
 */
export function isOrderReturnable(order: SallaOrder): boolean {
  const returnableStatuses = ['delivered', 'completed'];
  const orderStatus = order.status.slug.toLowerCase();

  return returnableStatuses.includes(orderStatus);
}

/**
 * Calculates the maximum returnable quantity for an order item
 */
export function getMaxReturnableQuantity(item: SallaOrderItem): number {
  // In a real implementation, you might want to check for already returned quantities
  return item.quantity;
}

/**
 * Fetches product details including category from Salla
 */
export async function getSallaProduct(
  merchantId: string,
  productId: string
): Promise<{
  id: number;
  name: string;
  sku?: string;
  category?: string;
  categories?: Array<{ id: number; name: string }>;
} | null> {
  try {
    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      data: {
        id: number;
        name: string;
        sku?: string;
        categories?: Array<{ id: number; name: string }>;
      };
    }>(
      merchantId,
      `/products/${productId}`
    );

    if (!response || !response.success) {
    log.error('Failed to fetch Salla product', { merchantId, productId, response });
    return null;
  }

  const product = response.data;
    const category = product.categories && product.categories.length > 0
      ? product.categories[0].name
      : undefined;

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category,
      categories: product.categories,
    };
  } catch (error) {
    log.error('Error fetching Salla product', { merchantId, productId, error });
    return null;
  }
}

export interface SallaProductSummary {
  id: number;
  name: string;
  sku?: string;
  priceAmount?: number | null;
  currency?: string;
  availableQuantity?: number | null;
  status?: string;
  imageUrl?: string | null;
  lastUpdatedAt?: string | null;
}

interface SallaProductsApiResponse {
  status: number;
  success: boolean;
  data: Array<Record<string, any>>;
  pagination?: {
    count?: number;
    total?: number;
    per_page?: number;
    current_page?: number;
    total_pages?: number;
  };
}

export interface SallaProductsQueryOptions {
  page?: number;
  perPage?: number;
  sku?: string;
}

export interface SallaPaginationMeta {
  count: number;
  total: number;
  perPage: number;
  currentPage: number;
  totalPages: number;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeProduct(product: Record<string, any>): SallaProductSummary {
  const rawId = typeof product?.id === 'number'
    ? product.id
    : safeNumber(product?.id);

  const mainImage = typeof product?.image === 'string'
    ? product.image
    : typeof product?.thumbnail === 'string'
      ? product.thumbnail
      : typeof product?.main_image?.url === 'string'
        ? product.main_image.url
        : typeof product?.main_image?.original_url === 'string'
          ? product.main_image.original_url
          : Array.isArray(product?.images) && product.images.length > 0 && typeof product.images[0] === 'string'
            ? product.images[0]
            : undefined;

  const priceAmount = safeNumber(
    product?.price?.amount ??
    product?.price?.value ??
    product?.price ??
    product?.prices?.price ??
    product?.prices?.base
  );

  const availableQuantity = safeNumber(
    product?.quantity ??
    product?.stock_quantity ??
    product?.inventory?.available ??
    product?.inventory_quantity ??
    product?.quantities?.available
  );

  const status = typeof product?.status === 'string'
    ? product.status
    : typeof product?.status?.name === 'string'
      ? product.status.name
      : typeof product?.status?.slug === 'string'
        ? product.status.slug
        : undefined;

  const sku = typeof product?.sku === 'string'
    ? product.sku
    : typeof product?.sku_code === 'string'
      ? product.sku_code
      : undefined;

  const currency = typeof product?.price?.currency === 'string'
    ? product.price.currency
    : typeof product?.currency === 'string'
      ? product.currency
      : typeof product?.prices?.currency === 'string'
        ? product.prices.currency
        : 'SAR';

  const name = typeof product?.name === 'string' && product.name.trim().length > 0
    ? product.name
    : `منتج رقم ${rawId ?? '-'}`;

  const lastUpdatedAt = typeof product?.updated_at === 'string'
    ? product.updated_at
    : typeof product?.updatedAt === 'string'
      ? product.updatedAt
      : undefined;

  return {
    id: rawId ?? Date.now(),
    name,
    sku,
    priceAmount,
    currency,
    availableQuantity,
    status,
    imageUrl: mainImage || null,
    lastUpdatedAt,
  };
}

export async function listSallaProducts(
  merchantId: string,
  options?: SallaProductsQueryOptions
): Promise<{ products: SallaProductSummary[]; pagination: SallaPaginationMeta }> {
  const perPage = Math.min(Math.max(options?.perPage ?? 100, 1), 100);
  const page = Math.max(options?.page ?? 1, 1);
  const query = new URLSearchParams({
    per_page: perPage.toString(),
    page: page.toString(),
    sort_by: 'updated',
    sort: 'desc',
  });

  const trimmedSku = options?.sku?.trim();
  if (trimmedSku) {
    query.set('sku', trimmedSku);
  }

  const endpoint = `/products?${query.toString()}`;
  const response = await sallaMakeRequest<SallaProductsApiResponse>(merchantId, endpoint);

  if (!response) {
    log.error('Failed to reach Salla products endpoint', { merchantId, endpoint });
    throw new Error('تعذر الوصول إلى واجهة سلة، تأكد من حفظ رموز الدخول الخاصة بالمتجر.');
  }

  if (!response.success) {
    const errorMessage =
      typeof (response as any)?.message === 'string'
        ? (response as any).message
        : typeof (response as any)?.error?.message === 'string'
          ? (response as any).error.message
          : 'فشل تحميل منتجات سلة، يرجى المحاولة لاحقاً.';

    log.error('Salla API responded with failure for products listing', {
      merchantId,
      endpoint,
      response,
    });

    throw new Error(errorMessage);
  }

  const normalizedProducts = Array.isArray(response.data)
    ? response.data.map((product) => normalizeProduct(product))
    : [];

  const pagination = response.pagination;
  const total = pagination?.total ?? normalizedProducts.length;
  const totalPages = pagination?.total_pages ?? Math.max(1, Math.ceil(total / perPage));

  return {
    products: normalizedProducts,
    pagination: {
      count: pagination?.count ?? normalizedProducts.length,
      total,
      perPage: pagination?.per_page ?? perPage,
      currentPage: pagination?.current_page ?? page,
      totalPages,
    },
  };
}
