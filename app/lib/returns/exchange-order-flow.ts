import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { createSallaCoupon, deleteSallaCoupon, generateCouponCode } from '@/app/lib/salla-coupons';
import { sendWhatsAppTemplate } from '@/app/lib/zoko';
import { normalizeKSA } from '@/app/lib/phone';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import {
  cancelExchangeOrder,
  createPendingExchangeOrder,
  EXCHANGE_HOLD_STATUS_ID,
  getExchangeOrderState,
  getOriginalShipping,
  isOrderPaid,
  setExchangeOrderStatus,
  type ExchangeOrderState,
} from '@/app/lib/salla-exchange-order';
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

// ---------------------------------------------------------------------------
// Dependencies (injectable for tests)
// ---------------------------------------------------------------------------
type Db = Pick<typeof prisma, 'returnRequest' | 'returnExchangeLine'>;

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
  notify(templateEnv: string, to: string | null | undefined, args: (string | number)[]): Promise<void>;
  notifyCoupon: typeof notifyExchangeCoupon;
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
      return;
    }
    await sendWhatsAppTemplate({ to: recipient, templateId, args });
  },
  notifyCoupon: notifyExchangeCoupon,
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
  | { ok: false; error: string; fellBackToCoupon: true };

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

    if (!needsPayment) {
      // Nothing to pay: hold straight away until the return is inspected.
      await deps.setStatus(request.merchantId, order.id, EXCHANGE_HOLD_STATUS_ID);
    }

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
  if (request.exchangePaymentStatus !== 'pending') return 'unchanged';

  if (isOrderPaid(state)) {
    // Paid: hold until the return passes inspection (Salla moves paid orders to
    // "new order", which the warehouse would otherwise start preparing).
    await deps.setStatus(request.merchantId, state.id, EXCHANGE_HOLD_STATUS_ID).catch((error) =>
      log.error('Failed to hold paid exchange order', { requestId: request.id, error }),
    );
    await deps.db.returnRequest.update({
      where: { id: request.id },
      data: {
        exchangePaymentStatus: 'paid',
        exchangeCheckoutUrl: null,
        exchangeOrderHoldActive: true,
        exchangeOrderHeldAt: deps.now(),
      },
    });
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
}

/** Cron: backup for missed webhooks, reminders, and expiry. */
export async function runExchangePaymentMaintenance(
  deps: ExchangeFlowDeps = productionExchangeDeps,
): Promise<ExchangeMaintenanceReport> {
  const report: ExchangeMaintenanceReport = { paid: 0, reminded: 0, expired: 0, errors: 0 };
  const pending = await deps.db.returnRequest.findMany({
    where: { exchangeMode: 'order', exchangePaymentStatus: 'pending', exchangeOrderId: { not: null } },
    take: 100,
  });
  const now = deps.now();

  for (const request of pending) {
    try {
      const state = await deps.getOrder(request.merchantId, request.exchangeOrderId!);
      const outcome = await applyExchangeOrderState(request, state, deps);
      if (outcome === 'paid') {
        report.paid++;
        continue;
      }
      if (outcome === 'cancelled') {
        report.expired++;
        continue;
      }
      const dueAt = request.exchangePaymentDueAt;
      if (dueAt && now.getTime() >= dueAt.getTime()) {
        await expireExchangeOrder(request, deps);
        report.expired++;
        continue;
      }
      // One reminder in the second half of the payment window.
      const createdAt = request.exchangeOrderLinkedAt ?? request.createdAt;
      const halfway = dueAt ? createdAt.getTime() + (dueAt.getTime() - createdAt.getTime()) / 2 : null;
      if (!request.exchangeReminderSentAt && halfway && now.getTime() >= halfway) {
        await deps.notify('ZOKO_TPL_EXCHANGE_PAYMENT_PENDING', request.customerPhone, [
          request.customerName || 'عميلنا العزيز',
          request.exchangeOrderNumber || '',
          `${Number(request.exchangeAmountDue || 0).toFixed(2)} ${request.currency === 'SAR' ? 'ر.س' : request.currency}`,
          state.checkoutUrl || request.exchangeCheckoutUrl || '',
        ]);
        await deps.db.returnRequest.update({ where: { id: request.id }, data: { exchangeReminderSentAt: now } });
        report.reminded++;
      }
    } catch (error) {
      report.errors++;
      log.error('Exchange payment maintenance failed', { requestId: request.id, error });
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// 4. Staff actions
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
