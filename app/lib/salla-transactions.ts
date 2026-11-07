import { fetch as undiciFetch } from 'undici';
import { prisma } from '@/lib/prisma';
import { getSallaAccessToken, getSallaDispatcher } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

/**
 * Salla payments: list an order's transactions, refund one, and read refunds
 * back from the order history.
 *
 * Ported from alesaei-app `salla/services/order_item_removal.py`, which runs the
 * same calls in production:
 *   GET /transactions?order_id=…          → payments of the order
 *   PUT /transactions/{id}                → { action: "refund", amount, currency }
 *   GET /orders/{id}/histories            → "تم إرجاع مبلغ (35 ر.س) …" notes
 *
 * Salla treats a refund amount of 0 as a FULL refund, so amounts are always
 * checked to be > 0 and ≤ the transaction total. A refund whose outcome is
 * unknown (timeout, 5xx) is never sent again automatically.
 */

const BASE = 'https://api.salla.dev/admin/v2';
const TIMEOUT_MS = 30_000;
const HISTORY_PAGES = 3;

export const REFUNDABLE_STATUSES = new Set(['paid', 'partial_refunded']);
export const REFUNDED_STATUSES = new Set(['refunded', 'partial_refunded']);
const REFUND_NOTE = /(?:إرجاع|استرجاع|ارجاع)\s+(?:ال)?مبلغ/;
const REFUND_AMOUNT = /\(\s*([0-9٠-٩]+(?:[.,٫][0-9٠-٩]+)?)/;
const ARABIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.', ',': '.',
};

export const TRANSACTIONS_SCOPE = 'transactions.read_write';

export interface SallaTransaction {
  id: string | number;
  total?: { amount?: number | string; currency?: string } | null;
  status?: { slug?: string; name?: string } | null;
  available_actions?: string[] | null;
  payment_method?: {
    name?: string;
    slug?: string;
    is_refundable?: boolean;
    within_refund_period?: boolean;
  } | null;
}

export class SallaCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The write may have happened; never retry it automatically. */
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'SallaCallError';
  }
}

export interface SallaTransport {
  call(merchantId: string, method: string, path: string, body?: unknown): Promise<any>;
}

const productionTransport: SallaTransport = {
  async call(merchantId, method, path, body) {
    const token = await getSallaAccessToken(merchantId);
    if (!token) throw new SallaCallError('انتهت صلاحية توكن سلة.', 401);
    let response;
    try {
      response = await undiciFetch(`${BASE}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher: getSallaDispatcher() ?? undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (error) {
      throw new SallaCallError(
        `تعذر الاتصال بسلة: ${error instanceof Error ? error.message : 'unknown'}`,
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
    if (response.status >= 400 || json?.success === false) {
      const error = json?.error || {};
      const fields = error.fields ? ` ${JSON.stringify(error.fields)}` : '';
      const message = error.message || json?.message || text.slice(0, 300);
      throw new SallaCallError(
        `سلة (${response.status}): ${message}${fields}`,
        response.status,
        response.status >= 500 && method !== 'GET',
      );
    }
    return json;
  },
};

let transport: SallaTransport = productionTransport;
/** Test hook. */
export function setSallaTransactionsTransport(value: SallaTransport | null) {
  transport = value ?? productionTransport;
}

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

export async function listOrderTransactions(merchantId: string, orderId: string): Promise<SallaTransaction[]> {
  const body = await transport.call(merchantId, 'GET', `/transactions?order_id=${encodeURIComponent(orderId)}`);
  return Array.isArray(body?.data) ? body.data : [];
}

export type RefundOption =
  | { ok: true; transaction: SallaTransaction; total: number; currency: string }
  | { ok: false; reason: string; code: 'NO_PAYMENT' | 'MULTIPLE_PAYMENTS' | 'NOT_REFUNDABLE' | 'PERIOD_EXPIRED' };

/** The order's single refundable electronic payment, or why there is none. */
export function pickRefundableTransaction(transactions: SallaTransaction[]): RefundOption {
  const candidates = transactions.filter(
    (tx) =>
      (tx.available_actions || []).includes('refund') &&
      REFUNDABLE_STATUSES.has(String(tx.status?.slug || '')),
  );
  if (candidates.length === 0) {
    return { ok: false, code: 'NO_PAYMENT', reason: 'لا يوجد دفع إلكتروني قابل للاسترجاع لهذا الطلب في سلة.' };
  }
  if (candidates.length > 1) {
    return { ok: false, code: 'MULTIPLE_PAYMENTS', reason: 'يوجد أكثر من عملية دفع لهذا الطلب؛ استرجع المبلغ يدوياً.' };
  }
  const [transaction] = candidates;
  if (transaction.payment_method?.is_refundable === false) {
    return { ok: false, code: 'NOT_REFUNDABLE', reason: 'وسيلة الدفع لا تدعم الاسترجاع عبر سلة.' };
  }
  if (transaction.payment_method?.within_refund_period === false) {
    return { ok: false, code: 'PERIOD_EXPIRED', reason: 'انتهت مدة الاسترجاع لهذه العملية.' };
  }
  return {
    ok: true,
    transaction,
    total: roundMoney(Number(transaction.total?.amount) || 0),
    currency: transaction.total?.currency || 'SAR',
  };
}

/** Throws before any call when the amount would be a full or over-refund. */
export function assertRefundAmount(amount: number, transactionTotal: number) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > transactionTotal) {
    throw new SallaCallError(`مبلغ الاسترجاع يجب أن يكون أكبر من صفر ولا يتجاوز ${transactionTotal}.`);
  }
}

export async function refundTransaction(
  merchantId: string,
  transactionId: string | number,
  amount: number,
  currency: string,
  transactionTotal: number,
) {
  const safeAmount = roundMoney(amount);
  assertRefundAmount(safeAmount, transactionTotal);
  log.info('Refunding Salla transaction', { merchantId, transactionId, amount: safeAmount, currency });
  return transport.call(merchantId, 'PUT', `/transactions/${transactionId}`, {
    action: 'refund',
    amount: safeAmount,
    currency,
  });
}

export interface HistoryRefund {
  amount: number | null;
  note: string;
  at?: string;
  by?: string;
}

const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ');

export function parseHistoryRefunds(histories: any[]): HistoryRefund[] {
  const refunds: HistoryRefund[] = [];
  for (const entry of histories || []) {
    const note = stripTags(String(entry?.note || '')).split(/\s+/).filter(Boolean).join(' ');
    if (!REFUND_NOTE.test(note)) continue;
    const match = note.match(REFUND_AMOUNT);
    let amount: number | null = null;
    if (match) {
      const normalized = match[1].replace(/[٠-٩٫,]/g, (char) => ARABIC_DIGITS[char] ?? char);
      const parsed = Number(normalized);
      amount = Number.isFinite(parsed) ? roundMoney(parsed) : null;
    }
    refunds.push({
      amount,
      note,
      at: entry?.created_at?.date,
      by: entry?.created_by?.name || '',
    });
  }
  return refunds;
}

export async function findHistoryRefunds(merchantId: string, orderId: string): Promise<HistoryRefund[]> {
  const rows: any[] = [];
  for (let page = 1; page <= HISTORY_PAGES; page++) {
    const body = await transport.call(merchantId, 'GET', `/orders/${encodeURIComponent(orderId)}/histories?page=${page}`);
    rows.push(...(Array.isArray(body?.data) ? body.data : []));
    const totalPages = Number(body?.pagination?.totalPages) || 1;
    if (page >= totalPages) break;
  }
  return parseHistoryRefunds(rows);
}

export function hasScope(scopes: string[], required: string) {
  return scopes.includes(required) || (required.endsWith('.read') && scopes.includes(`${required}_write`));
}

export async function getMerchantScopes(merchantId: string): Promise<string[] | null> {
  const auth = await prisma.sallaAuth.findUnique({ where: { merchantId }, select: { scope: true } });
  if (!auth?.scope) return null; // Unknown: older tokens were stored without scopes.
  return auth.scope.split(/\s+/).filter(Boolean);
}
