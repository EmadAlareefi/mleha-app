import { prisma } from '@/lib/prisma';
import { mapWithConcurrency } from '@/lib/concurrency';
import { log } from '@/app/lib/logger';
import { createSallaCoupon, deleteSallaCoupon, generateCouponCode } from '@/app/lib/salla-coupons';
import { sendWhatsAppTemplate } from '@/app/lib/zoko';
import { normalizeKSA } from '@/app/lib/phone';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import { computeRequestAmounts } from '@/app/lib/returns/exchange-coupon';
import { withStaffLock, STAFF_LOCK_MESSAGE } from '@/app/lib/returns/request-lock';
import {
  cancelExchangeOrder,
  createPendingExchangeOrder,
  EXCHANGE_HOLD_STATUS_ID,
  EXCHANGE_RELEASE_STATUS_ID,
  getExchangeOrderState,
  getOriginalShipping,
  isOrderPaid,
  LEGACY_EXCHANGE_RELEASE_STATUS_ID,
  setExchangeOrderStatus,
  type ExchangeOrderState,
} from '@/app/lib/salla-exchange-order';
import { statusEcho } from '@/app/lib/order-prep/sync-rules';
import { ORIGINAL_SALLA_STATUSES, STATUS_IDS } from '@/SALLA_ORDER_STATUSES';
import {
  decideExchangeRelease,
  exchangePieceFailed,
  exchangeStatusMove,
  RELEASE_BLOCK_LABELS,
  type ExchangeStatusIds,
  type StatusMove,
} from '@/lib/returns/exchange-release';
import {
  getExchangeProduct,
  skuLabel,
  skuOrderOptions,
  type CatalogProduct,
} from '@/app/lib/returns/exchange-catalog';
import { toSallaCouponAmount } from '@/lib/returns/exchange-coupon-amount';
import {
  MAX_EXCHANGE_LINE_QUANTITY,
  MAX_EXCHANGE_LINES,
  planExchangeSettlement,
} from '@/lib/returns/exchange-settlement';

/**
 * Exchange v3: the replacements a customer picks on /returns become a Salla
 * order the app creates, discounted by the exchange credit (a single-use
 * coupon on that order). Any difference is paid through Salla's payment link.
 *
 * The order is held ("تحت المراجعة حجز قطع") until the returned pieces arrive
 * and pass inspection; releasing it is maybeReleaseExchangeOrderHold's job.
 * Leftover credit becomes a normal exchange coupon when the return is processed.
 */

export const EXCHANGE_PAYMENT_METHODS = (
  process.env.RETURNS_EXCHANGE_PAYMENT_METHODS ||
  'mada,credit_card,apple_pay,stc_pay,tabby_installment,tamara_installment'
)
  .split(',')
  .map((slug) => slug.trim())
  .filter((slug) => slug && !['cod', 'bank', 'free'].includes(slug));

/** Fallback when Salla does not report the pending window. */
const DEFAULT_PAYMENT_WINDOW_MS = 20 * 60 * 60 * 1000;
const MAX_PAYMENT_WINDOW_MS = 48 * 60 * 60 * 1000;
const CREDIT_COUPON_EXPIRY_DAYS = 3;

const PAYMENT_PENDING_IDS = [String(STATUS_IDS.PAYMENT_PENDING), String(ORIGINAL_SALLA_STATUSES.PAYMENT_PENDING.id)];
const BASE_NEW_ORDER_ID = String(ORIGINAL_SALLA_STATUSES.UNDER_REVIEW.id);

/** Salla statuses the hold/release moves read and write (compare-and-set). */
export const EXCHANGE_STATUS_IDS: ExchangeStatusIds = {
  hold: String(EXCHANGE_HOLD_STATUS_ID),
  release: String(EXCHANGE_RELEASE_STATUS_ID),
  holdFrom: [String(STATUS_IDS.NEW_ORDER), BASE_NEW_ORDER_ID, ...PAYMENT_PENDING_IDS],
  releaseFrom: [String(EXCHANGE_HOLD_STATUS_ID), String(LEGACY_EXCHANGE_RELEASE_STATUS_ID), BASE_NEW_ORDER_ID],
  paymentPending: PAYMENT_PENDING_IDS,
};

/** Prefix of `exchangeOrderError` when Salla refused the hold; the cron retries only these. */
export const EXCHANGE_HOLD_FAILED_PREFIX = 'تعذر حجز الطلب البديل في سلة: ';
/** Set right after inspection when a held replacement's exchanged piece is not good. */
export const EXCHANGE_PIECE_FAILED_MESSAGE =
  'القطعة المستبدلة ليست بحالة جيدة — قرري إرسال الطلب البديل رغم ذلك أو إلغاءه وتحويله لكوبون.';

// ---------------------------------------------------------------------------
// Dependencies (injectable for tests)
// ---------------------------------------------------------------------------
type Db = Pick<typeof prisma, 'returnRequest' | 'returnExchangeLine' | '$transaction'>;

export interface ExchangeFlowDeps {
  db: Db;
  getProduct(merchantId: string, productId: string): Promise<CatalogProduct | null>;
  getOriginalShipping: typeof getOriginalShipping;
  createOrder: typeof createPendingExchangeOrder;
  getOrder: typeof getExchangeOrderState;
  setStatus: typeof setExchangeOrderStatus;
  cancelOrder: typeof cancelExchangeOrder;
  createCoupon(merchantId: string, amount: number, prefix: string, options: { freeShipping: boolean; expiryDays: number }): Promise<{ id: string; code: string }>;
  deleteCoupon(merchantId: string, couponId: string): Promise<boolean>;
  /** 'skipped' when the template env var or the phone is missing. */
  notify(templateEnv: string, to: string | null | undefined, args: (string | number)[]): Promise<void | 'sent' | 'skipped'>;
  /** The exchange credit as processing computes it (honours a hand-set amount). */
  computeCredit(requestId: string): Promise<{ credit: number; currency: string }>;
  notifyCoupon: typeof notifyExchangeCoupon;
  /**
   * Writes a status we just set in Salla into the local order mirror, so the
   * order-prep queue sees it even if the following webhook is missed.
   */
  echoMirrorStatus(merchantId: string, orderId: string, statusId: number): Promise<void>;
  now(): Date;
}

export const productionExchangeDeps: ExchangeFlowDeps = {
  db: prisma,
  getProduct: (merchantId, productId) => getExchangeProduct(merchantId, productId, { fresh: true }),
  getOriginalShipping,
  createOrder: createPendingExchangeOrder,
  getOrder: getExchangeOrderState,
  setStatus: setExchangeOrderStatus,
  cancelOrder: cancelExchangeOrder,
  async createCoupon(merchantId, amount, prefix, options) {
    const expiry = new Date(Date.now() + options.expiryDays * 24 * 60 * 60 * 1000);
    const result = await createSallaCoupon(merchantId, {
      code: generateCouponCode(prefix),
      type: 'fixed',
      // Salla adds VAT on top of a fixed coupon's face value.
      amount: toSallaCouponAmount(amount),
      free_shipping: options.freeShipping,
      exclude_sale_products: false,
      expiry_date: expiry.toISOString(),
      usage_limit: 1,
      usage_limit_per_user: 1,
      active: true,
    });
    if (!result.success || !result.coupon) throw new Error(result.error || 'تعذر إنشاء الكوبون');
    return { id: String(result.coupon.id), code: String(result.coupon.code) };
  },
  deleteCoupon: deleteSallaCoupon,
  async notify(templateEnv, to, args) {
    const templateId = process.env[templateEnv];
    const recipient = normalizeKSA(to);
    if (!templateId || !recipient) {
      log.info('Exchange notification skipped', { templateEnv, hasTemplate: Boolean(templateId), hasRecipient: Boolean(recipient) });
      return 'skipped';
    }
    await sendWhatsAppTemplate({ to: recipient, templateId, args });
    return 'sent';
  },
  async computeCredit(requestId) {
    const request = await prisma.returnRequest.findUnique({ where: { id: requestId }, include: { items: true } });
    if (!request) return { credit: 0, currency: 'SAR' };
    const amounts = await computeRequestAmounts(request);
    return { credit: amounts.couponAmount, currency: amounts.currency };
  },
  notifyCoupon: notifyExchangeCoupon,
  async echoMirrorStatus(merchantId, orderId, statusId) {
    const echo = statusEcho(statusId);
    if (!echo) return;
    await prisma.sallaOrder.updateMany({ where: { merchantId, orderId }, data: echo });
  },
  now: () => new Date(),
};

const round = (value: number) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// 1. Price the replacement cart from Salla (never from the browser)
// ---------------------------------------------------------------------------
export interface RequestedExchangeLine {
  productId?: unknown;
  skuId?: unknown;
  quantity?: unknown;
}

export interface PricedExchangeLine {
  productId: string;
  skuId: string;
  sku: string | null;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  options: Array<{ id: string; value: string[] }>;
  quantity: number;
  unitPrice: number;
  currency: string;
}

export type PriceCartResult =
  | { ok: true; lines: PricedExchangeLine[]; total: number }
  | { ok: false; error: string };

export async function priceExchangeCart(
  merchantId: string,
  requested: RequestedExchangeLine[] | null | undefined,
  deps: Pick<ExchangeFlowDeps, 'getProduct'> = productionExchangeDeps,
): Promise<PriceCartResult> {
  if (!Array.isArray(requested) || requested.length === 0) {
    return { ok: false, error: 'الرجاء اختيار منتج بديل واحد على الأقل' };
  }
  // Merge repeats of the same SKU so the per-line cap cannot be bypassed.
  const merged = new Map<string, { productId: string; skuId: string; quantity: number }>();
  for (const line of requested) {
    const productId = String(line?.productId ?? '').replace(/\D/g, '');
    const skuId = String(line?.skuId ?? '').replace(/\D/g, '');
    const quantity = Number(line?.quantity);
    if (!productId || !skuId || !Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, error: 'بيانات المنتجات البديلة غير صحيحة' };
    }
    const key = `${productId}:${skuId}`;
    const existing = merged.get(key);
    merged.set(key, { productId, skuId, quantity: (existing?.quantity ?? 0) + quantity });
  }
  if (merged.size > MAX_EXCHANGE_LINES) {
    return { ok: false, error: `الحد الأقصى ${MAX_EXCHANGE_LINES} منتجات بديلة` };
  }

  const lines: PricedExchangeLine[] = [];
  for (const { productId, skuId, quantity } of merged.values()) {
    if (quantity > MAX_EXCHANGE_LINE_QUANTITY) {
      return { ok: false, error: `الحد الأقصى ${MAX_EXCHANGE_LINE_QUANTITY} قطع من نفس المنتج` };
    }
    const product = await deps.getProduct(merchantId, productId);
    const sku = product?.skus.find((candidate) => candidate.id === skuId);
    if (!product || !sku) {
      return { ok: false, error: 'أحد المنتجات البديلة لم يعد متوفراً' };
    }
    if (!sku.inStock || (sku.stock !== null && sku.stock < quantity)) {
      return { ok: false, error: `الكمية المطلوبة من "${product.name}" غير متوفرة حالياً` };
    }
    lines.push({
      productId,
      skuId,
      sku: sku.sku,
      name: product.name,
      variantName: skuLabel(product, sku) || null,
      imageUrl: product.imageUrl,
      options: skuOrderOptions(product, sku),
      quantity,
      unitPrice: sku.price,
      currency: product.currency,
    });
  }
  const total = round(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  return { ok: true, lines, total };
}

// ---------------------------------------------------------------------------
// 2. Create the order for a stored request
// ---------------------------------------------------------------------------
export type CreateExchangeOrderResult =
  | { ok: true; paymentUrl: string | null; orderNumber: string; amountDue: number; leftover: number }
  | { ok: false; error: string; fellBackToCoupon: boolean };

export async function createExchangeOrderForRequest(
  requestId: string,
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<CreateExchangeOrderResult> {
  const request = await deps.db.returnRequest.findUnique({ where: { id: requestId }, include: { exchangeLines: true } });
  if (!request || request.exchangeMode !== 'order') {
    return { ok: false, error: 'not an exchange-order request', fellBackToCoupon: true };
  }
  if (request.exchangeOrderId) {
    return {
      ok: true,
      paymentUrl: request.exchangePaymentStatus === 'pending' ? request.exchangeCheckoutUrl : null,
      orderNumber: request.exchangeOrderNumber || request.exchangeOrderId,
      amountDue: Number(request.exchangeAmountDue) || 0,
      leftover: Number(request.leftoverCouponAmount) || 0,
    };
  }

  // Claim the creation so two callers (customer submit + staff retry) cannot
  // each create a Salla order and a credit coupon. Released by the success or
  // failure write below. A coupon already carries the credit, so it blocks the
  // order (issueExchangeCoupon refuses the other way round).
  const claim = await deps.db.returnRequest.updateMany({
    where: { id: requestId, exchangeOrderId: null, couponCode: null, exchangePaymentStatus: { in: ['none', 'failed'] } },
    data: { exchangePaymentStatus: 'creating' },
  });
  if (claim.count === 0) {
    return { ok: false, error: 'طلب الاستبدال قيد الإنشاء حالياً', fellBackToCoupon: false };
  }

  const credit = Number(request.exchangeCreditAmount) || 0;
  const cartTotal = request.exchangeLines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity, 0);
  const plan = planExchangeSettlement(credit, cartTotal);
  let couponId: string | null = null;
  let orderId: string | null = null;

  try {
    if (!request.customerId) throw new Error('رقم العميل غير متوفر');
    const shipping = await deps.getOriginalShipping(request.merchantId, request.orderId);
    if (!shipping) throw new Error('تعذر قراءة عنوان الشحن من الطلب الأصلي');

    let couponCode: string | undefined;
    if (plan.creditApplied > 0) {
      // Free shipping: the exchange fee already paid for the shipment.
      const coupon = await deps.createCoupon(request.merchantId, plan.creditApplied, 'EXO', {
        freeShipping: true,
        expiryDays: CREDIT_COUPON_EXPIRY_DAYS,
      });
      couponId = coupon.id;
      couponCode = coupon.code;
    }

    const order = await deps.createOrder(request.merchantId, {
      customerId: request.customerId,
      courierId: shipping.courierId,
      shipTo: shipping.shipTo,
      couponCode,
      paymentMethod: plan.needsPayment ? request.exchangePaymentMethod : null,
      products: request.exchangeLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        options: Array.isArray(line.options) ? (line.options as any[]) : [],
      })),
    });
    orderId = order.id;

    // Salla's total is authoritative (VAT, coupon caps, rounding).
    const amountDue = round(order.remainingAmount);
    const needsPayment = amountDue > 0.009;
    if (needsPayment && !order.checkoutUrl) throw new Error('لم تُرجع سلة رابط الدفع');

    const now = deps.now();
    const windowMs = order.pendingSecondsLeft ? Math.min(order.pendingSecondsLeft * 1000, MAX_PAYMENT_WINDOW_MS) : DEFAULT_PAYMENT_WINDOW_MS;

    await deps.db.returnRequest.update({
      where: { id: requestId },
      data: {
        exchangeOrderId: order.id,
        exchangeOrderNumber: order.referenceId,
        exchangeOrderLinkedAt: now,
        exchangeOrderTotal: order.total,
        exchangeCreditApplied: plan.creditApplied,
        exchangeAmountDue: amountDue,
        exchangeCreditCouponId: couponId,
        exchangeCheckoutUrl: needsPayment ? order.checkoutUrl : null,
        exchangePaymentStatus: needsPayment ? 'pending' : 'not_required',
        exchangePaymentDueAt: needsPayment ? new Date(now.getTime() + windowMs) : null,
        exchangeOrderHoldActive: !needsPayment,
        exchangeOrderHeldAt: needsPayment ? null : now,
        leftoverCouponAmount: plan.leftover > 0 ? plan.leftover : null,
        exchangeOrderError: null,
      },
    });

    if (!needsPayment) {
      // Nothing to pay: hold straight away until the return is inspected. A
      // refused hold is recorded for the cron to retry; meanwhile the order
      // stays pending-payment in Salla and the prep queue skips held orders.
      await applyExchangeHold(
        { id: requestId, merchantId: request.merchantId, processingStatus: request.processingStatus, exchangeOrderError: null },
        order,
        deps,
      ).catch((error) => log.error('Failed to hold covered exchange order', { requestId, error }));
    }

    log.info('Exchange order created', { requestId, orderId: order.id, amountDue, leftover: plan.leftover });
    return {
      ok: true,
      paymentUrl: needsPayment ? order.checkoutUrl : null,
      orderNumber: order.referenceId,
      amountDue,
      leftover: plan.leftover,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Exchange order creation failed; falling back to coupon', { requestId, error: message });
    if (orderId) await deps.cancelOrder(request.merchantId, orderId).catch(() => undefined);
    if (couponId) await deps.deleteCoupon(request.merchantId, couponId).catch(() => undefined);
    await deps.db.returnRequest.update({
      where: { id: requestId },
      data: {
        exchangeMode: 'coupon',
        exchangePaymentStatus: 'failed',
        exchangeOrderError: message.slice(0, 2000),
        exchangeOrderId: null,
        exchangeOrderNumber: null,
        exchangeCreditCouponId: null,
      },
    });
    return { ok: false, error: message, fellBackToCoupon: true };
  }
}

// ---------------------------------------------------------------------------
// 3. Payment state: webhook + cron
// ---------------------------------------------------------------------------
type ExchangeRequest = NonNullable<Awaited<ReturnType<Db['returnRequest']['findUnique']>>>;

/** Applies a fresh Salla order state to the request. Idempotent. */
export async function applyExchangeOrderState(
  request: ExchangeRequest,
  state: ExchangeOrderState,
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<'paid' | 'cancelled' | 'unchanged'> {
  // 'expiring': the cron claimed an overdue order and is re-checking it.
  if (request.exchangePaymentStatus !== 'pending' && request.exchangePaymentStatus !== 'expiring') return 'unchanged';

  if (isOrderPaid(state)) {
    // Only the first caller (webhook, cron or status page) applies the payment.
    const claimed = await deps.db.returnRequest.updateMany({
      where: { id: request.id, exchangePaymentStatus: request.exchangePaymentStatus },
      data: {
        exchangePaymentStatus: 'paid',
        exchangeCheckoutUrl: null,
        exchangeOrderHoldActive: true,
        exchangeOrderHeldAt: deps.now(),
      },
    });
    if (claimed.count === 0) return 'unchanged';
    // Paid: Salla has just moved it to "طلب جديد". Release it right away if the
    // return already passed inspection; otherwise hold it until it does, or the
    // warehouse would start preparing it.
    await settlePaidExchangeOrder(request.id, state, deps).catch((error) =>
      log.error('Failed to hold or release paid exchange order', { requestId: request.id, error }),
    );
    return 'paid';
  }

  if (state.statusSlug === 'canceled' || state.statusSlug === 'deleted') {
    await expireExchangeOrder(request, deps, { alreadyCancelled: true, status: 'cancelled' });
    return 'cancelled';
  }

  if (state.checkoutUrl && state.checkoutUrl !== request.exchangeCheckoutUrl) {
    await deps.db.returnRequest.update({ where: { id: request.id }, data: { exchangeCheckoutUrl: state.checkoutUrl } });
  }
  return 'unchanged';
}

/** Webhook hook: called for every Salla order event. */
export async function syncExchangePaymentFromWebhook(
  merchantId: string,
  orderId: string | number | null | undefined,
  deps: ExchangeFlowDeps = productionExchangeDeps,
) {
  if (!orderId) return;
  const request = await deps.db.returnRequest.findFirst({
    where: { merchantId, exchangeOrderId: String(orderId), exchangeMode: 'order', exchangePaymentStatus: 'pending' },
  });
  if (!request) return;
  const state = await deps.getOrder(merchantId, String(orderId));
  await applyExchangeOrderState(request, state, deps);
}

/**
 * Unpaid past the deadline (or cancelled by Salla): cancel the order so the
 * stock is released, drop the credit coupon, and fall back to the classic
 * exchange coupon, issued when the return is processed.
 */
export async function expireExchangeOrder(
  request: ExchangeRequest,
  deps: ExchangeFlowDeps = productionExchangeDeps,
  options: { alreadyCancelled?: boolean; status?: 'expired' | 'cancelled' } = {},
) {
  if (request.exchangeOrderId && !options.alreadyCancelled) {
    await deps.cancelOrder(request.merchantId, request.exchangeOrderId);
  }
  if (request.exchangeCreditCouponId) {
    await deps.deleteCoupon(request.merchantId, request.exchangeCreditCouponId).catch(() => false);
  }
  await deps.db.returnRequest.update({
    where: { id: request.id },
    data: {
      exchangeMode: 'coupon',
      exchangePaymentStatus: options.status ?? 'expired',
      exchangeCheckoutUrl: null,
      exchangeCreditCouponId: null,
      exchangeOrderHoldActive: false,
      leftoverCouponAmount: null,
    },
  });
  await deps
    .notify('ZOKO_TPL_EXCHANGE_ORDER_EXPIRED', request.customerPhone, [
      request.customerName || 'عميلنا العزيز',
      request.exchangeOrderNumber || '',
    ])
    .catch((error) => log.warn('Exchange expiry notification failed', { requestId: request.id, error }));
}

export interface ExchangeMaintenanceReport {
  paid: number;
  reminded: number;
  expired: number;
  errors: number;
  holdsReleased: number;
  holdsReapplied: number;
}

/** Cron: backup for missed webhooks, reminders, expiry, and stuck holds. */
export async function runExchangePaymentMaintenance(
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<ExchangeMaintenanceReport> {
  const report: ExchangeMaintenanceReport = { paid: 0, reminded: 0, expired: 0, errors: 0, holdsReleased: 0, holdsReapplied: 0 };
  const pending = await deps.db.returnRequest.findMany({
    where: { exchangeMode: 'order', exchangePaymentStatus: 'pending', exchangeOrderId: { not: null } },
    take: 100,
  });
  const now = deps.now();

  // Each request is independent; a few at a time keeps the cron well inside
  // its time limit without bursting Salla's rate limit.
  await mapWithConcurrency(pending, 5, async (request) => {
    try {
      const state = await deps.getOrder(request.merchantId, request.exchangeOrderId!);
      const outcome = await applyExchangeOrderState(request, state, deps);
      if (outcome === 'paid') {
        report.paid++;
        return;
      }
      if (outcome === 'cancelled') {
        report.expired++;
        return;
      }
      const dueAt = request.exchangePaymentDueAt;
      if (dueAt && now.getTime() >= dueAt.getTime()) {
        // Claim the expiry so the webhook/status page cannot mark it paid while
        // we cancel, then re-check Salla: a payment that just landed wins.
        const claimed = await deps.db.returnRequest.updateMany({
          where: { id: request.id, exchangePaymentStatus: 'pending' },
          data: { exchangePaymentStatus: 'expiring' },
        });
        if (claimed.count === 0) return;
        try {
          const latest = await deps.getOrder(request.merchantId, request.exchangeOrderId!);
          if (isOrderPaid(latest)) {
            const outcome = await applyExchangeOrderState({ ...request, exchangePaymentStatus: 'expiring' }, latest, deps);
            if (outcome === 'paid') report.paid++;
            return;
          }
          await expireExchangeOrder(request, deps);
          report.expired++;
        } catch (error) {
          await deps.db.returnRequest
            .updateMany({ where: { id: request.id, exchangePaymentStatus: 'expiring' }, data: { exchangePaymentStatus: 'pending' } })
            .catch(() => undefined);
          throw error;
        }
        return;
      }
      // One reminder in the second half of the payment window.
      const createdAt = request.exchangeOrderLinkedAt ?? request.createdAt;
      const halfway = dueAt ? createdAt.getTime() + (dueAt.getTime() - createdAt.getTime()) / 2 : null;
      if (!request.exchangeReminderSentAt && halfway && now.getTime() >= halfway) {
        const claimed = await deps.db.returnRequest.updateMany({
          where: { id: request.id, exchangeReminderSentAt: null },
          data: { exchangeReminderSentAt: now },
        });
        if (claimed.count === 0) return;
        await deps.notify('ZOKO_TPL_EXCHANGE_PAYMENT_PENDING', request.customerPhone, [
          request.customerName || 'عميلنا العزيز',
          request.exchangeOrderNumber || '',
          `${Number(request.exchangeAmountDue || 0).toFixed(2)} ${request.currency === 'SAR' ? 'ر.س' : request.currency}`,
          state.checkoutUrl || request.exchangeCheckoutUrl || '',
        ]);
        report.reminded++;
      }
    } catch (error) {
      report.errors++;
      log.error('Exchange payment maintenance failed', { requestId: request.id, error });
    }
  });

  const holds = await reconcileExchangeHolds(deps).catch((error) => {
    log.error('Exchange hold reconcile failed', { error });
    return { released: 0, reheld: 0, errors: 1 };
  });
  report.holdsReleased = holds.released;
  report.holdsReapplied = holds.reheld;
  report.errors += holds.errors;
  return report;
}

// ---------------------------------------------------------------------------
// 4. Hold and release ("تحت المراجعة حجز قطع" → "طلب جديد")
// ---------------------------------------------------------------------------
type HeldRequest = {
  id: string;
  merchantId: string;
  processingStatus?: string | null;
  exchangeOrderError?: string | null;
};

type AuditEntryInput = { step: string; result: 'ok' | 'skipped' | 'failed' | 'info'; by?: string; details?: Record<string, unknown> };

async function appendFlowAudit(deps: ExchangeFlowDeps, id: string, entry: AuditEntryInput) {
  const current = await deps.db.returnRequest.findUnique({ where: { id }, select: { processingAudit: true } });
  const entries = Array.isArray(current?.processingAudit) ? (current!.processingAudit as unknown[]) : [];
  await deps.db.returnRequest.update({
    where: { id },
    data: { processingAudit: [...entries, { at: deps.now().toISOString(), by: 'system', ...entry }] as any },
  });
}

/**
 * Tells staff the replacement needs a decision: stores the reason and, when
 * nobody is processing the request, moves it to "يحتاج تدخل".
 */
async function flagExchangeAttention(request: HeldRequest, message: string, deps: ExchangeFlowDeps) {
  await deps.db.returnRequest.update({ where: { id: request.id }, data: { exchangeOrderError: message.slice(0, 2000) } });
  await deps.db.returnRequest.updateMany({
    where: { id: request.id, processingStatus: 'idle' },
    data: { processingStatus: 'needs_attention', processingError: message },
  });
}

const liveLabel = (live: ExchangeOrderState) => live.statusName || live.customStatusId || live.statusSlug || 'غير معروفة';

/**
 * Puts the replacement order on "تحت المراجعة حجز قطع" (compare-and-set
 * against `live`). Never throws for Salla errors: a refused hold is recorded
 * with EXCHANGE_HOLD_FAILED_PREFIX and retried by reconcileExchangeHolds.
 */
export async function applyExchangeHold(
  request: HeldRequest,
  live: ExchangeOrderState,
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<'held' | 'already' | 'failed' | 'skipped'> {
  const move = exchangeStatusMove('hold', live, EXCHANGE_STATUS_IDS);
  if (move === 'write') {
    try {
      await deps.setStatus(request.merchantId, live.id, EXCHANGE_HOLD_STATUS_ID);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.db.returnRequest.update({
        where: { id: request.id },
        data: { exchangeOrderError: `${EXCHANGE_HOLD_FAILED_PREFIX}${message}`.slice(0, 2000) },
      });
      log.error('Failed to hold exchange order', { requestId: request.id, orderId: live.id, error: message });
      return 'failed';
    }
    await deps.echoMirrorStatus(request.merchantId, live.id, EXCHANGE_HOLD_STATUS_ID).catch(() => undefined);
  }
  if (move === 'write' || move === 'already') {
    if ((request.exchangeOrderError || '').startsWith(EXCHANGE_HOLD_FAILED_PREFIX)) {
      await deps.db.returnRequest.update({ where: { id: request.id }, data: { exchangeOrderError: null } });
    }
    return move === 'write' ? 'held' : 'already';
  }
  // Packed, cancelled or moved by hand in Salla: never fight it, tell staff.
  const message =
    move === 'progressed'
      ? `بدأ تجهيز أو شحن الطلب البديل في سلة (${liveLabel(live)}) قبل فحص المرتجع.`
      : move === 'cancelled'
        ? 'الطلب البديل ملغي في سلة.'
        : `حالة الطلب البديل في سلة تغيّرت يدوياً (${liveLabel(live)})، لم يتم حجزه.`;
  await flagExchangeAttention(request, message, deps);
  return 'skipped';
}

/** After payment: release now when the return already passed inspection, else hold. */
async function settlePaidExchangeOrder(requestId: string, live: ExchangeOrderState, deps: ExchangeFlowDeps) {
  const fresh = await deps.db.returnRequest.findUnique({ where: { id: requestId }, include: { items: true } });
  if (!fresh) return;
  const candidate = { ...fresh, items: (fresh as any).items ?? [] };
  if (decideExchangeRelease(candidate).release) {
    await releaseExchangeOrderHold(requestId, { source: 'payment', live }, deps);
    return;
  }
  await applyExchangeHold(fresh, live, deps);
}

export interface ReleaseOptions {
  /** Staff chose to ship despite the inspection ("إرسال الطلب الآن"). */
  force?: boolean;
  actor?: string;
  source?: 'inspection' | 'payment' | 'processing' | 'staff' | 'cron' | 'update';
  /** A live order state the caller already fetched (skips one Salla read). */
  live?: ExchangeOrderState;
}

export interface ReleaseResult {
  released: boolean;
  reason?: string;
  /** Arabic explanation for staff when not released. */
  message?: string;
  outcome?: StatusMove;
}

/**
 * Moves a held replacement order to "طلب جديد" so order-prep packs it, once
 * payment is settled and the exchanged pieces passed inspection (or `force`).
 * Compare-and-set against Salla's live status; idempotent.
 */
export async function releaseExchangeOrderHold(
  requestId: string,
  options: ReleaseOptions = {},
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<ReleaseResult> {
  const request = await deps.db.returnRequest.findUnique({ where: { id: requestId }, include: { items: true } });
  if (!request) return { released: false, reason: 'not_found', message: 'طلب الإرجاع غير موجود' };
  const candidate = { ...request, items: (request as any).items ?? [] };
  const decision = decideExchangeRelease(candidate, { force: options.force });
  if (!decision.release) {
    return { released: false, reason: decision.reason, message: RELEASE_BLOCK_LABELS[decision.reason] };
  }

  const orderId = request.exchangeOrderId!;
  const orderRef = request.exchangeOrderNumber || orderId;
  const actor = options.actor || 'system';
  let live = options.live && String(options.live.id) === String(orderId) ? options.live : null;
  if (!live) {
    try {
      live = await deps.getOrder(request.merchantId, orderId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { released: false, reason: 'salla_unreachable', message: `تعذر قراءة الطلب البديل من سلة: ${message}` };
    }
  }

  const move = exchangeStatusMove('release', live, EXCHANGE_STATUS_IDS, {
    allowReleaseFromPaymentPending: request.exchangePaymentStatus === 'not_required',
  });
  if (move === 'cancelled' || move === 'conflict') {
    const message =
      move === 'cancelled'
        ? `الطلب البديل #${orderRef} ملغي في سلة؛ لا يمكن إرساله للتجهيز.`
        : `حالة الطلب البديل #${orderRef} في سلة تغيّرت يدوياً (${liveLabel(live)})، لم يتم تحويله إلى طلب جديد.`;
    await flagExchangeAttention(request, message, deps);
    await appendFlowAudit(deps, requestId, {
      step: 'exchange_order',
      result: 'failed',
      by: actor,
      details: { release: true, outcome: move, order: orderRef, reason: message, source: options.source },
    });
    return { released: false, reason: move, message, outcome: move };
  }

  if (move === 'write') {
    try {
      await deps.setStatus(request.merchantId, orderId, EXCHANGE_RELEASE_STATUS_ID);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Failed to release exchange order', { requestId, orderId, error: message });
      return { released: false, reason: 'status_update_failed', message: `تعذر تحويل الطلب البديل إلى "طلب جديد": ${message}` };
    }
  }

  const cleared = await deps.db.returnRequest.updateMany({
    where: { id: requestId, exchangeOrderHoldActive: true },
    data: { exchangeOrderHoldActive: false, exchangeOrderReleasedAt: deps.now(), exchangeOrderError: null },
  });
  if (cleared.count === 0) return { released: false, reason: 'no_active_hold', message: RELEASE_BLOCK_LABELS.no_active_hold };
  if (move === 'write' || move === 'already') {
    await deps.echoMirrorStatus(request.merchantId, orderId, EXCHANGE_RELEASE_STATUS_ID).catch(() => undefined);
  }
  // The inspection flag this module raised no longer applies.
  if (request.processingStatus === 'needs_attention' && (request.processingError || '').includes(EXCHANGE_PIECE_FAILED_MESSAGE)) {
    await deps.db.returnRequest.updateMany({
      where: { id: requestId, processingStatus: 'needs_attention' },
      data: { processingStatus: 'idle', processingError: null },
    });
  }
  await appendFlowAudit(deps, requestId, {
    step: 'exchange_order',
    result: 'ok',
    by: actor,
    details: { released: true, forced: options.force === true, outcome: move, order: orderRef, source: options.source },
  });
  log.info('Released exchange order hold', { requestId, orderId, outcome: move, forced: options.force === true });
  return { released: true, outcome: move };
}

/**
 * After inspection: when a replacement order exists (unpaid or paid) and an
 * exchanged piece failed, staff must decide now — ship anyway or cancel the
 * replacement — instead of discovering it at processing. Clears the flag again
 * once no exchanged piece is failing (e.g. re-inspected as good).
 */
export async function syncFailedExchangePieceFlag(
  requestId: string,
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<'flagged' | 'cleared' | 'unchanged'> {
  const request = await deps.db.returnRequest.findUnique({ where: { id: requestId }, include: { items: true } });
  if (!request) return 'unchanged';
  const activeOrder =
    request.exchangeMode === 'order' &&
    Boolean(request.exchangeOrderId) &&
    ['pending', 'paid', 'not_required'].includes(request.exchangePaymentStatus);
  const failing = activeOrder && exchangePieceFailed({ exchangeMode: request.exchangeMode, items: (request as any).items ?? [] });
  if (failing) {
    const flagged = await deps.db.returnRequest.updateMany({
      where: { id: requestId, processingStatus: 'idle' },
      data: { processingStatus: 'needs_attention', processingError: EXCHANGE_PIECE_FAILED_MESSAGE },
    });
    return flagged.count > 0 ? 'flagged' : 'unchanged';
  }
  if (request.processingStatus === 'needs_attention' && request.processingError === EXCHANGE_PIECE_FAILED_MESSAGE) {
    const cleared = await deps.db.returnRequest.updateMany({
      where: { id: requestId, processingStatus: 'needs_attention', processingError: EXCHANGE_PIECE_FAILED_MESSAGE },
      data: { processingStatus: 'idle', processingError: null },
    });
    return cleared.count > 0 ? 'cleared' : 'unchanged';
  }
  return 'unchanged';
}

export interface HoldReconcileReport {
  released: number;
  reheld: number;
  errors: number;
}

/**
 * Cron safety net for paid, held replacements: release the ones whose return
 * passed inspection, and retry holds Salla refused (only those — a status staff
 * changed by hand in Salla is never overwritten).
 */
export async function reconcileExchangeHolds(deps: ExchangeFlowDeps = productionExchangeDeps): Promise<HoldReconcileReport> {
  const report: HoldReconcileReport = { released: 0, reheld: 0, errors: 0 };
  const held = await deps.db.returnRequest.findMany({
    where: {
      exchangeMode: 'order',
      exchangeOrderHoldActive: true,
      exchangeOrderId: { not: null },
      exchangePaymentStatus: { in: ['paid', 'not_required'] },
    },
    include: { items: true },
    take: 50,
  });
  await mapWithConcurrency(held, 5, async (request) => {
    try {
      const candidate = { ...request, items: (request as any).items ?? [] };
      if (decideExchangeRelease(candidate).release) {
        const result = await releaseExchangeOrderHold(request.id, { source: 'cron' }, deps);
        if (result.released) report.released++;
        return;
      }
      if (!request.exchangeOrderHoldActive || !(request.exchangeOrderError || '').startsWith(EXCHANGE_HOLD_FAILED_PREFIX)) return;
      const live = await deps.getOrder(request.merchantId, request.exchangeOrderId!);
      if ((await applyExchangeHold(request, live, deps)) === 'held') report.reheld++;
    } catch (error) {
      report.errors++;
      log.error('Exchange hold reconcile failed', { requestId: request.id, error });
    }
  });
  return report;
}

// ---------------------------------------------------------------------------
// 5. Staff actions
// ---------------------------------------------------------------------------
export async function issueLeftoverCoupon(
  requestId: string,
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<{ code: string; amount: number } | null> {
  const request = await deps.db.returnRequest.findUnique({ where: { id: requestId } });
  const amount = Number(request?.leftoverCouponAmount) || 0;
  if (!request || amount <= 0) return null;
  if (request.leftoverCouponCode) return { code: request.leftoverCouponCode, amount };
  const coupon = await deps.createCoupon(request.merchantId, amount, 'EXCHANGE', { freeShipping: false, expiryDays: 30 });
  await deps.db.returnRequest.update({ where: { id: requestId }, data: { leftoverCouponCode: coupon.code } });
  const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await deps
    .notifyCoupon({
      customerName: request.customerName,
      customerPhone: request.customerPhone,
      orderNumber: request.orderNumber,
      couponCode: coupon.code,
      discountedAmount: toSallaCouponAmount(amount),
      fullAmount: amount,
      currency: request.currency,
      expiryDate,
    })
    .catch((error) => log.warn('Leftover coupon notification failed', { requestId, error }));
  return { code: coupon.code, amount };
}

// ---------------------------------------------------------------------------
// 6. Staff-built replacement order
// ---------------------------------------------------------------------------
const OPEN_ORDER_STATES = new Set(['creating', 'pending', 'paid', 'not_required', 'expiring']);
const REUSABLE_ORDER_STATES = ['none', 'failed', 'expired', 'cancelled'];

type StaffRequest = {
  status: string;
  processingStatus?: string | null;
  currency?: string | null;
  couponCode?: string | null;
  leftoverCouponCode?: string | null;
  exchangeOrderId?: string | null;
  exchangePaymentStatus?: string | null;
  customerId?: string | null;
  items?: Array<{ type?: string | null }>;
};

/** Why staff can't build a replacement order for this request right now (empty: they can). */
export function staffReplacementBlockers(request: StaffRequest): string[] {
  const blockers: string[] = [];
  if (['completed', 'cancelled', 'rejected'].includes(request.status)) blockers.push('الطلب مغلق؛ أعيديه للمراجعة أولاً.');
  if (request.processingStatus === 'processing') blockers.push(STAFF_LOCK_MESSAGE);
  if (!(request.items ?? []).some((item) => item.type === 'exchange')) {
    blockers.push('لا توجد قطع للاستبدال في هذا الطلب؛ حوّلي القطعة إلى استبدال أولاً.');
  }
  if (request.couponCode) {
    blockers.push(`أُصدر كوبون الاستبدال ${request.couponCode} لهذا الطلب؛ ألغيه أولاً (إن لم يُستخدم) ثم أنشئي الطلب البديل.`);
  }
  if (request.leftoverCouponCode) blockers.push('أُصدر كوبون الرصيد المتبقي لهذا الطلب.');
  if ((request.currency || 'SAR').toUpperCase() !== 'SAR') {
    blockers.push('الطلب البديل متاح فقط للطلبات بالريال السعودي.');
  }
  if (request.exchangeOrderId && OPEN_ORDER_STATES.has(request.exchangePaymentStatus || '')) {
    blockers.push('للطلب طلب بديل نشط بالفعل.');
  }
  if (!request.customerId) blockers.push('رقم العميل في سلة غير متوفر لهذا الطلب.');
  return blockers;
}

export interface StaffReplacementInput {
  lines: RequestedExchangeLine[];
  paymentMethod?: string | null;
  /** WhatsApp the payment link right away (default true). */
  notifyCustomer?: boolean;
  actor: string;
}

export type StaffReplacementResult =
  | {
      ok: true;
      orderNumber: string;
      amountDue: number;
      leftover: number;
      paymentUrl: string | null;
      notification: { sent: boolean; reason?: string };
      released: boolean;
    }
  | { ok: false; status: number; error: string };

/**
 * Staff pick the replacement products in returns-management: the app creates
 * the Salla order (the exchange credit applied as a single-use coupon), WhatsApps
 * the payment link, and the order follows the customer-made path — paid → held
 * "تحت المراجعة حجز قطع" → return inspected good → "طلب جديد".
 */
export async function createStaffReplacementOrder(
  requestId: string,
  input: StaffReplacementInput,
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<StaffReplacementResult> {
  const request = await deps.db.returnRequest.findUnique({ where: { id: requestId }, include: { items: true } });
  if (!request) return { ok: false, status: 404, error: 'طلب الإرجاع غير موجود' };
  const blockers = staffReplacementBlockers({ ...request, items: (request as any).items ?? [] });
  if (blockers.length > 0) return { ok: false, status: 409, error: blockers[0] };

  const priced = await priceExchangeCart(request.merchantId, input.lines, deps);
  if (!priced.ok) return { ok: false, status: 400, error: priced.error };
  const { credit } = await deps.computeCredit(requestId);
  if (!(credit > 0)) return { ok: false, status: 400, error: 'رصيد الاستبدال غير متاح لهذا الطلب؛ راجعي القطع والمبالغ.' };
  const settlement = planExchangeSettlement(credit, priced.total);
  const paymentMethod = settlement.needsPayment ? String(input.paymentMethod || '') : null;
  if (settlement.needsPayment && !EXCHANGE_PAYMENT_METHODS.includes(paymentMethod || '')) {
    return { ok: false, status: 400, error: 'اختاري طريقة دفع العميل للفرق.' };
  }

  let outcome: StaffReplacementResult = { ok: false, status: 500, error: 'تعذر إنشاء الطلب البديل' };
  const locked = await withStaffLock(
    requestId,
    async () => {
      const previous = request.exchangeOrderId
        ? { order: request.exchangeOrderNumber || request.exchangeOrderId, status: request.exchangePaymentStatus }
        : null;

      // Reset the old (expired / cancelled / failed) order's fields and store the new cart.
      const reset = await deps.db.$transaction(async (tx) => {
        const claimed = await tx.returnRequest.updateMany({
          where: { id: requestId, couponCode: null, exchangePaymentStatus: { in: REUSABLE_ORDER_STATES } },
          data: {
            exchangeMode: 'order',
            exchangeCreditAmount: credit,
            exchangePaymentMethod: paymentMethod,
            exchangePaymentStatus: 'none',
            exchangeOrderId: null,
            exchangeOrderNumber: null,
            exchangeOrderLinkedAt: null,
            exchangeOrderTotal: null,
            exchangeCreditApplied: null,
            exchangeAmountDue: null,
            exchangeCheckoutUrl: null,
            exchangePaymentDueAt: null,
            exchangeReminderSentAt: null,
            exchangeCreditCouponId: null,
            exchangeOrderHoldActive: false,
            exchangeOrderHeldAt: null,
            exchangeOrderReleasedAt: null,
            exchangeOrderError: null,
            leftoverCouponAmount: null,
          },
        });
        if (claimed.count === 0) return false;
        await tx.returnExchangeLine.deleteMany({ where: { returnRequestId: requestId } });
        await tx.returnExchangeLine.createMany({
          data: priced.lines.map((line) => ({
            returnRequestId: requestId,
            productId: line.productId,
            skuId: line.skuId,
            sku: line.sku,
            name: line.name,
            variantName: line.variantName,
            imageUrl: line.imageUrl,
            options: line.options as any,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            currency: line.currency,
          })),
        });
        return true;
      });
      if (!reset) {
        outcome = { ok: false, status: 409, error: 'تغيّر الطلب للتو (كوبون أو طلب بديل)، حدّثي الصفحة.' };
        return;
      }

      const created = await createExchangeOrderForRequest(requestId, deps);
      if (!created.ok) {
        await appendFlowAudit(deps, requestId, {
          step: 'exchange_order',
          result: 'failed',
          by: input.actor,
          details: { createdByStaff: true, error: created.error, previous },
        });
        outcome = { ok: false, status: 502, error: `تعذر إنشاء الطلب البديل في سلة: ${created.error}` };
        return;
      }

      let notification: { sent: boolean; reason?: string } = { sent: false, reason: 'not_requested' };
      if (created.paymentUrl && input.notifyCustomer !== false) {
        try {
          const status = await deps.notify('ZOKO_TPL_EXCHANGE_PAYMENT_PENDING', request.customerPhone, [
            request.customerName || 'عميلنا العزيز',
            created.orderNumber,
            `${created.amountDue.toFixed(2)} ر.س`,
            created.paymentUrl,
          ]);
          notification = status === 'skipped' ? { sent: false, reason: 'template_or_phone_missing' } : { sent: true };
        } catch (error) {
          notification = { sent: false, reason: error instanceof Error ? error.message : 'failed' };
        }
      }

      // Fully covered: the order was held at creation; the return may already have passed.
      let released = false;
      if (!created.paymentUrl) {
        released = (await releaseExchangeOrderHold(requestId, { source: 'staff', actor: input.actor }, deps)).released;
      }

      await appendFlowAudit(deps, requestId, {
        step: 'exchange_order',
        result: 'ok',
        by: input.actor,
        details: {
          createdByStaff: true,
          order: created.orderNumber,
          amountDue: created.amountDue,
          leftover: created.leftover,
          lines: priced.lines.map((line) => `${line.name}${line.variantName ? ` (${line.variantName})` : ''} × ${line.quantity}`),
          paymentLinkSent: notification.sent,
          previous,
        },
      });
      outcome = {
        ok: true,
        orderNumber: created.orderNumber,
        amountDue: created.amountDue,
        leftover: created.leftover,
        paymentUrl: created.paymentUrl,
        notification,
        released,
      };
    },
    { db: deps.db },
  );
  if (!locked.ok) return { ok: false, status: locked.reason === 'not_found' ? 404 : 409, error: STAFF_LOCK_MESSAGE };
  return outcome;
}
