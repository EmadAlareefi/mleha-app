import { log } from '@/app/lib/logger';
import { roundMoney, type HistoryRefund, type SallaTransaction } from '@/app/lib/salla-transactions';

/**
 * Tabby payments API, used to refund Tabby orders: Salla marks Tabby
 * transactions as not refundable, so the money is returned on Tabby directly.
 *
 * Docs: https://docs.tabby.ai/api-reference/payments/refund-a-payment
 *   GET  /api/v2/payments/{id}           → payment (status, captures[], refunds[])
 *   GET  /api/v2/payments?created_at__gte=…&created_at__lte=…&limit=20&offset=…
 *   POST /api/v2/payments/{id}/refunds   → { amount: "12.50", reference_id, reason }
 *
 * Rules (Tabby docs): only a CLOSED payment can be refunded; partial refunds
 * are allowed up to the captured total; refunds within 180 days of payment;
 * `reference_id` is Tabby's idempotency key (a repeat with the same one does
 * not refund twice). KSA merchants use https://api.tabby.sa.
 *
 * Salla does not expose the Tabby payment id, so the payment is found by
 * listing Tabby payments around the order date and matching
 * `order.reference_id` to the Salla order number (as alesaei-app does).
 */

const DEFAULT_BASE = 'https://api.tabby.sa/api/v2';
const TIMEOUT_MS = 30_000;
const PAGE_SIZE = 20; // Tabby's max
const MAX_PAGES = 15;

export interface TabbyPayment {
  id: string;
  status?: string;
  amount?: string;
  currency?: string;
  created_at?: string;
  order?: { reference_id?: string | null } | null;
  meta?: { order_id?: string | number | null } | null;
  captures?: Array<{ id?: string; amount?: string; created_at?: string }> | null;
  refunds?: Array<{ id?: string; amount?: string; created_at?: string; reference_id?: string; reason?: string }> | null;
}

export class TabbyCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The refund may have happened; never resend it automatically. */
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'TabbyCallError';
  }
}

export interface TabbyTransport {
  call(method: string, path: string, body?: unknown): Promise<any>;
}

function baseUrl() {
  const configured = process.env.TABBY_BASE_URL?.trim().replace(/\/+$/, '');
  if (!configured) return DEFAULT_BASE;
  return /\/api\/v\d+$/i.test(configured) ? configured : `${configured}/api/v2`;
}

export function isTabbyConfigured() {
  return Boolean(process.env.TABBY_SECRET_KEY?.trim());
}

const productionTransport: TabbyTransport = {
  async call(method, path, body) {
    const key = process.env.TABBY_SECRET_KEY?.trim();
    if (!key) throw new TabbyCallError('مفتاح Tabby غير مضبوط (TABBY_SECRET_KEY).');
    let response: Response;
    try {
      response = await fetch(`${baseUrl()}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (error) {
      throw new TabbyCallError(
        `تعذر الاتصال بتابي: ${error instanceof Error ? error.message : 'unknown'}`,
        undefined,
        method !== 'GET',
      );
    }
    const text = await response.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (response.status >= 400) {
      const fields = Array.isArray(json?.errors) ? ` ${JSON.stringify(json.errors)}` : '';
      const message = json?.error || json?.message || text.slice(0, 300);
      throw new TabbyCallError(
        `تابي (${response.status}): ${message}${fields}`,
        response.status,
        response.status >= 500 && method !== 'GET',
      );
    }
    return json;
  },
};

let transport: TabbyTransport = productionTransport;
/** Test hook. */
export function setTabbyTransport(value: TabbyTransport | null) {
  transport = value ?? productionTransport;
}

const money = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : 0;
};

/** True when the Salla order was paid with Tabby. */
export function isTabbyOrder(transactions: SallaTransaction[], liveOrder?: any): boolean {
  const labels = [
    ...transactions.flatMap((tx) => [tx.payment_method?.slug, tx.payment_method?.name]),
    liveOrder?.payment_method,
    liveOrder?.payment_method?.slug,
  ];
  return labels.some((label) => typeof label === 'string' && /tabby|تابي/i.test(label));
}

export function getTabbyPayment(paymentId: string): Promise<TabbyPayment> {
  return transport.call('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

const ymd = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The Tabby payment of a Salla order: lists payments created from a day before
 * to a day after the order date and matches `order.reference_id` (Salla sends
 * the order number) or `meta.order_id`.
 */
export async function findTabbyPaymentForOrder(input: {
  references: Array<string | null | undefined>;
  placedAt: Date;
}): Promise<TabbyPayment | null> {
  const references = new Set(input.references.filter(Boolean).map((value) => String(value).trim()));
  if (references.size === 0) return null;
  // Full timestamps: the live API returns nothing for date-only values, even
  // though the docs show them (checked 2026-11-21).
  const from = `${ymd(new Date(input.placedAt.getTime() - 24 * 60 * 60 * 1000))}T00:00:00Z`;
  const to = `${ymd(new Date(input.placedAt.getTime() + 24 * 60 * 60 * 1000))}T23:59:59Z`;
  const matches = (payment: TabbyPayment) =>
    references.has(String(payment.order?.reference_id ?? '').trim()) ||
    references.has(String(payment.meta?.order_id ?? '').trim());

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      created_at__gte: from,
      created_at__lte: to,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    const body = await transport.call('GET', `/payments?${query}`);
    const payments: TabbyPayment[] = Array.isArray(body?.payments) ? body.payments : [];
    const found = payments.filter(matches);
    if (found.length > 0) {
      // A retried checkout can leave several; the captured one holds the money.
      return found.find((payment) => String(payment.status).toUpperCase() === 'CLOSED') ?? found[0];
    }
    const total = Number(body?.pagination?.total_count);
    if (payments.length < PAGE_SIZE || (Number.isFinite(total) && (page + 1) * PAGE_SIZE >= total)) break;
  }
  return null;
}

export type TabbyRefundOption =
  | { ok: true; payment: TabbyPayment; refundable: number; captured: number; currency: string }
  | { ok: false; reason: string };

/** Whether the payment can take a refund now, and how much is left to refund. */
export function tabbyRefundOption(payment: TabbyPayment): TabbyRefundOption {
  const status = String(payment.status || '').toUpperCase();
  const captured = roundMoney((payment.captures || []).reduce((sum, capture) => sum + money(capture.amount), 0));
  const refunded = roundMoney((payment.refunds || []).reduce((sum, refund) => sum + money(refund.amount), 0));
  if (status !== 'CLOSED' || captured <= 0) {
    return { ok: false, reason: `دفعة تابي غير قابلة للاسترجاع (الحالة ${status || 'غير معروفة'}).` };
  }
  const refundable = roundMoney(captured - refunded);
  if (refundable <= 0) return { ok: false, reason: 'تم استرجاع كامل مبلغ دفعة تابي مسبقاً.' };
  if (payment.created_at && Date.now() - new Date(payment.created_at).getTime() > 180 * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: 'انتهت مدة الاسترجاع في تابي (180 يوماً من الدفع).' };
  }
  return { ok: true, payment, refundable, captured, currency: payment.currency || 'SAR' };
}

/** Refunds already on the Tabby payment, in the shape of Salla history refunds. */
export function tabbyRefundsAsHistory(payment: TabbyPayment): HistoryRefund[] {
  return (payment.refunds || []).map((refund) => ({
    amount: money(refund.amount) || null,
    note: `استرجاع في تابي (${money(refund.amount)} ${payment.currency || 'SAR'})${refund.reason ? ` — ${refund.reason}` : ''}`,
    at: refund.created_at,
    by: 'Tabby',
  }));
}

export async function refundTabbyPayment(input: {
  paymentId: string;
  amount: number;
  refundable: number;
  referenceId: string;
  reason?: string;
}): Promise<TabbyPayment> {
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > input.refundable) {
    throw new TabbyCallError(`مبلغ الاسترجاع يجب أن يكون أكبر من صفر ولا يتجاوز ${input.refundable}.`);
  }
  log.info('Refunding Tabby payment', { paymentId: input.paymentId, amount, referenceId: input.referenceId });
  return transport.call('POST', `/payments/${encodeURIComponent(input.paymentId)}/refunds`, {
    amount: amount.toFixed(2),
    reference_id: input.referenceId,
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

/** `refundTransactionId` value for a Tabby refund: provider, payment, idempotency key. */
export const TABBY_REFUND_PREFIX = 'tabby:';
export function encodeTabbyRefundId(paymentId: string, referenceId: string) {
  return `${TABBY_REFUND_PREFIX}${paymentId}:${referenceId}`;
}
export function decodeTabbyRefundId(value: string | null | undefined) {
  if (!value?.startsWith(TABBY_REFUND_PREFIX)) return null;
  const [paymentId, ...rest] = value.slice(TABBY_REFUND_PREFIX.length).split(':');
  const referenceId = rest.join(':');
  return paymentId && referenceId ? { paymentId, referenceId } : null;
}
