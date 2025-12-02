import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sallaMakeRequest } from './salla-oauth';
import { log } from './logger';

type AnyRecord = Record<string, any>;

interface PaginationMeta {
  count?: number;
  total?: number;
  per_page?: number;
  current_page?: number;
  total_pages?: number;
  perPage?: number;
  currentPage?: number;
  totalPages?: number;
}

export interface SallaOrdersResponse {
  status: number;
  success: boolean;
  data: AnyRecord[];
  pagination?: PaginationMeta;
}

interface SyncOptions {
  merchantId?: string;
  perPage?: number;
  startDate?: Date | string;
  endDate?: Date | string;
}

interface SyncStats {
  merchantId: string;
  ordersFetched: number;
  ordersStored: number;
  pagesProcessed: number;
  errors: {
    orderId?: string | null;
    message: string;
  }[];
}

const DEFAULT_PER_PAGE = 50;

export const normalizers = {
  id(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'object' && (value as AnyRecord)?.id) {
      return normalizers.id((value as AnyRecord).id);
    }
    return String(value);
  },
  string(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
    return String(value);
  },
  status(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.toLowerCase();
    if (typeof value === 'number' || typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'object') {
      const record = value as AnyRecord;
      const candidate =
        record.slug ??
        record.code ??
        record.status ??
        record.name ??
        record.value ??
        record.id ??
        null;
      return candidate ? normalizers.status(candidate) : null;
    }
    return null;
  },
  amount(value: unknown): Prisma.Decimal | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' || typeof value === 'bigint') {
      if (!Number.isFinite(Number(value))) return null;
      return new Prisma.Decimal(value.toString());
    }
    if (typeof value === 'string') {
      const normalized = value.replace(/,/g, '').trim();
      if (!normalized) return null;
      const parsed = Number(normalized);
      if (Number.isNaN(parsed)) return null;
      return new Prisma.Decimal(normalized);
    }
    if (typeof value === 'object') {
      const record = value as AnyRecord;
      if ('amount' in record) {
        return normalizers.amount(record.amount);
      }
      if ('value' in record) {
        return normalizers.amount(record.value);
      }
      if ('total' in record) {
        return normalizers.amount(record.total);
      }
    }
    return null;
  },
  date(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const str =
      typeof value === 'string'
        ? value
        : typeof value === 'number'
        ? new Date(value).toISOString()
        : typeof value === 'object'
        ? ((value as AnyRecord).date ??
          (value as AnyRecord).datetime ??
          (value as AnyRecord).issued ??
          (value as AnyRecord).created ??
          (value as AnyRecord).updated ??
          null)
        : null;
    if (!str) return null;
    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  },
};

function pickFirst<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function getTotalPages(meta?: PaginationMeta | null): number | null {
  if (!meta) return null;

  if (typeof meta.total_pages === 'number') {
    return meta.total_pages;
  }
  if (typeof meta.totalPages === 'number') {
    return meta.totalPages;
  }

  const total = meta.total ?? meta.count;
  const perPage = meta.per_page ?? meta.perPage;
  if (typeof total === 'number' && typeof perPage === 'number' && perPage > 0) {
    return Math.ceil(total / perPage);
  }

  return null;
}

export function extractCustomer(order: AnyRecord): AnyRecord | null {
  return (
    order.customer ||
    order.customer_data ||
    order.customerDetails ||
    order.client ||
    null
  );
}

export function buildCustomerName(customer: AnyRecord | null): string | null {
  if (!customer) return null;
  const full =
    customer.full_name ||
    customer.name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
  return full || null;
}

export function extractCurrency(order: AnyRecord): string | null {
  return pickFirst(
    normalizers.string(order.currency),
    normalizers.string(order.currency_code),
    normalizers.string(order.currencyCode),
    normalizers.string(order.amounts?.total?.currency),
    normalizers.string(order.amounts?.subtotal?.currency),
    normalizers.string(order.amounts?.grand_total?.currency),
    normalizers.string(order.amount?.currency)
  );
}

export function extractAmounts(order: AnyRecord) {
  const amounts = order.amounts || {};
  return {
    subtotal: pickFirst(
      normalizers.amount(amounts.subtotal),
      normalizers.amount(amounts.sub_total),
      normalizers.amount(amounts.before_tax),
      normalizers.amount(order.subtotal_amount),
      normalizers.amount(order.subtotal)
    ),
    total: pickFirst(
      normalizers.amount(amounts.total),
      normalizers.amount(amounts.grand_total),
      normalizers.amount(order.total_amount),
      normalizers.amount(order.total)
    ),
    tax: pickFirst(
      normalizers.amount(amounts.tax),
      normalizers.amount(amounts.total_tax),
      normalizers.amount(order.tax_amount)
    ),
    shipping: pickFirst(
      normalizers.amount(amounts.shipping),
      normalizers.amount(amounts.shipping_cost),
      normalizers.amount(order.shipping_amount),
      normalizers.amount(order.shipping_total)
    ),
    discount: pickFirst(
      normalizers.amount(amounts.discount),
      normalizers.amount(amounts.total_discount),
      normalizers.amount(order.discount_amount)
    ),
  };
}

export function extractPaymentStatus(order: AnyRecord): string | null {
  return pickFirst(
    normalizers.status(order.payment_status),
    normalizers.status(order.paymentStatus),
    normalizers.status(order.payment?.status)
  );
}

export function extractPaymentMethod(order: AnyRecord): string | null {
  const method =
    order.payment_method ??
    order.paymentMethod ??
    order.payment?.method ??
    order.payment?.gateway ??
    null;
  if (!method) return null;
  if (typeof method === 'string') return method;
  return pickFirst(
    normalizers.string(method.name),
    normalizers.string(method.slug),
    normalizers.string(method.type)
  );
}

export function extractFulfillmentStatus(order: AnyRecord): string | null {
  return pickFirst(
    normalizers.status(order.fulfillment_status),
    normalizers.status(order.fulfillmentStatus),
    normalizers.status(order.shipping_status)
  );
}

export function extractOrderNumber(order: AnyRecord): string | null {
  return pickFirst(
    normalizers.string(order.order_number),
    normalizers.string(order.orderNumber),
    normalizers.string(order.reference_id),
    normalizers.string(order.referenceId),
    normalizers.string(order.reference)
  );
}

export function extractReferenceId(order: AnyRecord): string | null {
  return pickFirst(
    normalizers.string(order.reference_id),
    normalizers.string(order.referenceId),
    normalizers.string(order.reference)
  );
}

export function extractDates(
  order: AnyRecord
): { created: Date | null; updated: Date | null } {
  return {
    created: pickFirst(
      normalizers.date(order.date?.created),
      normalizers.date(order.date?.date),
      normalizers.date(order.created_at),
      normalizers.date(order.createdAt),
      normalizers.date(order.created)
    ),
    updated: pickFirst(
      normalizers.date(order.date?.updated),
      normalizers.date(order.updated_at),
      normalizers.date(order.updatedAt),
      normalizers.date(order.updated),
      normalizers.date(order.date?.date)
    ),
  };
}

export function deriveStatusInfo(order: AnyRecord): { slug: string | null; name: string | null } {
  const slug = pickFirst(
    normalizers.status(order.status?.slug),
    normalizers.status(order.status),
    normalizers.status(order.shipping_status),
    normalizers.status(order.shipping?.status),
    normalizers.status(order.shipments?.[0]?.status)
  );

  const name = pickFirst(
    normalizers.string(order.status?.customized?.name),
    normalizers.string(order.status?.name),
    normalizers.string(order.status?.label),
    normalizers.string(order.shipping_status_label),
    normalizers.string(order.shipping?.status_label),
    normalizers.string(order.shipments?.[0]?.status_label),
    normalizers.string(order.status),
    normalizers.string(order.shipping_status)
  );

  return { slug, name };
}

export function extractCampaign(order: AnyRecord): {
  source: string | null;
  medium: string | null;
  name: string | null;
} {
  const campaign = order.campaign ?? order.Campaign ?? order.utm ?? null;

  return {
    source: pickFirst(
      normalizers.string(campaign?.source),
      normalizers.string(order.utm_source),
      normalizers.string(order.source_details?.value)
    ),
    medium: pickFirst(
      normalizers.string(campaign?.medium),
      normalizers.string(order.utm_medium)
    ),
    name: pickFirst(
      normalizers.string(campaign?.campaign),
      normalizers.string(campaign?.name),
      normalizers.string(order.utm_campaign)
    ),
  };
}

async function fetchOrdersPage(
  merchantId: string,
  page: number,
  perPage: number,
  options?: { startDate?: Date | string; endDate?: Date | string }
): Promise<SallaOrdersResponse | null> {
  const query = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
  });

  if (options?.startDate) {
    const startDateStr =
      options.startDate instanceof Date
        ? options.startDate.toISOString().split('T')[0]
        : options.startDate;
    query.append('date_from', startDateStr);
  }

  if (options?.endDate) {
    const endDateStr =
      options.endDate instanceof Date
        ? options.endDate.toISOString().split('T')[0]
        : options.endDate;
    query.append('date_to', endDateStr);
  }

  return sallaMakeRequest<SallaOrdersResponse>(
    merchantId,
    `/orders?${query.toString()}`
  );
}

export async function syncSallaOrders(
  options: SyncOptions = {}
): Promise<SyncStats[]> {
  const merchants = options.merchantId
    ? [{ merchantId: options.merchantId }]
    : await prisma.sallaAuth.findMany({
        select: { merchantId: true },
      });

  if (merchants.length === 0) {
    log.warn('No merchants configured for order sync');
    return [];
  }

  const stats: SyncStats[] = [];
  for (const merchant of merchants) {
    stats.push(await syncOrdersForMerchant(merchant.merchantId, options));
  }

  return stats;
}

async function syncOrdersForMerchant(
  merchantId: string,
  options: SyncOptions = {}
): Promise<SyncStats> {
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  let page = 1;
  let fetched = 0;
  let stored = 0;
  let pagesProcessed = 0;
  const errors: SyncStats['errors'] = [];

  while (true) {
    const response = await fetchOrdersPage(merchantId, page, perPage, {
      startDate: options.startDate,
      endDate: options.endDate,
    });

    if (!response || !response.success) {
      const message = response
        ? `Salla API returned an unsuccessful response for orders page ${page}`
        : `Failed to fetch orders page ${page} from Salla API`;

      errors.push({ orderId: null, message });
      log.error(message, {
        merchantId,
        page,
        responseStatus: response?.status,
        responseSuccess: response?.success,
      });
      break;
    }

    const orders = response.data ?? [];
    fetched += orders.length;
    pagesProcessed += 1;

    for (const order of orders) {
      const orderId = normalizers.id(order.id);
      if (!orderId) {
        errors.push({ orderId: null, message: 'Missing order identifier' });
        continue;
      }

      try {
        const customer = extractCustomer(order);
        const customerName = buildCustomerName(customer);
        const amounts = extractAmounts(order);
        const currency = extractCurrency(order);
        const dates = extractDates(order);
        const statusInfo = deriveStatusInfo(order);
        const campaign = extractCampaign(order);

        await prisma.sallaOrder.upsert({
          where: {
            merchantId_orderId: {
              merchantId,
              orderId,
            },
          },
          create: {
            merchantId,
            orderId,
            referenceId: extractReferenceId(order) ?? undefined,
            orderNumber: extractOrderNumber(order) ?? undefined,
            statusSlug: statusInfo.slug ?? undefined,
            statusName: statusInfo.name ?? undefined,
            fulfillmentStatus: extractFulfillmentStatus(order) ?? undefined,
            paymentStatus: extractPaymentStatus(order) ?? undefined,
            currency: currency ?? undefined,
            subtotalAmount: amounts.subtotal ?? undefined,
            taxAmount: amounts.tax ?? undefined,
            shippingAmount: amounts.shipping ?? undefined,
            discountAmount: amounts.discount ?? undefined,
            totalAmount: amounts.total ?? undefined,
            customerId: normalizers.id(customer?.id ?? order.customer_id) ?? undefined,
            customerName: customerName ?? undefined,
            customerMobile: normalizers.string(
              customer?.mobile ?? customer?.phone ?? order.customer_mobile ?? order.customer_phone
            ) ?? undefined,
            customerEmail: normalizers.string(customer?.email ?? order.customer_email) ?? undefined,
            customerCity: normalizers.string(
              customer?.city ?? order.shipping_address?.city ?? order.billing_address?.city
            ) ?? undefined,
            customerCountry: normalizers.string(
              customer?.country ?? order.shipping_address?.country ?? order.billing_address?.country
            ) ?? undefined,
            paymentMethod: extractPaymentMethod(order) ?? undefined,
            fulfillmentCompany: normalizers.string(order.shipping?.company) ?? undefined,
            trackingNumber: normalizers.string(order.shipping?.tracking_number) ?? undefined,
            placedAt: dates.created ?? undefined,
            updatedAtRemote: dates.updated ?? undefined,
            campaignSource: campaign.source ?? undefined,
            campaignMedium: campaign.medium ?? undefined,
            campaignName: campaign.name ?? undefined,
            rawOrder: order,
          },
          update: {
            referenceId: extractReferenceId(order) ?? undefined,
            orderNumber: extractOrderNumber(order) ?? undefined,
            statusSlug: statusInfo.slug ?? undefined,
            statusName: statusInfo.name ?? undefined,
            fulfillmentStatus: extractFulfillmentStatus(order) ?? undefined,
            paymentStatus: extractPaymentStatus(order) ?? undefined,
            currency: currency ?? undefined,
            subtotalAmount: amounts.subtotal ?? undefined,
            taxAmount: amounts.tax ?? undefined,
            shippingAmount: amounts.shipping ?? undefined,
            discountAmount: amounts.discount ?? undefined,
            totalAmount: amounts.total ?? undefined,
            customerId: normalizers.id(customer?.id ?? order.customer_id) ?? undefined,
            customerName: customerName ?? undefined,
            customerMobile: normalizers.string(
              customer?.mobile ?? customer?.phone ?? order.customer_mobile ?? order.customer_phone
            ) ?? undefined,
            customerEmail: normalizers.string(customer?.email ?? order.customer_email) ?? undefined,
            customerCity: normalizers.string(
              customer?.city ?? order.shipping_address?.city ?? order.billing_address?.city
            ) ?? undefined,
            customerCountry: normalizers.string(
              customer?.country ?? order.shipping_address?.country ?? order.billing_address?.country
            ) ?? undefined,
            paymentMethod: extractPaymentMethod(order) ?? undefined,
            fulfillmentCompany: normalizers.string(order.shipping?.company) ?? undefined,
            trackingNumber: normalizers.string(order.shipping?.tracking_number) ?? undefined,
            placedAt: dates.created ?? undefined,
            updatedAtRemote: dates.updated ?? undefined,
            campaignSource: campaign.source ?? undefined,
            campaignMedium: campaign.medium ?? undefined,
            campaignName: campaign.name ?? undefined,
            rawOrder: order,
          },
        });

        stored += 1;
      } catch (error) {
        errors.push({
          orderId,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        log.error('Failed to store order', { merchantId, orderId, error });
      }
    }

    const totalPages = getTotalPages(response.pagination);
    if (totalPages) {
      if (page >= totalPages) {
        break;
      }
    } else if (orders.length === 0) {
      break;
    }

    page += 1;
  }

  return {
    merchantId,
    ordersFetched: fetched,
    ordersStored: stored,
    pagesProcessed,
    errors,
  };
}
