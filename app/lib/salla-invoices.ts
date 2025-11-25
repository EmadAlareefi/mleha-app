import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sallaMakeRequest } from './salla-oauth';
import { getSallaOrder } from './salla-api';
import { log } from './logger';

type AnyRecord = Record<string, any>;

interface PaginationMeta {
  count: number;
  total: number;
  per_page: number;
  current_page: number;
  total_pages: number;
}

interface SallaInvoicesResponse {
  status: number;
  success: boolean;
  data: AnyRecord[];
  pagination?: PaginationMeta;
}

interface SyncOptions {
  merchantId?: string;
  perPage?: number;
}

interface SyncStats {
  merchantId: string;
  invoicesFetched: number;
  invoicesStored: number;
  orderLookups: number;
  pagesProcessed: number;
  errors: {
    invoiceId?: string | null;
    message: string;
  }[];
}

const DEFAULT_PER_PAGE = 50;

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
    const str = typeof value === 'string'
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

function extractCustomer(invoice: AnyRecord, order?: AnyRecord | null): AnyRecord | null {
  return (
    invoice.customer ||
    invoice.client ||
    invoice.customer_data ||
    invoice.customerDetails ||
    order?.customer ||
    null
  );
}

function buildCustomerName(customer: AnyRecord | null): string | null {
  if (!customer) return null;
  const full =
    customer.name ||
    customer.full_name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
  return full ? full : null;
}

function extractNotes(invoice: AnyRecord): string | null {
  return (
    invoice.notes ||
    invoice.note ||
    invoice.description ||
    invoice.internal_note ||
    null
  );
}

function extractCurrency(invoice: AnyRecord): string | null {
  return pickFirst(
    normalizers.string(invoice.currency),
    normalizers.string(invoice.currency_code),
    normalizers.string(invoice.currencyCode),
    normalizers.string(invoice.amounts?.total?.currency),
    normalizers.string(invoice.amounts?.subtotal?.currency),
    normalizers.string(invoice.total_currency),
    normalizers.string(invoice.total?.currency),
    normalizers.string(invoice.amount?.currency)
  );
}

function extractOrderData(invoice: AnyRecord): AnyRecord | null {
  return (
    invoice.order ||
    invoice.order_data ||
    invoice.orderDetails ||
    invoice.related_order ||
    null
  );
}

function extractOrderNumber(invoice: AnyRecord, order: AnyRecord | null): string | null {
  return pickFirst(
    normalizers.string(invoice.order_number),
    normalizers.string(order?.reference_id),
    normalizers.string(order?.referenceId),
    normalizers.string(order?.order_number),
    normalizers.string(order?.number),
    normalizers.string(order?.id)
  );
}

function extractInvoiceNumber(invoice: AnyRecord): string | null {
  return pickFirst(
    normalizers.string(invoice.invoice_number),
    normalizers.string(invoice.invoiceNumber),
    normalizers.string(invoice.number),
    normalizers.string(invoice.reference_id),
    normalizers.string(invoice.reference),
    normalizers.string(invoice.serial_number),
    normalizers.string(invoice.id)
  );
}

function extractOrderId(invoice: AnyRecord, order: AnyRecord | null): string | null {
  return pickFirst(
    normalizers.id(invoice.order_id),
    normalizers.id(invoice.orderId),
    normalizers.id(order?.id),
    normalizers.id(order?.order_id),
    normalizers.id(order?.orderId)
  );
}

function extractAmounts(invoice: AnyRecord) {
  const amounts = invoice.amounts || invoice.totals || invoice.amount || {};
  return {
    subtotal: pickFirst(
      normalizers.amount(amounts.subtotal),
      normalizers.amount(invoice.subtotal),
      normalizers.amount(invoice.amount_before_tax)
    ),
    total: pickFirst(
      normalizers.amount(amounts.total),
      normalizers.amount(invoice.total),
      normalizers.amount(invoice.amount_total),
      normalizers.amount(invoice.total_amount),
      normalizers.amount(invoice.amount)
    ),
    tax: pickFirst(
      normalizers.amount(amounts.tax),
      normalizers.amount(invoice.tax),
      normalizers.amount(invoice.total_tax)
    ),
    shipping: pickFirst(
      normalizers.amount(amounts.shipping),
      normalizers.amount(invoice.shipping_total),
      normalizers.amount(invoice.shipping)
    ),
    discount: pickFirst(
      normalizers.amount(amounts.discount),
      normalizers.amount(invoice.discount),
      normalizers.amount(invoice.total_discount)
    ),
  };
}

function extractIssueDate(invoice: AnyRecord): Date | null {
  return pickFirst(
    normalizers.date(invoice.issue_date),
    normalizers.date(invoice.issueDate),
    normalizers.date(invoice.date?.issued),
    normalizers.date(invoice.date?.created),
    normalizers.date(invoice.created_at),
    normalizers.date(invoice.createdAt)
  );
}

function extractDueDate(invoice: AnyRecord): Date | null {
  return pickFirst(
    normalizers.date(invoice.due_date),
    normalizers.date(invoice.dueDate),
    normalizers.date(invoice.date?.due),
    normalizers.date(invoice.date?.expires)
  );
}

export async function fetchInvoicesPage(
  merchantId: string,
  page: number,
  perPage: number
): Promise<SallaInvoicesResponse | null> {
  const query = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
  });
  return sallaMakeRequest<SallaInvoicesResponse>(merchantId, `/invoices?${query.toString()}`);
}

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
    stats.push(await syncInvoicesForMerchant(merchant.merchantId, options.perPage));
  }

  return stats;
}

async function syncInvoicesForMerchant(
  merchantId: string,
  perPage: number = DEFAULT_PER_PAGE
): Promise<SyncStats> {
  let page = 1;
  let fetched = 0;
  let stored = 0;
  let lookups = 0;
  let pagesProcessed = 0;
  const errors: SyncStats['errors'] = [];
  const orderCache = new Map<string, AnyRecord | null>();

  while (true) {
    const response = await fetchInvoicesPage(merchantId, page, perPage);
    if (!response || !response.success) {
      const message = response
        ? `Salla API returned an unsuccessful response for page ${page}`
        : `Failed to fetch page ${page} from Salla API`;

      errors.push({
        invoiceId: null,
        message,
      });

      log.error('Failed to fetch invoices', {
        merchantId,
        page,
        responseStatus: response?.status,
        responseSuccess: response?.success,
      });
      break;
    }

    const invoices = response.data ?? [];
    fetched += invoices.length;
    pagesProcessed += 1;

    for (const invoice of invoices) {
      const invoiceId = extractInvoiceNumber(invoice) ?? normalizers.id(invoice.id);

      if (!invoiceId) {
        errors.push({ invoiceId: null, message: 'Missing invoice identifier' });
        continue;
      }

      try {
        let orderData = extractOrderData(invoice);
        const orderId = extractOrderId(invoice, orderData);

        if (!orderData && orderId) {
          if (!orderCache.has(orderId)) {
            orderCache.set(orderId, await getSallaOrder(merchantId, orderId));
            lookups += 1;
          }
          orderData = orderCache.get(orderId) || null;
        }

        const customer = extractCustomer(invoice, orderData);
        const amounts = extractAmounts(invoice);

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
            orderId: orderId ?? undefined,
            orderNumber: extractOrderNumber(invoice, orderData) ?? undefined,
            invoiceNumber: extractInvoiceNumber(invoice) ?? undefined,
            status: normalizers.status(invoice.status) ?? undefined,
            paymentStatus: normalizers.status(invoice.payment_status) ?? undefined,
            currency: extractCurrency(invoice) ?? undefined,
            subtotalAmount: amounts.subtotal ?? undefined,
            taxAmount: amounts.tax ?? undefined,
            totalAmount: amounts.total ?? undefined,
            shippingAmount: amounts.shipping ?? undefined,
            discountAmount: amounts.discount ?? undefined,
            issueDate: extractIssueDate(invoice) ?? undefined,
            dueDate: extractDueDate(invoice) ?? undefined,
            customerId: normalizers.id(invoice.customer_id ?? customer?.id) ?? undefined,
            customerName: buildCustomerName(customer) ?? undefined,
            customerMobile: normalizers.string(
              customer?.mobile ?? customer?.phone ?? invoice.customer_mobile ?? invoice.customer_phone
            ) ?? undefined,
            customerEmail: normalizers.string(customer?.email ?? invoice.customer_email) ?? undefined,
            notes: extractNotes(invoice) ?? undefined,
            rawInvoice: invoice,
            rawOrder: orderData ?? undefined,
          },
          update: {
            orderId: orderId ?? undefined,
            orderNumber: extractOrderNumber(invoice, orderData) ?? undefined,
            invoiceNumber: extractInvoiceNumber(invoice) ?? undefined,
            status: normalizers.status(invoice.status) ?? undefined,
            paymentStatus: normalizers.status(invoice.payment_status) ?? undefined,
            currency: extractCurrency(invoice) ?? undefined,
            subtotalAmount: amounts.subtotal ?? undefined,
            taxAmount: amounts.tax ?? undefined,
            totalAmount: amounts.total ?? undefined,
            shippingAmount: amounts.shipping ?? undefined,
            discountAmount: amounts.discount ?? undefined,
            issueDate: extractIssueDate(invoice) ?? undefined,
            dueDate: extractDueDate(invoice) ?? undefined,
            customerId: normalizers.id(invoice.customer_id ?? customer?.id) ?? undefined,
            customerName: buildCustomerName(customer) ?? undefined,
            customerMobile: normalizers.string(
              customer?.mobile ?? customer?.phone ?? invoice.customer_mobile ?? invoice.customer_phone
            ) ?? undefined,
            customerEmail: normalizers.string(customer?.email ?? invoice.customer_email) ?? undefined,
            notes: extractNotes(invoice) ?? undefined,
            rawInvoice: invoice,
            rawOrder: orderData ?? undefined,
          },
        });

        stored += 1;
      } catch (error) {
        errors.push({
          invoiceId,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        log.error('Failed to store invoice', { merchantId, invoiceId, error });
      }
    }

    const totalPages = response.pagination?.total_pages;
    if (!totalPages && invoices.length < perPage) {
      break;
    }
    if (totalPages && page >= totalPages) {
      break;
    }

    page += 1;
  }

  return {
    merchantId,
    invoicesFetched: fetched,
    invoicesStored: stored,
    orderLookups: lookups,
    pagesProcessed,
    errors,
  };
}
