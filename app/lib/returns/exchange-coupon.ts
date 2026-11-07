import { prisma } from '@/lib/prisma';
import { createSallaCoupon, generateCouponCode } from '@/app/lib/salla-coupons';
import { log } from '@/app/lib/logger';
import { notifyExchangeCoupon } from '@/app/lib/returns/coupon-notification';
import { getSallaOrder } from '@/app/lib/salla-api';
import { getReturnFeeQuoteForOrder } from '@/app/lib/returns/fee-quote';
import {
  applyCouponAmountOverride,
  calculateExchangeCouponAmount,
  SALLA_CUSTOMER_MARKUP,
} from '@/lib/returns/exchange-coupon-amount';
import { getOriginalShippingFee, shouldGrantCouponFreeShipping } from '@/lib/returns/fees';
import { splitRequestFinancials } from '@/lib/returns/request-financials';

const DEFAULT_COUPON_EXPIRY_DAYS = Number(process.env.EXCHANGE_COUPON_DEFAULT_EXPIRY_DAYS || '30');
const round = (value: number) => Math.round(value * 100) / 100;

type RequestWithItems = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

function loadRequest(id: string) {
  return prisma.returnRequest.findUnique({ where: { id }, include: { items: true } });
}

export interface RequestAmounts {
  requestType: 'return' | 'exchange' | 'mixed';
  refundAmount: number;
  couponAmount: number;
  couponAmountSar: number;
  couponSource: 'calculated' | 'override';
  processingFee: number;
  originalShipping: number;
  currency: string;
  exchangeRate: number;
  exchangeRateSource: string;
}

/**
 * Current refund and exchange credit for a request, from the live order when
 * Salla is reachable. Exchange-only requests keep the original coupon policy
 * (`calculateExchangeCouponAmount`) so pre-v2 behaviour does not change.
 */
export async function computeRequestAmounts(request: RequestWithItems, liveOrder?: any): Promise<RequestAmounts> {
  let order = liveOrder;
  if (order === undefined) {
    try {
      order = await getSallaOrder(request.merchantId, request.orderId);
    } catch (error) {
      log.warn('Could not refresh Salla order for return amounts', { returnRequestId: request.id, error });
      order = null;
    }
  }

  const itemTypes = new Set(request.items.map((item) => item.type || request.type));
  const hasReturn = itemTypes.has('return');
  const hasExchange = itemTypes.has('exchange');

  if (hasExchange && !hasReturn) {
    const quote = order ? getReturnFeeQuoteForOrder(order, 'exchange') : undefined;
    const calc = applyCouponAmountOverride(
      calculateExchangeCouponAmount(request, order ? order.amounts : undefined, quote, order?.options),
      request.couponAmountOverride,
    );
    return {
      requestType: 'exchange',
      refundAmount: 0,
      couponAmount: calc.fullAmount,
      couponAmountSar: calc.fullAmountSar,
      couponSource: calc.amountSource,
      processingFee: calc.processingFee,
      originalShipping: calc.originalShipping,
      currency: calc.currency,
      exchangeRate: calc.exchangeRate,
      exchangeRateSource: calc.exchangeRateSource,
    };
  }

  const rate = Number(request.feeExchangeRate) > 0 ? Number(request.feeExchangeRate) : 1;
  const returnQuote = order ? getReturnFeeQuoteForOrder(order, 'return') : null;
  const exchangeQuote = order ? getReturnFeeQuoteForOrder(order, 'exchange') : null;
  const storedShipping = Number(request.shippingAmount);
  const split = splitRequestFinancials({
    pieces: request.items.map((item) => ({
      type: (item.type === 'exchange' ? 'exchange' : 'return') as 'return' | 'exchange',
      price: item.price,
      quantity: item.quantity,
      refundIncluded: item.refundIncluded,
    })),
    originalShipping: order ? getOriginalShippingFee(order.amounts) : Number.isFinite(storedShipping) ? storedShipping : 0,
    returnProcessingFee: returnQuote?.processingFee ?? Number(request.returnFee ?? 0),
    exchangeProcessingFee: exchangeQuote?.processingFee ?? Number(request.returnFee ?? 0),
  });

  const override = Number(request.couponAmountOverride);
  const couponSource = hasExchange && Number.isFinite(override) && override > 0 ? 'override' : 'calculated';
  const couponAmount = couponSource === 'override' ? round(override) : split.couponAmount;
  const exchangeRate = returnQuote?.exchangeRate ?? rate;

  return {
    requestType: split.requestType,
    refundAmount: split.refundAmount,
    couponAmount,
    couponAmountSar: round(couponAmount * exchangeRate),
    couponSource,
    processingFee: split.processingFee,
    originalShipping: split.originalShipping,
    currency: returnQuote?.currency ?? request.currency,
    exchangeRate,
    exchangeRateSource: returnQuote?.exchangeRateSource ?? request.feeExchangeRateSource,
  };
}

export type IssueCouponResult =
  | { ok: true; couponCode: string; couponId: string; amount: number; notification: unknown; request: RequestWithItems }
  | { ok: false; status: number; error: string; permissionDenied?: boolean };

/**
 * Creates the exchange coupon in Salla for a request's exchange pieces, stores
 * it and sends it to the customer on WhatsApp. Refuses to create a second one.
 */
export async function issueExchangeCoupon(
  returnRequestId: string,
  options: { expiryDays?: number; liveOrder?: any } = {},
): Promise<IssueCouponResult> {
  const returnRequest = await loadRequest(returnRequestId);
  if (!returnRequest) return { ok: false, status: 404, error: 'طلب الإرجاع غير موجود' };

  const hasExchangePiece =
    returnRequest.type === 'exchange' || returnRequest.items.some((item) => item.type === 'exchange');
  if (!hasExchangePiece) {
    return { ok: false, status: 400, error: 'الكوبونات متاحة فقط لطلبات الاستبدال' };
  }
  if (returnRequest.couponCode) {
    return { ok: false, status: 400, error: 'تم إنشاء كوبون لهذا الطلب مسبقاً' };
  }

  const amounts = await computeRequestAmounts(returnRequest, options.liveOrder);
  const couponAmountSar = amounts.couponAmountSar;
  if (!couponAmountSar || !Number.isFinite(couponAmountSar) || couponAmountSar <= 0) {
    log.error('Invalid coupon amount detected', { returnRequestId, amounts });
    return { ok: false, status: 400, error: 'قيمة الاستبدال غير متاحة. يرجى مراجعة الطلب.' };
  }

  const sanitizedAmount = Number(couponAmountSar.toFixed(2));
  const customerFullAmount = Number(amounts.couponAmount.toFixed(2));
  const customerDiscountedAmount = Number((customerFullAmount / (1 + SALLA_CUSTOMER_MARKUP)).toFixed(2));
  const discountedAmount = Number((sanitizedAmount / (1 + SALLA_CUSTOMER_MARKUP)).toFixed(2));
  if (!Number.isFinite(discountedAmount) || discountedAmount <= 0) {
    return { ok: false, status: 400, error: 'قيمة الاستبدال بعد الحسم غير صالحة. يرجى مراجعة الطلب.' };
  }

  const days = Number(options.expiryDays);
  const safeExpiryDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : DEFAULT_COUPON_EXPIRY_DAYS;
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + safeExpiryDays);
  const couponCode = generateCouponCode('EXCHANGE');

  log.info('Creating coupon for exchange', {
    returnRequestId,
    couponCode,
    amountBeforeDiscount: sanitizedAmount,
    amountAfterDiscount: discountedAmount,
    amountSource: amounts.couponSource,
    requestType: amounts.requestType,
  });

  const result = await createSallaCoupon(returnRequest.merchantId, {
    code: couponCode,
    type: 'fixed',
    amount: discountedAmount,
    // In a mixed request the original shipping is refunded with the money, so
    // the coupon never carries it; only exchange-only requests can.
    free_shipping:
      amounts.requestType === 'exchange' ? shouldGrantCouponFreeShipping(amounts.originalShipping) : false,
    exclude_sale_products: false,
    expiry_date: expiryDate.toISOString(),
    usage_limit: 1,
    usage_limit_per_user: 1,
    active: true,
  });

  if (!result.success || !result.coupon) {
    log.error('Failed to create coupon in Salla', { returnRequestId, result });
    const error = result.error || 'فشل إنشاء الكوبون';
    return { ok: false, status: 500, error, permissionDenied: /scope|marketing|403|401/i.test(error) };
  }

  const updated = await prisma.returnRequest.update({
    where: { id: returnRequestId },
    data: {
      couponCode: result.coupon.code,
      couponId: String(result.coupon.id),
      couponCreatedAt: new Date(),
      couponAmount: customerFullAmount,
      // Pre-v2 meaning: for exchange-only requests the "refund" is the credit.
      ...(amounts.requestType === 'exchange'
        ? {
            totalRefundAmount: customerFullAmount,
            returnFee: amounts.processingFee,
            shippingAmount: amounts.originalShipping,
            currency: amounts.currency,
            feeExchangeRate: amounts.exchangeRate,
            feeExchangeRateSource: amounts.exchangeRateSource,
          }
        : {}),
    },
    include: { items: true },
  });

  const notification = await notifyExchangeCoupon({
    customerName: returnRequest.customerName,
    customerPhone: returnRequest.customerPhone,
    orderNumber: returnRequest.orderNumber,
    couponCode: result.coupon.code,
    discountedAmount: amounts.currency === 'SAR' ? discountedAmount : customerDiscountedAmount,
    fullAmount: customerFullAmount,
    currency: amounts.currency,
    sarFullAmount: sanitizedAmount,
    expiryDate,
  });

  return {
    ok: true,
    couponCode: result.coupon.code,
    couponId: String(result.coupon.id),
    amount: customerFullAmount,
    notification,
    request: updated,
  };
}
