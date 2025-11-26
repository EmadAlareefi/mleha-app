import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sallaMakeRequest } from './salla-oauth';
import { log } from './logger';

type AnyRecord = Record<string, any>;

interface PaginationMeta {
  count: number;
  total: number;
  per_page: number;
  current_page: number;
  total_pages: number;
}

interface SallaOrdersResponse {
  status: number;
  success: boolean;
  data: AnyRecord[];
  pagination?: PaginationMeta;
}

interface SallaInvoicesResponse {
  status: number;
  success: boolean;
  data: AnyRecord[];
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
  invoicesFetched: number;
  invoicesStored: number;
  ordersPagesProcessed: number;
  errors: {
    orderId?: string | null;
    invoiceId?: string | null;
    message: string;
  }[];
}

const DEFAULT_PER_PAGE = 50;

// Normalizer functions (same as before)
const normalizers = {
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
      const candidate =
        (value as AnyRecord).slug ??
        (value as AnyRecord).code ??
        (value as AnyRecord).status ??
        (value as AnyRecord).name ??
        (value as AnyRecord).value ??
        (value as AnyRecord).id ??
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
    }
    return null;
  },

  date(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  },
};

function pickFirst<T>(...values: (T | null | undefined)[]): T | null {
  for (const v of values) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Fetch orders from Salla API
 */
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

  // Add date filters if provided
  if (options?.startDate) {
    const startDateStr = options.startDate instanceof Date
      ? options.startDate.toISOString().split('T')[0]
      : options.startDate;
    query.append('date_from', startDateStr);
  }

  if (options?.endDate) {
    const endDateStr = options.endDate instanceof Date
      ? options.endDate.toISOString().split('T')[0]
      : options.endDate;
    query.append('date_to', endDateStr);
  }

  return sallaMakeRequest<SallaOrdersResponse>(merchantId, `/orders?${query.toString()}`);
}

/**
 * Fetch invoices for a specific order
 */
async function fetchOrderInvoices(
  merchantId: string,
  orderId: string
): Promise<SallaInvoicesResponse | null> {
  return sallaMakeRequest<SallaInvoicesResponse>(merchantId, `/orders/${orderId}/invoices`);
}

/**
 * Extract invoice data and store in database
 */
async function processAndStoreInvoice(
  merchantId: string,
  invoice: AnyRecord,
  order: AnyRecord
): Promise<void> {
  const invoiceId = normalizers.id(invoice.id);

  if (!invoiceId) {
    throw new Error('Invoice missing ID');
  }

  // Extract customer info (from order or invoice)
  const customer = invoice.customer || order.customer || null;
  const customerName = customer?.full_name || customer?.name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim() || null;

  // Extract amounts
  const amounts = invoice.amounts || invoice.totals || invoice.amount || {};
  const subtotalAmount = pickFirst(
    normalizers.amount(amounts.subtotal),
    normalizers.amount(invoice.subtotal),
    normalizers.amount(invoice.amount_before_tax)
  );
  const taxAmount = pickFirst(
    normalizers.amount(amounts.tax),
    normalizers.amount(invoice.tax),
    normalizers.amount(invoice.total_tax)
  );
  const totalAmount = pickFirst(
    normalizers.amount(amounts.total),
    normalizers.amount(invoice.total),
    normalizers.amount(invoice.amount_total),
    normalizers.amount(invoice.total_amount),
    normalizers.amount(invoice.amount)
  );
  const shippingAmount = pickFirst(
    normalizers.amount(amounts.shipping),
    normalizers.amount(invoice.shipping_total),
    normalizers.amount(invoice.shipping)
  );
  const discountAmount = pickFirst(
    normalizers.amount(amounts.discount),
    normalizers.amount(invoice.discount_total),
    normalizers.amount(invoice.discount)
  );

  // Upsert invoice
  await prisma.sallaInvoice.upsert({
    where: {
      merchantId_invoiceId: {
        merchantId,
        invoiceId,
      },
    },
    create: {
      merchantId,
      invoiceId,
      orderId: normalizers.id(order.id),
      orderNumber: normalizers.string(order.reference_id) || normalizers.string(order.id),
      invoiceNumber: normalizers.string(invoice.invoice_number) ||
                     normalizers.string(invoice.number) ||
                     invoiceId,
      status: normalizers.status(invoice.status),
      paymentStatus: normalizers.status(invoice.payment_status),
      currency: normalizers.string(invoice.currency) || normalizers.string(order.currency) || 'SAR',
      subtotalAmount,
      taxAmount,
      totalAmount,
      shippingAmount,
      discountAmount,
      issueDate: normalizers.date(invoice.issue_date) ||
                 normalizers.date(invoice.created_at) ||
                 normalizers.date(order.date?.created),
      dueDate: normalizers.date(invoice.due_date) || normalizers.date(invoice.expires_at),
      customerId: normalizers.id(customer?.id),
      customerName,
      customerMobile: normalizers.string(customer?.mobile) || normalizers.string(customer?.phone),
      customerEmail: normalizers.string(customer?.email),
      notes: normalizers.string(invoice.notes) || normalizers.string(invoice.note),
      rawInvoice: invoice,
      rawOrder: order,
    },
    update: {
      orderNumber: normalizers.string(order.reference_id) || normalizers.string(order.id),
      invoiceNumber: normalizers.string(invoice.invoice_number) ||
                     normalizers.string(invoice.number) ||
                     invoiceId,
      status: normalizers.status(invoice.status),
      paymentStatus: normalizers.status(invoice.payment_status),
      currency: normalizers.string(invoice.currency) || normalizers.string(order.currency) || 'SAR',
      subtotalAmount,
      taxAmount,
      totalAmount,
      shippingAmount,
      discountAmount,
      issueDate: normalizers.date(invoice.issue_date) ||
                 normalizers.date(invoice.created_at) ||
                 normalizers.date(order.date?.created),
      dueDate: normalizers.date(invoice.due_date) || normalizers.date(invoice.expires_at),
      customerId: normalizers.id(customer?.id),
      customerName,
      customerMobile: normalizers.string(customer?.mobile) || normalizers.string(customer?.phone),
      customerEmail: normalizers.string(customer?.email),
      notes: normalizers.string(invoice.notes) || normalizers.string(invoice.note),
      rawInvoice: invoice,
      rawOrder: order,
      updatedAt: new Date(),
    },
  });
}

/**
 * Sync invoices for a single merchant
 */
async function syncInvoicesForMerchant(
  merchantId: string,
  options: SyncOptions = {}
): Promise<SyncStats> {
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  let ordersPage = 1;
  let ordersFetched = 0;
  let invoicesFetched = 0;
  let invoicesStored = 0;
  let ordersPagesProcessed = 0;
  const errors: SyncStats['errors'] = [];

  log.info('Starting invoice sync for merchant', { merchantId, options });

  while (true) {
    // Step 1: Fetch orders page
    const ordersResponse = await fetchOrdersPage(merchantId, ordersPage, perPage, {
      startDate: options.startDate,
      endDate: options.endDate,
    });

    if (!ordersResponse || !ordersResponse.success) {
      const message = ordersResponse
        ? `Salla API returned unsuccessful response for orders page ${ordersPage}`
        : `Failed to fetch orders page ${ordersPage} from Salla API`;

      log.error(message, { merchantId, page: ordersPage });
      errors.push({ orderId: null, invoiceId: null, message });
      break;
    }

    const orders = ordersResponse.data || [];
    ordersFetched += orders.length;
    ordersPagesProcessed++;

    log.info('Fetched orders page', {
      merchantId,
      page: ordersPage,
      ordersCount: orders.length,
    });

    // Step 2: For each order, fetch its invoices
    for (const order of orders) {
      const orderId = normalizers.id(order.id);

      if (!orderId) {
        errors.push({
          orderId: null,
          invoiceId: null,
          message: 'Order missing ID',
        });
        continue;
      }

      try {
        // Fetch invoices for this order
        const invoicesResponse = await fetchOrderInvoices(merchantId, orderId);

        if (!invoicesResponse || !invoicesResponse.success) {
          log.warn('Failed to fetch invoices for order', { merchantId, orderId });
          errors.push({
            orderId,
            invoiceId: null,
            message: `Failed to fetch invoices for order ${orderId}`,
          });
          continue;
        }

        const invoices = invoicesResponse.data || [];
        invoicesFetched += invoices.length;

        log.info('Fetched invoices for order', {
          merchantId,
          orderId,
          invoicesCount: invoices.length,
        });

        // Step 3: Store each invoice
        for (const invoice of invoices) {
          try {
            await processAndStoreInvoice(merchantId, invoice, order);
            invoicesStored++;
          } catch (err: any) {
            const invoiceId = normalizers.id(invoice.id);
            log.error('Failed to store invoice', {
              merchantId,
              orderId,
              invoiceId,
              error: err.message,
            });
            errors.push({
              orderId,
              invoiceId,
              message: `Failed to store invoice: ${err.message}`,
            });
          }
        }
      } catch (err: any) {
        log.error('Error processing order invoices', {
          merchantId,
          orderId,
          error: err.message,
        });
        errors.push({
          orderId,
          invoiceId: null,
          message: `Error processing order: ${err.message}`,
        });
      }
    }

    // Check if there are more pages
    const pagination = ordersResponse.pagination;
    if (!pagination || ordersPage >= pagination.total_pages || orders.length === 0) {
      log.info('Completed invoice sync for merchant', {
        merchantId,
        ordersFetched,
        invoicesFetched,
        invoicesStored,
        ordersPagesProcessed,
        errorsCount: errors.length,
      });
      break;
    }

    ordersPage++;
  }

  return {
    merchantId,
    ordersFetched,
    invoicesFetched,
    invoicesStored,
    ordersPagesProcessed,
    errors,
  };
}

/**
 * Main sync function - syncs invoices for all merchants or specific merchant
 */
export async function syncSallaInvoices(options: SyncOptions = {}): Promise<SyncStats[]> {
  const merchants = options.merchantId
    ? [{ merchantId: options.merchantId }]
    : await prisma.sallaAuth.findMany({
        select: { merchantId: true },
      });

  if (merchants.length === 0) {
    log.warn('No merchants configured for invoice sync');
    return [];
  }

  const stats: SyncStats[] = [];
  for (const merchant of merchants) {
    stats.push(await syncInvoicesForMerchant(merchant.merchantId, options));
  }

  return stats;
}
