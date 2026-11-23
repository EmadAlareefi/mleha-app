import {
  REFUNDED_STATUSES,
  SallaCallError,
  pickRefundableTransaction,
  roundMoney,
  type HistoryRefund,
  type SallaTransaction,
} from '@/app/lib/salla-transactions';
import type { EngineDeps, RefundStatus } from './engine';
import type { OrderManageSettings } from './settings';

/**
 * Refund after a customer cancels a paid order. Cancelling in Salla does not
 * give the money back by itself.
 *
 * The automatic path is deliberately narrow: one refundable payment, in SAR,
 * equal to the order total, with no earlier refund on the order, inside the
 * daily cap. Anything else waits for a person in the staff queue. Seen on the
 * live store (2026-11-11): mada, cards, Tamara, STC Pay and wallet payments
 * are refundable through Salla; Tabby is marked not refundable; bank transfers
 * and free orders have no transaction at all.
 */

export type RefundPlan =
  | { action: 'not_needed' }
  | { action: 'already_refunded'; transactionId: string; amount: number; currency: string }
  | { action: 'manual'; code: ManualCode; reason: string }
  | { action: 'auto'; transactionId: string | number; amount: number; currency: string; transactionTotal: number };

export type ManualCode =
  | 'NO_PAYMENT'
  | 'MULTIPLE_PAYMENTS'
  | 'NOT_REFUNDABLE'
  | 'PERIOD_EXPIRED'
  | 'PRIOR_REFUND'
  | 'CURRENCY'
  | 'AMOUNT_MISMATCH'
  | 'AUTO_OFF'
  | 'DAILY_CAP';

const manual = (code: ManualCode, reason: string): RefundPlan => ({ action: 'manual', code, reason });

const amountOf = (tx: SallaTransaction) => roundMoney(Number(tx.total?.amount) || 0);

export function decideRefund(input: {
  orderTotal: number | null;
  transactions: SallaTransaction[];
  historyRefunds: HistoryRefund[];
  settings: Pick<OrderManageSettings, 'autoRefundEnabled' | 'autoRefundDailyCapSar'>;
  autoRefundedTodaySar: number;
}): RefundPlan {
  const orderTotal = input.orderTotal === null ? null : roundMoney(input.orderTotal);

  if (input.transactions.length === 0) {
    if (orderTotal !== null && orderTotal <= 0) return { action: 'not_needed' };
    return manual('NO_PAYMENT', 'لا توجد عملية دفع إلكترونية لهذا الطلب في سلة (تحويل بنكي أو دفع خارج سلة).');
  }

  const option = pickRefundableTransaction(input.transactions);
  if (!option.ok) {
    // Salla may already have returned the money when the order was cancelled.
    const refunded = input.transactions.filter((tx) => String(tx.status?.slug || '') === 'refunded');
    if (option.code === 'NO_PAYMENT' && refunded.length === 1 && orderTotal !== null && Math.abs(amountOf(refunded[0]) - orderTotal) <= 0.01) {
      return {
        action: 'already_refunded',
        transactionId: String(refunded[0].id),
        amount: amountOf(refunded[0]),
        currency: refunded[0].total?.currency || 'SAR',
      };
    }
    return manual(option.code, option.reason);
  }

  const status = String(option.transaction.status?.slug || '');
  if (input.historyRefunds.length > 0 || REFUNDED_STATUSES.has(status)) {
    return manual('PRIOR_REFUND', 'يوجد استرجاع سابق على هذا الطلب؛ راجع المبلغ المتبقي واسترجعه يدوياً.');
  }
  if (option.currency.toUpperCase() !== 'SAR') {
    return manual('CURRENCY', `عملة الدفع ${option.currency}؛ الاسترجاع التلقائي للريال السعودي فقط.`);
  }
  if (orderTotal === null || Math.abs(option.total - orderTotal) > 0.01) {
    return manual('AMOUNT_MISMATCH', `مبلغ عملية الدفع (${option.total}) لا يطابق إجمالي الطلب (${orderTotal ?? 'غير معروف'}).`);
  }
  if (!input.settings.autoRefundEnabled) {
    return manual('AUTO_OFF', 'الاسترجاع التلقائي متوقف من الإعدادات.');
  }
  if (roundMoney(input.autoRefundedTodaySar + option.total) > input.settings.autoRefundDailyCapSar) {
    return manual('DAILY_CAP', 'تم تجاوز الحد اليومي للاسترجاع التلقائي.');
  }
  return {
    action: 'auto',
    transactionId: option.transaction.id,
    amount: option.total,
    currency: option.currency,
    transactionTotal: option.total,
  };
}

export type RefundRunResult = RefundStatus | 'skipped' | 'retry_later';

/** How long a refund may stay undecided because Salla could not be read. */
const GIVE_UP_AFTER_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

/**
 * Decides and, when safe, sends the refund for a completed cancel. Safe to
 * call repeatedly: the refund is claimed with a compare-and-set before Salla
 * is called, so it can never be sent twice. `staffRetry` lets a person re-run
 * a refund that definitely failed or was parked as manual.
 */
export async function processCancelRefund(
  deps: EngineDeps,
  changeId: string,
  settings: Pick<OrderManageSettings, 'autoRefundEnabled' | 'autoRefundDailyCapSar'>,
  options: { staffRetry?: boolean } = {},
): Promise<RefundRunResult> {
  const change = await deps.findChange(changeId);
  if (!change || change.kind !== 'cancel' || change.writeStatus !== 'done') return 'skipped';
  const from: RefundStatus[] = options.staffRetry ? ['none', 'failed', 'manual'] : ['none'];
  if (!from.includes(change.refundStatus)) return 'skipped';

  let transactions: SallaTransaction[];
  let historyRefunds: HistoryRefund[];
  try {
    [transactions, historyRefunds] = await Promise.all([
      deps.listTransactions(change.merchantId, change.orderId),
      deps.findHistoryRefunds(change.merchantId, change.orderId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (deps.now().getTime() - change.createdAt.getTime() < GIVE_UP_AFTER_MS) return 'retry_later';
    await deps.updateChange(change.id, { refundStatus: from }, {
      refundStatus: 'manual',
      refundAmount: change.orderTotal,
      refundError: `تعذر قراءة عمليات الدفع من سلة: ${message}`,
      step: { step: 'refund', result: 'manual', details: { code: 'READ_FAILED' } },
    });
    return 'manual';
  }

  const plan = decideRefund({
    orderTotal: change.orderTotal,
    transactions,
    historyRefunds,
    settings,
    autoRefundedTodaySar: await deps.autoRefundedSince(new Date(deps.now().getTime() - DAY_MS)),
  });

  if (plan.action === 'not_needed') {
    await deps.updateChange(change.id, { refundStatus: from }, {
      refundStatus: 'not_needed',
      refundError: null,
      step: { step: 'refund', result: 'not_needed' },
    });
    return 'not_needed';
  }
  if (plan.action === 'already_refunded') {
    await deps.updateChange(change.id, { refundStatus: from }, {
      refundStatus: 'refunded',
      refundAmount: plan.amount,
      refundTransactionId: plan.transactionId,
      currency: plan.currency,
      refundedAt: deps.now(),
      refundError: null,
      step: { step: 'refund', result: 'refunded_by_salla', details: { amount: plan.amount } },
    });
    return 'refunded';
  }
  if (plan.action === 'manual') {
    await deps.updateChange(change.id, { refundStatus: from }, {
      refundStatus: 'manual',
      refundAmount: change.orderTotal,
      refundError: plan.reason,
      step: { step: 'refund', result: 'manual', details: { code: plan.code } },
    });
    return 'manual';
  }

  // Claim before calling Salla, so two runs can never send two refunds.
  const claimed = await deps.updateChange(change.id, { refundStatus: from }, {
    refundStatus: 'requested',
    refundAmount: plan.amount,
    refundTransactionId: String(plan.transactionId),
    currency: plan.currency,
    refundError: null,
    step: { step: 'refund', result: 'requested', details: { amount: plan.amount, transactionId: String(plan.transactionId) } },
  });
  if (!claimed) return 'skipped';

  try {
    await deps.refund(change.merchantId, plan.transactionId, plan.amount, plan.currency, plan.transactionTotal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = error instanceof SallaCallError && error.outcomeUnknown;
    const next: RefundStatus = unknown ? 'unknown' : 'failed';
    await deps.updateChange(change.id, { refundStatus: 'requested' }, {
      refundStatus: next,
      refundError: message,
      step: { step: 'refund', result: next, details: { error: message } },
    });
    return next;
  }
  await deps.updateChange(change.id, { refundStatus: 'requested' }, {
    refundStatus: 'refunded',
    refundedAt: deps.now(),
    refundError: null,
    step: { step: 'refund', result: 'refunded', details: { amount: plan.amount } },
  });
  return 'refunded';
}

/**
 * A refund whose outcome was unknown is settled only by evidence: Salla
 * showing the payment as refunded. It is never sent again from here.
 */
export async function resolveUnknownRefund(deps: EngineDeps, changeId: string): Promise<'refunded' | 'unknown'> {
  const change = await deps.findChange(changeId);
  if (!change || change.refundStatus !== 'unknown' || !change.refundTransactionId) return 'unknown';
  const transactions = await deps.listTransactions(change.merchantId, change.orderId).catch(() => null);
  const tx = transactions?.find((row) => String(row.id) === change.refundTransactionId);
  if (!tx || String(tx.status?.slug || '') !== 'refunded') return 'unknown';
  await deps.updateChange(change.id, { refundStatus: 'unknown' }, {
    refundStatus: 'refunded',
    refundedAt: deps.now(),
    refundError: null,
    step: { step: 'refund', result: 'confirmed_from_salla' },
  });
  return 'refunded';
}
