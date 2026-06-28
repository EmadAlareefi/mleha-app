import { sallaMakeRequest } from './salla-oauth';
import { log } from './logger';
import { normalizeKSA } from './phone';

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
    location?: string | null;
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

export interface SallaOrderUpdateResponse {
  status: number;
  success: boolean;
  message?: string;
  data?: SallaOrder;
}

export interface SallaShipToUpdate {
  country: number;
  city: number;
  district: number;
  block: string;
  street_number: string;
  address_line: string;
  postal_code: string;
  short_address?: string;
  building_number?: string;
  additional_number?: string;
  address?: string;
  geo_coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface SallaOrderUpdatePayload {
  customer?: Record<string, unknown>;
  receiver?: Record<string, unknown>;
  delivery_method?: string;
  branch_id?: number;
  courier_id?: number;
  ship_to?: SallaShipToUpdate;
  payment?: Record<string, unknown>;
  coupon_code?: string;
  employees?: number[];
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

export interface SallaShipmentRecord {
  id?: number | string;
  order_id?: number | string;
  type?: string; // "shipment" (outbound) | "return"
  status?: string;
  courier_name?: string;
  shipping_number?: string;
  tracking_number?: string;
  tracking_link?: string;
  label?: { url?: string } | string;
}

/**
 * Fetches the shipments associated with an order from Salla.
 *
 * Salla issues the return waybill (بوليصة الرجيع) asynchronously after a
 * `create_return_policy` action, so the tracking number is not present in the
 * action response. Once issued, the return appears here as a `type: "return"`
 * shipment.
 */
export async function getSallaOrderShipments(
  merchantId: string,
  orderId: string
): Promise<SallaShipmentRecord[]> {
  try {
    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      data: SallaShipmentRecord[];
    }>(
      merchantId,
      `/shipments?order_id=${encodeURIComponent(orderId)}`
    );

    if (!response || !response.success || !Array.isArray(response.data)) {
      log.warn('Failed to fetch Salla order shipments', { merchantId, orderId });
      return [];
    }

    return response.data;
  } catch (error) {
    log.error('Error fetching Salla order shipments', { merchantId, orderId, error });
    return [];
  }
}

export interface SallaOrderHistoryEntry {
  status?: {
    id?: number | string;
    name?: string;
    slug?: string;
  } | string;
  status_name?: string;
  slug?: string;
  created_at?: { date?: string } | string;
  created?: { date?: string } | string;
}

const DELIVERED_STATUS_SLUG = 'delivered';
const DELIVERED_STATUS_NAME = 'تم التوصيل';

const parseSallaHistoryDate = (value: unknown): Date | null => {
  if (!value) return null;
  const raw = typeof value === 'string' ? value : (value as { date?: string }).date;
  if (!raw || typeof raw !== 'string') return null;
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isDeliveredHistoryEntry = (entry: SallaOrderHistoryEntry): boolean => {
  const slug =
    typeof entry.status === 'object' ? entry.status?.slug : entry.slug;
  const name =
    typeof entry.status === 'object'
      ? entry.status?.name
      : typeof entry.status === 'string'
        ? entry.status
        : entry.status_name;

  if (typeof slug === 'string' && slug.toLowerCase() === DELIVERED_STATUS_SLUG) {
    return true;
  }
  return typeof name === 'string' && name.includes(DELIVERED_STATUS_NAME);
};

/**
 * Pure helper: given a Salla order history `data` array, returns the earliest timestamp
 * at which the order converted to "تم التوصيل" (delivered), or null when there is none.
 * Exported for unit testing without hitting the network.
 */
export function extractDeliveredDateFromHistory(
  history: SallaOrderHistoryEntry[] | null | undefined
): Date | null {
  if (!Array.isArray(history)) {
    return null;
  }

  const deliveredDates = history
    .filter(isDeliveredHistoryEntry)
    .map((entry) => parseSallaHistoryDate(entry.created_at ?? entry.created))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());

  return deliveredDates[0] ?? null;
}

/**
 * Fetches the order status history from Salla and returns the earliest timestamp
 * at which the order converted to "تم التوصيل" (delivered).
 *
 * Used to determine the delivery date for AJ-EX / Redbox shipments, whose courier
 * scan data rarely carries a reliable delivered timestamp. Returns null if there is
 * no delivered history entry or the request fails (never throws).
 */
export async function getSallaOrderDeliveredDate(
  merchantId: string,
  orderId: string
): Promise<Date | null> {
  if (!merchantId || !orderId) {
    return null;
  }

  try {
    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      data: SallaOrderHistoryEntry[];
    }>(merchantId, `/orders/${orderId}/histories`);

    if (!response || !response.success || !Array.isArray(response.data)) {
      log.warn('Failed to fetch Salla order histories', { merchantId, orderId });
      return null;
    }

    return extractDeliveredDateFromHistory(response.data);
  } catch (error) {
    log.error('Error fetching Salla order delivered date', { merchantId, orderId, error });
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

export async function updateSallaOrder(
  merchantId: string,
  orderId: string | number,
  payload: SallaOrderUpdatePayload
): Promise<SallaOrderUpdateResponse | null> {
  if (!merchantId || !orderId) {
    log.warn('Cannot update Salla order - missing identifiers', { merchantId, orderId });
    return null;
  }

  return sallaMakeRequest<SallaOrderUpdateResponse>(
    merchantId,
    `/orders/${orderId}`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
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
 * Fetches invoices for a single order (Salla: GET /orders/{orderId}/invoices)
 */
export async function getSallaOrderInvoices(
  merchantId: string,
  orderId: string | number
): Promise<any[]> {
  try {
    const response = await sallaMakeRequest<{ success: boolean; data: any[] }>(
      merchantId,
      `/orders/${orderId}/invoices`
    );

    if (response && response.success) {
      return response.data || [];
    }

    return [];
  } catch (error) {
    log.error('Error fetching order invoices', { merchantId, orderId, error });
    return [];
  }
}

/**
 * Invoice annotated with its source order context.
 */
export interface CustomerInvoice {
  orderId: number;
  orderNumber: string | number;
  invoice: any;
}

/**
 * Fetches all invoices for a customer identified by phone number.
 *
 * Salla has no "invoices by customer" endpoint, so this finds the customer's
 * orders by phone, then fetches the invoices for each order.
 */
export async function getInvoicesByCustomerPhone(
  merchantId: string,
  phone: string
): Promise<CustomerInvoice[]> {
  try {
    const normalized = normalizeKSA(phone);

    // Salla's `?mobile=` matching is format-sensitive. Try the normalized
    // E.164 value first, then fall back to the local `05xxxxxxxx` form.
    let orders = await findOrdersByCustomerContact(merchantId, normalized);

    if (orders.length === 0 && normalized.startsWith('+966')) {
      const localForm = '0' + normalized.slice(4);
      orders = await findOrdersByCustomerContact(merchantId, localForm);
    }

    if (orders.length === 0) {
      return [];
    }

    // Fetch invoices per order with bounded concurrency to avoid rate limits.
    const CONCURRENCY = 5;
    const results: CustomerInvoice[] = [];

    for (let i = 0; i < orders.length; i += CONCURRENCY) {
      const chunk = orders.slice(i, i + CONCURRENCY);
      const chunkInvoices = await Promise.all(
        chunk.map(async (order) => {
          const invoices = await getSallaOrderInvoices(merchantId, order.id);
          return invoices.map((invoice) => ({
            orderId: order.id,
            orderNumber: order.reference_id ?? order.order_number ?? order.id,
            invoice,
          }));
        })
      );
      for (const invoices of chunkInvoices) {
        results.push(...invoices);
      }
    }

    return results;
  } catch (error) {
    log.error('Error fetching invoices by customer phone', { merchantId, phone, error });
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

export async function getSallaProductVariations(
  merchantId: string,
  productId: string | number
): Promise<SallaProductVariation[]> {
  try {
    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      data: Array<Record<string, any>>;
      pagination?: Record<string, any>;
      message?: string;
    }>(merchantId, `/products/${productId}/variants`);

    if (!response) {
      throw new Error('تعذر الوصول إلى بيانات المنتج من سلة');
    }

    if (!response.success) {
      const message =
        typeof response.message === 'string' && response.message.trim().length > 0
          ? response.message
          : 'تعذر تحميل بيانات المنتج من سلة';
      throw new Error(message);
    }

    const normalized: SallaProductVariation[] = [];
    const seen = new Set<string | number>();

    if (Array.isArray(response.data)) {
      for (const variation of response.data) {
        const entry = normalizeVariationEntry(variation);
        if (!entry) {
          continue;
        }
        const key = entry.id ?? entry.sku ?? entry.name;
        if (key && seen.has(key)) {
          continue;
        }
        if (key) {
          seen.add(key);
        }
        normalized.push(entry);
      }
    }

    return normalized;
  } catch (error) {
    log.error('Error fetching Salla product variations', { merchantId, productId, error });
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('تعذر تحميل متغيرات المنتج من سلة');
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
  variations?: SallaProductVariation[];
}

export interface SallaProductVariation {
  id: number | string;
  name: string;
  sku?: string;
  priceAmount?: number | null;
  currency?: string;
  availableQuantity?: number | null;
  barcode?: string | null;
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
  keyword?: string;
  status?: string;
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

function extractVariationOptionLabels(variation: Record<string, any>): string[] {
  const labels: string[] = [];
  const optionSources = [
    Array.isArray(variation?.options) ? variation.options : null,
    Array.isArray(variation?.attributes) ? variation.attributes : null,
    Array.isArray(variation?.values) ? variation.values : null,
    Array.isArray(variation?.option_values) ? variation.option_values : null,
  ].filter(Boolean) as Array<Array<any>>;

  for (const options of optionSources) {
    for (const option of options) {
      const name =
        typeof option?.name === 'string' && option.name.trim().length > 0
          ? option.name.trim()
          : typeof option?.title === 'string' && option.title.trim().length > 0
            ? option.title.trim()
            : undefined;
      const value =
        typeof option?.value === 'string' && option.value.trim().length > 0
          ? option.value.trim()
          : typeof option === 'string'
            ? option.trim()
            : undefined;
      if (name && value) {
        labels.push(`${name}: ${value}`);
      } else if (value) {
        labels.push(value);
      }
    }

    if (labels.length > 0) {
      break;
    }
  }

  if (labels.length === 0 && typeof variation?.option === 'string') {
    labels.push(variation.option);
  }

  return labels;
}

function normalizeVariationEntry(
  variation: Record<string, any>,
  fallbackCurrency?: string
): SallaProductVariation | null {
  if (!variation || typeof variation !== 'object') {
    return null;
  }

  const rawId =
    typeof variation?.id === 'number'
      ? variation.id
      : typeof variation?.id === 'string' && variation.id.trim().length > 0
        ? variation.id.trim()
        : undefined;

  const sku =
    typeof variation?.sku === 'string'
      ? variation.sku
      : typeof variation?.sku_code === 'string'
        ? variation.sku_code
        : typeof variation?.skuCode === 'string'
          ? variation.skuCode
          : undefined;

  const barcode =
    typeof variation?.barcode === 'string'
      ? variation.barcode
      : typeof variation?.bar_code === 'string'
        ? variation.bar_code
        : undefined;

  const quantity = safeNumber(
    variation?.quantity ??
      variation?.stock_quantity ??
      variation?.available_quantity ??
      variation?.inventory_quantity ??
      variation?.inventory?.available ??
      variation?.stock
  );

  const priceAmount = safeNumber(
    variation?.price?.amount ??
      variation?.price?.value ??
      variation?.price ??
      variation?.prices?.price ??
      variation?.prices?.base ??
      variation?.regular_price?.amount ??
      variation?.regular_price
  );

  const currency =
    typeof variation?.price?.currency === 'string'
      ? variation.price.currency
      : typeof variation?.currency === 'string'
        ? variation.currency
        : typeof variation?.prices?.currency === 'string'
          ? variation.prices.currency
          : fallbackCurrency;

  const optionLabels = extractVariationOptionLabels(variation);

  let name =
    typeof variation?.name === 'string' && variation.name.trim().length > 0
      ? variation.name.trim()
      : undefined;

  if (!name && optionLabels.length > 0) {
    name = optionLabels.join(' / ');
  }

  if (!name && sku) {
    name = `SKU ${sku}`;
  }

  if (!name && rawId != null) {
    name = `متغير ${rawId}`;
  }

  if (!name) {
    name = 'متغير';
  }

  return {
    id: rawId ?? sku ?? name,
    name,
    sku,
    barcode: barcode || undefined,
    availableQuantity: quantity,
    priceAmount,
    currency,
  };
}

function normalizeProductVariations(product: Record<string, any>): SallaProductVariation[] {
  const currency =
    typeof product?.price?.currency === 'string'
      ? product.price.currency
      : typeof product?.currency === 'string'
        ? product.currency
        : undefined;

  const candidateArrays: any[][] = [];

  if (Array.isArray(product?.variations)) {
    candidateArrays.push(product.variations);
  }

  if (Array.isArray(product?.variants)) {
    candidateArrays.push(product.variants);
  }

  if (Array.isArray(product?.variation)) {
    candidateArrays.push(product.variation);
  }

  if (Array.isArray(product?.inventory?.variations)) {
    candidateArrays.push(product.inventory.variations);
  }

  if (Array.isArray(product?.options)) {
    for (const option of product.options) {
      if (Array.isArray(option?.combinations)) {
        candidateArrays.push(option.combinations);
      }
    }
  }

  if (Array.isArray(product?.options?.combinations)) {
    candidateArrays.push(product.options.combinations);
  }

  const normalized: SallaProductVariation[] = [];
  const seen = new Set<string>();

  for (const array of candidateArrays) {
    for (const variation of array) {
      const normalizedVariation = normalizeVariationEntry(variation, currency);
      if (!normalizedVariation) {
        continue;
      }

      const dedupeKey =
        typeof normalizedVariation.id === 'string'
          ? normalizedVariation.id
          : typeof normalizedVariation.id === 'number'
            ? normalizedVariation.id.toString()
            : normalizedVariation.sku || normalizedVariation.name;

      if (dedupeKey) {
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
      }

      normalized.push(normalizedVariation);
    }
  }

  return normalized;
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
  const variations = normalizeProductVariations(product);

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
    variations,
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
    // Salla's products API rejects sort_by=updated/updated_at (422 alert.invalid_fields).
    // Accepted values are created_at, price, sale_price — newest-first is the closest fit.
    sort_by: 'created_at',
    sort: 'desc',
  });

  const trimmedSku = options?.sku?.trim();
  if (trimmedSku) {
    query.set('sku', trimmedSku);
  }
  // Salla's `keyword` param searches across product name and SKU and actually filters
  // (the `sku` param is ignored by the store and returns the full catalog).
  const trimmedKeyword = options?.keyword?.trim();
  if (trimmedKeyword) {
    query.set('keyword', trimmedKeyword);
  }
  if (options?.status) {
    query.set('status', options.status);
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

export async function getSallaProductBySku(
  merchantId: string,
  sku: string
): Promise<SallaProductSummary | null> {
  const trimmed = sku?.trim();
  if (!trimmed) {
    return null;
  }

  const endpoint = `/products/sku/${encodeURIComponent(trimmed)}`;
  const response = await sallaMakeRequest<{
    status: number;
    success: boolean;
    data?: Record<string, any>;
    message?: string;
  }>(merchantId, endpoint);

  if (!response) {
    log.error('Failed to reach Salla product by SKU endpoint', { merchantId, sku: trimmed });
    return null;
  }

  if (!response.success || !response.data) {
    log.warn('Salla returned failure for product SKU lookup', {
      merchantId,
      sku: trimmed,
      status: response.status,
      message: response.message,
    });
    return null;
  }

  return normalizeProduct(response.data);
}

export function normalizeSkuValue(value?: string | null): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toUpperCase();
}

function simplifySku(value: string): string {
  return value.replace(/[^A-Z0-9]/g, '');
}

function tokenizeSku(value: string): string[] {
  return value
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function getSkuMatchScore(product: SallaProductSummary, skuQuery: string): number {
  const normalizedQuery = normalizeSkuValue(skuQuery);
  const simplifiedQuery = normalizedQuery ? simplifySku(normalizedQuery) : '';
  if (!normalizedQuery && !simplifiedQuery) {
    return 0;
  }

  const queryTokens = tokenizeSku(normalizedQuery);
  const queryTokenSet = new Set(queryTokens);
  let score = 0;

  const evaluateCandidate = (candidate: string | null | undefined, weight = 0) => {
    const normalizedCandidate = normalizeSkuValue(candidate);
    if (!normalizedCandidate) {
      return;
    }

    const simplifiedCandidate = simplifySku(normalizedCandidate);
    if (normalizedCandidate === normalizedQuery) {
      score = Math.max(score, 100 + weight);
      return;
    }

    if (simplifiedQuery && simplifiedCandidate && simplifiedCandidate === simplifiedQuery) {
      score = Math.max(score, 92 + weight);
    }

    if (normalizedQuery && normalizedCandidate) {
      if (
        normalizedCandidate.startsWith(normalizedQuery) ||
        normalizedQuery.startsWith(normalizedCandidate)
      ) {
        score = Math.max(score, 80 + weight);
      } else if (
        normalizedCandidate.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedCandidate)
      ) {
        score = Math.max(score, 70 + weight);
      }
    }

    if (simplifiedQuery && simplifiedCandidate) {
      if (
        simplifiedCandidate.startsWith(simplifiedQuery) ||
        simplifiedQuery.startsWith(simplifiedCandidate) ||
        simplifiedCandidate.includes(simplifiedQuery) ||
        simplifiedQuery.includes(simplifiedCandidate)
      ) {
        score = Math.max(score, 60 + weight);
      }
    }

    if (queryTokenSet.size > 0) {
      const candidateTokens = tokenizeSku(normalizedCandidate);
      if (candidateTokens.some((token) => queryTokenSet.has(token))) {
        score = Math.max(score, 50 + weight);
      }
    }
  };

  evaluateCandidate(product?.sku, 10);

  if (Array.isArray(product?.variations)) {
    for (const variation of product.variations) {
      evaluateCandidate(variation?.sku, 5);
    }
  }

  return score;
}

export function rankProductsBySku(
  products: SallaProductSummary[],
  skuQuery: string
): SallaProductSummary[] {
  if (!products || products.length === 0) {
    return [];
  }

  const ranked = products
    .map((product) => ({
      product,
      score: getSkuMatchScore(product, skuQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.product.name.localeCompare(b.product.name);
    });

  return ranked.map((entry) => entry.product);
}

const DEFAULT_SKU_SEARCH_MAX_PAGES = 5;
const DEFAULT_SKU_MATCH_LIMIT = 100;

export async function searchSallaProductsBySku(
  merchantId: string,
  skuQuery: string,
  options?: {
    status?: string;
    perPage?: number;
    maxPages?: number;
    maxResults?: number;
  }
): Promise<SallaProductSummary[]> {
  const trimmedQuery = skuQuery?.trim();
  if (!trimmedQuery) {
    return [];
  }

  const perPage = Math.min(Math.max(options?.perPage ?? 100, 1), 100);
  const maxPages = Math.max(options?.maxPages ?? DEFAULT_SKU_SEARCH_MAX_PAGES, 1);
  const requestedMax = options?.maxResults ?? perPage;
  const maxResults = Math.max(Math.min(requestedMax, DEFAULT_SKU_MATCH_LIMIT), 1);

  const matches: Array<{ product: SallaProductSummary; score: number }> = [];
  const seenIds = new Set<number>();

  const collect = (products: SallaProductSummary[]) => {
    for (const product of products) {
      if (seenIds.has(product.id)) {
        continue;
      }
      seenIds.add(product.id);
      const score = getSkuMatchScore(product, trimmedQuery);
      if (score > 0) {
        matches.push({ product, score });
      }
    }
  };

  // Fetch the first page sequentially so we learn the real total page count.
  const firstPage = await listSallaProducts(merchantId, {
    page: 1,
    perPage,
    keyword: trimmedQuery,
    status: options?.status,
  });
  collect(firstPage.products);

  const totalPages = firstPage.pagination?.totalPages ?? 1;
  const lastPage = Math.min(totalPages, maxPages);

  // Fetch any remaining pages in parallel instead of one-by-one to keep search snappy.
  if (matches.length < maxResults && lastPage > 1) {
    const pagePromises = [];
    for (let page = 2; page <= lastPage; page += 1) {
      pagePromises.push(
        listSallaProducts(merchantId, {
          page,
          perPage,
          keyword: trimmedQuery,
          status: options?.status,
        })
      );
    }

    const settled = await Promise.allSettled(pagePromises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        collect(result.value.products);
      }
    }
  }

  return matches
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.product.name.localeCompare(b.product.name);
    })
    .slice(0, maxResults)
    .map((entry) => entry.product);
}
