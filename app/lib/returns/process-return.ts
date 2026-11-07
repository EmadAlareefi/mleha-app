import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { incrementSallaStock } from '@/app/lib/salla-stock';
import { createSallaOrderHistoryEntry, updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import { getSallaOrder } from '@/app/lib/salla-api';
import {
  findHistoryRefunds,
  listOrderTransactions,
  pickRefundableTransaction,
  refundTransaction,
  SallaCallError,
  type HistoryRefund,
} from '@/app/lib/salla-transactions';
import { computeRequestAmounts, issueExchangeCoupon, type RequestAmounts } from '@/app/lib/returns/exchange-coupon';
import { syncLocalReturnPickupTask } from '@/app/lib/returns/local-return-pickup';
import { allItemsInspected } from '@/lib/returns/workflow';
import { maybeReleaseExchangeOrderHold } from '@/app/lib/returns/exchange-order';
import { issueLeftoverCoupon } from '@/app/lib/returns/exchange-order-flow';

/**
 * One-click processing of a received and inspected return request:
 *
 *   1. restock   — pieces inspected as `good` go back to Salla stock
 *   2. refund    — return pieces are refunded on the order's Salla payment
 *   3. coupon    — exchange pieces become one exchange coupon (WhatsApp)
 *   4. salla     — order status + history note
 *   5. complete  — request closed
 *
 * Every step is idempotent and recorded in `processingAudit`, so "Retry"
 * re-runs only what is not done. A refund whose outcome is unknown is never
 * sent again; the auto-progress cron resolves it from the order history.
 * The customer's refund WhatsApp is sent by the existing `order.refunded`
 * webhook journey, which Salla fires for API refunds too.
 */

export const SALLA_DONE_STATUS_SLUG = process.env.RETURNS_SALLA_DONE_STATUS_SLUG ?? 'restored';
const DAMAGED_CONDITIONS = new Set(['damaged', 'worn', 'missing_parts']);

type Db = Pick<typeof prisma, 'returnRequest' | 'returnItem'>;
let db: Db = prisma;
/** Test hook: an in-memory stand-in for the two tables this module touches. */
export function setProcessReturnDb(value: Db | null) {
  db = value ?? prisma;
}

type Request = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

function loadRequest(id: string) {
  return db.returnRequest.findUnique({ where: { id }, include: { items: { orderBy: [{ orderItemId: 'asc' }, { unitIndex: 'asc' }] } } });
}

export interface ProcessDependencies {
  getOrder(merchantId: string, orderId: string): Promise<any>;
  listTransactions: typeof listOrderTransactions;
  historyRefunds(merchantId: string, orderId: string): Promise<HistoryRefund[]>;
  refund: typeof refundTransaction;
  restock(merchantId: string, item: { productId: string; variantId?: string | null; quantity: number }): Promise<{ ok: boolean; error?: string }>;
  issueCoupon(returnRequestId: string, liveOrder: any): Promise<{ ok: boolean; error?: string; couponCode?: string }>;
  setOrderStatus(merchantId: string, orderId: string, slug: string): Promise<{ success: boolean; error?: string }>;
  addOrderHistory(merchantId: string, orderId: string, note: string): Promise<{ success: boolean; error?: string }>;
  afterStatusChange(returnRequestId: string): Promise<void>;
  releaseExchangeOrder(returnRequestId: string): Promise<{ released: boolean; reason?: string }>;
  issueLeftoverCoupon(returnRequestId: string): Promise<{ code: string; amount: number } | null>;
}

export const productionDependencies: ProcessDependencies = {
  getOrder: (merchantId, orderId) => getSallaOrder(merchantId, orderId),
  listTransactions: listOrderTransactions,
  historyRefunds: findHistoryRefunds,
  refund: refundTransaction,
  async restock(merchantId, item) {
    const result = item.variantId
      ? await incrementSallaStock('variant_id', item.variantId, item.quantity, { merchantId })
      : await incrementSallaStock('product_id', item.productId, item.quantity, { merchantId });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },
  async issueCoupon(returnRequestId, liveOrder) {
    const result = await issueExchangeCoupon(returnRequestId, { liveOrder });
    return result.ok ? { ok: true, couponCode: result.couponCode } : { ok: false, error: result.error };
  },
  setOrderStatus: (merchantId, orderId, slug) => updateSallaOrderStatus(merchantId, orderId, { slug }),
  addOrderHistory: createSallaOrderHistoryEntry,
  afterStatusChange: (id) => syncLocalReturnPickupTask(id).then(() => undefined),
  releaseExchangeOrder: (id) => maybeReleaseExchangeOrderHold(id),
  issueLeftoverCoupon: (id) => issueLeftoverCoupon(id),
};

export interface AuditEntry {
  at: string;
  step: string;
  result: 'ok' | 'skipped' | 'failed' | 'unknown' | 'info';
  by?: string;
  details?: Record<string, unknown>;
}

async function appendAudit(id: string, entries: AuditEntry[], extra: Record<string, unknown> = {}) {
  const current = await db.returnRequest.findUnique({ where: { id }, select: { processingAudit: true } });
  const audit = Array.isArray(current?.processingAudit) ? (current!.processingAudit as unknown as AuditEntry[]) : [];
  await db.returnRequest.update({
    where: { id },
    data: { processingAudit: [...audit, ...entries] as any, ...extra },
  });
}

export interface RefundPlan {
  amount: number;
  currency: string;
  transactionId?: string;
  transactionTotal?: number;
  paymentMethod?: string;
  unavailableReason?: string;
  existingRefunds: HistoryRefund[];
}

export interface ProcessPreview {
  requestId: string;
  stage: 'ready' | 'not_ready' | 'closed';
  notReadyReason?: string;
  amounts: RequestAmounts;
  refund: RefundPlan | null;
  restock: Array<{ itemId: string; productName: string; variantName?: string | null; quantity: number; action: 'restock' | 'skip' | 'done' | 'unknown'; reason?: string }>;
  coupon: { amount: number; existingCode?: string | null } | null;
  exchangeOrder: {
    orderNumber: string | null;
    paymentStatus: string;
    amountDue: number;
    held: boolean;
    leftover: number;
  } | null;
  warnings: string[];
}

function sinceCreation(refunds: HistoryRefund[], createdAt: Date) {
  return refunds.filter((refund) => !refund.at || new Date(refund.at).getTime() >= createdAt.getTime() - 60_000);
}

/** What one-click processing will do, without doing it. */
export async function buildProcessPreview(
  requestId: string,
  deps: ProcessDependencies = productionDependencies,
): Promise<ProcessPreview | null> {
  const request = await loadRequest(requestId);
  if (!request) return null;

  const order = await deps.getOrder(request.merchantId, request.orderId).catch(() => null);
  const amounts = await computeRequestAmounts(request, order);
  const warnings: string[] = [];
  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status);
  const inspected = allItemsInspected(request.items);

  const restock = request.items.map((item) => {
    const base = { itemId: item.id, productName: item.productName, variantName: item.variantName, quantity: item.quantity };
    if (item.restockStatus === 'done') return { ...base, action: 'done' as const };
    if (item.restockStatus === 'requested') {
      return { ...base, action: 'unknown' as const, reason: 'لم يتأكد إرجاعها للمخزون، تحقق في سلة' };
    }
    if (item.conditionStatus === 'good') return { ...base, action: 'restock' as const };
    return { ...base, action: 'skip' as const, reason: item.conditionStatus ? 'القطعة ليست بحالة جيدة' : 'لم يتم فحص القطعة' };
  });

  const damagedReturnIncluded = request.items.filter(
    (item) => item.type === 'return' && item.refundIncluded && DAMAGED_CONDITIONS.has(item.conditionStatus || ''),
  );
  if (damagedReturnIncluded.length > 0) {
    warnings.push(`${damagedReturnIncluded.length} قطعة تالفة/مستخدمة مشمولة في الاسترجاع المالي`);
  }

  let refund: RefundPlan | null = null;
  if (amounts.refundAmount > 0 && request.refundStatus !== 'refunded') {
    refund = { amount: amounts.refundAmount, currency: amounts.currency, existingRefunds: [] };
    try {
      const [transactions, history] = await Promise.all([
        deps.listTransactions(request.merchantId, request.orderId),
        deps.historyRefunds(request.merchantId, request.orderId),
      ]);
      const option = pickRefundableTransaction(transactions);
      refund.existingRefunds = sinceCreation(history, request.createdAt);
      if (option.ok) {
        refund.transactionId = String(option.transaction.id);
        refund.transactionTotal = option.total;
        refund.paymentMethod = option.transaction.payment_method?.name || option.transaction.payment_method?.slug;
        refund.currency = option.currency;
        if (amounts.refundAmount > option.total) {
          warnings.push('مبلغ الاسترجاع أكبر من مبلغ الدفع');
        }
      } else {
        refund.unavailableReason = option.reason;
        warnings.push(`${option.reason} سيتم تحويله لاسترجاع يدوي.`);
      }
      if (refund.existingRefunds.length > 0) {
        warnings.push('يوجد استرجاع مسجل في سجل الطلب في سلة، تأكد قبل الاسترجاع مرة أخرى.');
      }
    } catch (error) {
      refund.unavailableReason = error instanceof Error ? error.message : 'تعذر قراءة مدفوعات الطلب من سلة';
      warnings.push(refund.unavailableReason);
    }
  }
  if (request.refundStatus === 'unknown') {
    warnings.push('نتيجة الاسترجاع السابق غير معروفة؛ تحقق منه في سلة قبل المتابعة.');
  }

  const hasExchange = request.items.some((item) => item.type === 'exchange');
  const orderMode = request.exchangeMode === 'order' && Boolean(request.exchangeOrderId);
  const coupon = hasExchange && !orderMode ? { amount: amounts.couponAmount, existingCode: request.couponCode } : null;
  const exchangeOrder = orderMode
    ? {
        orderNumber: request.exchangeOrderNumber,
        paymentStatus: request.exchangePaymentStatus,
        amountDue: Number(request.exchangeAmountDue) || 0,
        held: request.exchangeOrderHoldActive,
        leftover: Number(request.leftoverCouponAmount) || 0,
      }
    : null;
  if (orderMode && request.exchangePaymentStatus === 'pending') {
    warnings.push('العميل لم يدفع فرق طلب الاستبدال بعد.');
  }
  if (orderMode && request.items.some((item) => item.type === 'exchange' && item.conditionStatus !== 'good')) {
    warnings.push('القطعة المستبدلة ليست بحالة جيدة؛ قرري إرسال طلب الاستبدال أو إلغاءه من تفاصيل الطلب.');
  }

  return {
    requestId,
    stage: closed ? 'closed' : inspected ? 'ready' : 'not_ready',
    notReadyReason: closed ? 'الطلب مغلق' : inspected ? undefined : 'يجب فحص جميع القطع أولاً',
    amounts,
    refund,
    restock,
    coupon,
    exchangeOrder,
    warnings,
  };
}

export interface ProcessResult {
  ok: boolean;
  completed: boolean;
  error?: string;
  status?: number;
  blockers: string[];
}

export interface ProcessOptions {
  actor: string;
  /** Staff confirmed a refund found in the Salla order history is a different one. */
  ignoreExistingRefunds?: boolean;
  /**
   * Staff checked Salla and the pieces whose restock outcome was unknown (the
   * call was sent but its result never recorded) are already back in stock.
   */
  confirmUnknownRestocks?: boolean;
  /**
   * The refund was already made by hand from the Salla dashboard (pre-v2
   * requests): record it from the Salla order history instead of refunding.
   * Requires a refund in that history.
   */
  refundAlreadyInSalla?: boolean;
  /**
   * Pieces staff already returned to stock by hand in Salla: mark them done
   * without calling Salla again (that would count the stock twice).
   */
  alreadyRestockedItemIds?: string[];
}

/** A `processing` claim older than this is treated as abandoned (the function died). */
export const STALE_PROCESSING_MS = 5 * 60 * 1000;

/**
 * Takes the per-request processing lock. Succeeds when the request is idle or
 * needs attention, or when a previous run died holding it (no write for
 * STALE_PROCESSING_MS). Returns false when someone else is processing it.
 */
export async function claimProcessing(
  requestId: string,
  where: Record<string, unknown> = {},
  now: Date = new Date(),
): Promise<boolean> {
  const claimed = await db.returnRequest.updateMany({
    where: {
      id: requestId,
      ...where,
      OR: [
        { processingStatus: { in: ['idle', 'needs_attention'] } },
        { processingStatus: 'processing', updatedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
      ],
    },
    data: { processingStatus: 'processing', processingError: null },
  });
  return claimed.count > 0;
}

/** Runs every outstanding step. Safe to call again after a failure. */
export async function processReturnRequest(
  requestId: string,
  options: ProcessOptions,
  deps: ProcessDependencies = productionDependencies,
): Promise<ProcessResult> {
  const claimed = await claimProcessing(requestId, {
    status: { notIn: ['completed', 'cancelled', 'rejected'] },
  });
  if (!claimed) {
    return { ok: false, completed: false, status: 409, error: 'الطلب قيد المعالجة أو مغلق', blockers: [] };
  }

  const audit: AuditEntry[] = [];
  const blockers: string[] = [];
  const record = (step: string, result: AuditEntry['result'], details?: Record<string, unknown>) =>
    audit.push({ at: new Date().toISOString(), step, result, by: options.actor, details });

  try {
    let request = await loadRequest(requestId);
    if (!request) throw new Error('not found');
    if (!allItemsInspected(request.items)) {
      await db.returnRequest.update({ where: { id: requestId }, data: { processingStatus: 'idle' } });
      return { ok: false, completed: false, status: 400, error: 'يجب فحص جميع القطع قبل المعالجة', blockers: [] };
    }
    const order = await deps.getOrder(request.merchantId, request.orderId).catch(() => null);

    // 1. Restock good pieces only.
    for (const item of request.items) {
      if (item.restockStatus === 'done' || item.restockStatus === 'skipped') continue;
      if (item.restockStatus === 'requested') {
        // A previous run sent the restock but never recorded the result; sending
        // it again could add the stock twice. Staff confirm it in Salla instead.
        if (options.confirmUnknownRestocks) {
          await db.returnItem.update({ where: { id: item.id }, data: { restockStatus: 'done', restockedAt: new Date() } });
          record('restock', 'ok', { itemId: item.id, product: item.productName, confirmedByStaff: true });
        } else {
          record('restock', 'unknown', { itemId: item.id, product: item.productName });
          blockers.push(`لم يتأكد إرجاع "${item.productName}" للمخزون، تحقق منه في سلة ثم أكّد`);
        }
        continue;
      }
      if (item.conditionStatus === 'good' && options.alreadyRestockedItemIds?.includes(item.id)) {
        await db.returnItem.update({ where: { id: item.id }, data: { restockStatus: 'done', restockedAt: new Date() } });
        record('restock', 'ok', { itemId: item.id, product: item.productName, restockedOutsideApp: true });
        continue;
      }
      if (item.conditionStatus !== 'good') {
        await db.returnItem.update({ where: { id: item.id }, data: { restockStatus: 'skipped' } });
        record('restock', 'skipped', { itemId: item.id, product: item.productName, condition: item.conditionStatus });
        continue;
      }
      // Mark the call as sent first, so a crash mid-call is not retried blindly.
      await db.returnItem.update({ where: { id: item.id }, data: { restockStatus: 'requested' } });
      const result = await deps.restock(request.merchantId, {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      await db.returnItem.update({
        where: { id: item.id },
        data: result.ok ? { restockStatus: 'done', restockedAt: new Date() } : { restockStatus: 'failed' },
      });
      record('restock', result.ok ? 'ok' : 'failed', { itemId: item.id, product: item.productName, quantity: item.quantity, error: result.error });
      if (!result.ok) blockers.push(`تعذر إرجاع "${item.productName}" للمخزون: ${result.error}`);
    }

    request = (await loadRequest(requestId))!;
    const amounts = await computeRequestAmounts(request, order);

    // 2. Refund the return pieces.
    if (amounts.refundAmount > 0) {
      await runRefundStep(request, amounts, options, deps, record, blockers);
    } else if (request.items.some((item) => item.type === 'return')) {
      record('refund', 'skipped', { reason: 'مبلغ الاسترجاع صفر' });
    }

    // 3. Exchange: release the app-created replacement order, or issue the coupon.
    request = (await loadRequest(requestId))!;
    if (request.exchangeMode === 'order' && request.exchangeOrderId) {
      await runExchangeOrderStep(request, deps, record, blockers);
    } else if (request.items.some((item) => item.type === 'exchange') && !request.couponCode) {
      if (amounts.couponAmount > 0) {
        const result = await deps.issueCoupon(requestId, order ?? undefined).catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        record('coupon', result.ok ? 'ok' : 'failed', { amount: amounts.couponAmount, error: (result as any).error, code: (result as any).couponCode });
        if (!result.ok) blockers.push(`تعذر إنشاء كوبون الاستبدال: ${(result as any).error}`);
      } else {
        record('coupon', 'skipped', { reason: 'قيمة الكوبون صفر' });
      }
    }

    if (blockers.length > 0) {
      await appendAudit(requestId, audit, { processingStatus: 'needs_attention', processingError: blockers.join('\n') });
      return { ok: true, completed: false, blockers };
    }

    // 4. Salla order status + history note. Not blocking: the money is settled.
    request = (await loadRequest(requestId))!;
    const note = buildHistoryNote(request, amounts);
    if (SALLA_DONE_STATUS_SLUG) {
      const status = await deps.setOrderStatus(request.merchantId, request.orderId, SALLA_DONE_STATUS_SLUG);
      record('salla_status', status.success ? 'ok' : 'failed', { slug: SALLA_DONE_STATUS_SLUG, error: status.error });
    }
    const history = await deps.addOrderHistory(request.merchantId, request.orderId, note);
    record('salla_history', history.success ? 'ok' : 'failed', { error: history.error });

    // 5. Complete.
    record('complete', 'ok');
    await appendAudit(requestId, audit, {
      status: 'completed',
      processingStatus: 'done',
      processingError: null,
      processedBy: options.actor,
      processedAt: new Date(),
    });
    await deps.afterStatusChange(requestId).catch(() => undefined);
    return { ok: true, completed: true, blockers: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Return processing failed', { requestId, error });
    record('error', 'failed', { error: message });
    await appendAudit(requestId, audit, { processingStatus: 'needs_attention', processingError: message });
    return { ok: false, completed: false, status: 500, error: message, blockers: [message] };
  }
}

async function runRefundStep(
  request: Request,
  amounts: RequestAmounts,
  options: ProcessOptions,
  deps: ProcessDependencies,
  record: (step: string, result: AuditEntry['result'], details?: Record<string, unknown>) => void,
  blockers: string[],
) {
  switch (request.refundStatus) {
    case 'refunded':
      record('refund', 'skipped', { reason: 'تم الاسترجاع مسبقاً' });
      return;
    case 'requested':
    case 'unknown':
      blockers.push('نتيجة الاسترجاع السابق غير معروفة؛ تحقق منه في سلة ثم أكّد الاسترجاع يدوياً.');
      record('refund', 'unknown', { reason: 'previous outcome unknown, not resent' });
      return;
  }

  const [transactions, history] = await Promise.all([
    deps.listTransactions(request.merchantId, request.orderId),
    deps.historyRefunds(request.merchantId, request.orderId),
  ]);

  const existing = sinceCreation(history, request.createdAt);
  if (options.refundAlreadyInSalla) {
    // Never refund here: only record what the Salla history proves was paid.
    if (existing.length === 0) {
      blockers.push('لم يُعثر على استرجاع لهذا الطلب في سجل سلة، لا يمكن تسجيله كمسترجع من لوحة سلة.');
      record('refund', 'skipped', { reason: 'no refund in Salla history' });
      return;
    }
    const recorded = existing.reduce((sum, refund) => sum + (refund.amount ?? 0), 0);
    await db.returnRequest.update({
      where: { id: request.id },
      data: {
        refundStatus: 'refunded',
        refundedAmount: recorded > 0 ? recorded : amounts.refundAmount,
        refundedAt: new Date(),
        refundError: null,
      },
    });
    record('refund', 'ok', { refundedOutsideApp: true, amount: recorded > 0 ? recorded : amounts.refundAmount, sallaEvidence: existing });
    return;
  }
  if (existing.length > 0 && !options.ignoreExistingRefunds) {
    blockers.push('يوجد استرجاع مسجل في سجل الطلب في سلة. أكّد أنه استرجاع مختلف أو أغلقه كمسترجع.');
    record('refund', 'skipped', { reason: 'existing refund in Salla history', existing });
    return;
  }

  const option = pickRefundableTransaction(transactions);
  if (!option.ok) {
    await db.returnRequest.update({
      where: { id: request.id },
      data: { refundStatus: 'manual', refundError: option.reason },
    });
    blockers.push(`استرجاع يدوي مطلوب: ${option.reason}`);
    record('refund', 'skipped', { reason: option.reason, code: option.code, manual: true });
    return;
  }

  // Claim before calling Salla so two clicks can never send two refunds.
  const claim = await db.returnRequest.updateMany({
    where: { id: request.id, refundStatus: { in: ['none', 'failed', 'manual'] } },
    data: {
      refundStatus: 'requested',
      refundTransactionId: String(option.transaction.id),
      refundError: null,
    },
  });
  if (claim.count === 0) {
    blockers.push('تم إرسال طلب استرجاع لهذا الطلب مسبقاً.');
    return;
  }

  try {
    await deps.refund(request.merchantId, option.transaction.id, amounts.refundAmount, option.currency, option.total);
    await db.returnRequest.update({
      where: { id: request.id },
      data: { refundStatus: 'refunded', refundedAmount: amounts.refundAmount, refundedAt: new Date(), refundError: null },
    });
    record('refund', 'ok', { amount: amounts.refundAmount, currency: option.currency, transactionId: String(option.transaction.id) });
  } catch (error) {
    const unknown = error instanceof SallaCallError && error.outcomeUnknown;
    const message = error instanceof Error ? error.message : String(error);
    await db.returnRequest.update({
      where: { id: request.id },
      data: { refundStatus: unknown ? 'unknown' : 'failed', refundError: message },
    });
    blockers.push(unknown ? `نتيجة الاسترجاع غير معروفة: ${message}` : `فشل الاسترجاع: ${message}`);
    record('refund', unknown ? 'unknown' : 'failed', { amount: amounts.refundAmount, error: message });
  }
}

async function runExchangeOrderStep(
  request: Request,
  deps: ProcessDependencies,
  record: (step: string, result: AuditEntry['result'], details?: Record<string, unknown>) => void,
  blockers: string[],
) {
  const orderRef = request.exchangeOrderNumber || request.exchangeOrderId;
  if (request.exchangePaymentStatus === 'pending') {
    blockers.push(`بانتظار دفع العميل للفرق على طلب الاستبدال #${orderRef}.`);
    record('exchange_order', 'skipped', { reason: 'payment pending', order: orderRef });
    return;
  }
  const damaged = request.items.filter((item) => item.type === 'exchange' && item.conditionStatus !== 'good');
  if (damaged.length > 0 && request.exchangeOrderHoldActive) {
    blockers.push(
      `القطعة المستبدلة ليست بحالة جيدة (${damaged.map((item) => item.productName).join('، ')}). قرري إرسال طلب الاستبدال #${orderRef} أو إلغاءه.`,
    );
    record('exchange_order', 'skipped', { reason: 'exchanged piece not good', order: orderRef });
    return;
  }
  if (request.exchangeOrderHoldActive) {
    const result = await deps.releaseExchangeOrder(request.id).catch((error) => ({
      released: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
    record('exchange_order', result.released ? 'ok' : 'failed', { order: orderRef, reason: result.reason });
    if (!result.released) {
      blockers.push(`تعذر إطلاق طلب الاستبدال #${orderRef} للتجهيز: ${result.reason}`);
      return;
    }
  }
  if (Number(request.leftoverCouponAmount) > 0 && !request.leftoverCouponCode) {
    const leftover = await deps.issueLeftoverCoupon(request.id).catch((error) => {
      blockers.push(`تعذر إنشاء كوبون الرصيد المتبقي: ${error instanceof Error ? error.message : error}`);
      return null;
    });
    if (leftover) record('coupon', 'ok', { amount: leftover.amount, code: leftover.code, leftover: true });
  }
}

function buildHistoryNote(request: Request, amounts: RequestAmounts) {
  const currency = amounts.currency === 'SAR' ? 'ر.س' : amounts.currency;
  const lines = request.items.map((item) => {
    const type = item.type === 'exchange' ? 'استبدال' : 'استرجاع';
    const restock = item.restockStatus === 'done' ? 'أعيدت للمخزون' : 'لم تُعد للمخزون';
    return `- ${item.productName}${item.variantName ? ` (${item.variantName})` : ''} × ${item.quantity}: ${type}، ${restock}`;
  });
  const parts = [`تمت معالجة طلب الإرجاع ${request.orderNumber || ''} من نظام مليحة:`, ...lines];
  if (request.refundStatus === 'refunded' && request.refundedAmount) {
    parts.push(`المبلغ المسترجع: ${Number(request.refundedAmount).toFixed(2)} ${currency}`);
  }
  if (request.exchangeMode === 'order' && request.exchangeOrderNumber) {
    parts.push(`طلب الاستبدال: #${request.exchangeOrderNumber}`);
  } else if (request.couponCode) {
    parts.push(`كوبون الاستبدال: ${request.couponCode} (${amounts.couponAmount.toFixed(2)} ${currency})`);
  }
  if (request.leftoverCouponCode) {
    parts.push(`كوبون الرصيد المتبقي: ${request.leftoverCouponCode}`);
  }
  return parts.join('\n');
}

/**
 * Closes the refund step when the money was returned outside the app (bank
 * transfer, Salla dashboard). With `requireSallaEvidence`, only closes when a
 * refund shows up in the Salla order history.
 */
export async function markRefundedManually(
  requestId: string,
  options: { actor: string; amount?: number; note?: string; requireSallaEvidence?: boolean },
  deps: ProcessDependencies = productionDependencies,
): Promise<{ ok: boolean; error?: string }> {
  const request = await loadRequest(requestId);
  if (!request) return { ok: false, error: 'طلب الإرجاع غير موجود' };
  if (request.refundStatus === 'refunded') return { ok: true };
  // An automatic refund is being sent right now; recording a manual one too
  // would pay the customer twice.
  if (request.refundStatus === 'requested') {
    return { ok: false, error: 'يوجد استرجاع آلي قيد التنفيذ لهذا الطلب، انتظري نتيجته.' };
  }
  // The automatic refund may already have gone through in Salla; only accept
  // the refund history as proof, never a separate manual payment.
  if (request.refundStatus === 'unknown' && !options.requireSallaEvidence) {
    return { ok: false, error: 'نتيجة الاسترجاع الآلي غير معروفة، تحققي منها في سجل سلة بدلاً من استرجاع يدوي.' };
  }

  let evidence: HistoryRefund[] = [];
  if (options.requireSallaEvidence) {
    evidence = sinceCreation(await deps.historyRefunds(request.merchantId, request.orderId), request.createdAt);
    if (evidence.length === 0) return { ok: false, error: 'لم يُعثر على استرجاع لهذا الطلب في سجل سلة.' };
  }
  const amount = options.amount ?? evidence.reduce((sum, refund) => sum + (refund.amount ?? 0), 0);

  await db.returnRequest.update({
    where: { id: requestId },
    data: {
      refundStatus: 'refunded',
      refundedAmount: amount > 0 ? amount : request.totalRefundAmount,
      refundedAt: new Date(),
      refundError: null,
      processingStatus: request.processingStatus === 'processing' ? 'processing' : 'idle',
    },
  });
  await appendAudit(requestId, [{
    at: new Date().toISOString(),
    step: 'refund',
    result: 'ok',
    by: options.actor,
    details: { manual: true, amount, note: options.note, sallaEvidence: evidence.length > 0 ? evidence : undefined },
  }]);
  return { ok: true };
}
