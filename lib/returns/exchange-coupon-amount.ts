import {
  buildReturnFeeQuote,
  getOrderOptionsTotal,
  getOriginalShippingFee,
  type PaidOrderOption,
  type ReturnFeeQuote,
} from './fees';

interface ExchangeItem {
  price: number | string | { toString(): string };
  quantity: number;
}

interface StoredExchangeAmounts {
  items: ExchangeItem[];
  couponAmountOverride?: number | string | { toString(): string } | null;
  totalRefundAmount?: number | string | { toString(): string } | null;
  returnFee?: number | string | { toString(): string } | null;
  shippingAmount?: number | string | { toString(): string } | null;
  currency?: string | null;
  feeExchangeRate?: number | string | { toString(): string } | null;
  feeExchangeRateSource?: string | null;
}

interface OrderShippingAmounts {
  shipping_cost?: { amount?: number | string | null; taxable?: boolean } | null;
  shipping_tax?: { amount?: number | string | null } | null;
}

export interface ExchangeCouponAmount {
  fullAmount: number;
  fullAmountSar: number;
  itemsTotal: number;
  originalShipping: number;
  orderOptionsTotal: number;
  processingFee: number;
  processingFeeSar: number;
  currency: string;
  exchangeRate: number;
  exchangeRateSource: string;
}

/**
 * Salla adds 15% (VAT) on top of a fixed coupon's face value before the customer
 * sees it, so every amount we send is divided by this first. Shared by the coupon
 * create/assign/edit routes so the three cannot drift.
 */
export const SALLA_CUSTOMER_MARKUP = 0.15;

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

/** The face value to send to Salla so the customer ends up with `amount`. */
export function toSallaCouponAmount(amount: number): number {
  return Number((amount / (1 + SALLA_CUSTOMER_MARKUP)).toFixed(2));
}

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Recalculates exchange credit using the current policy instead of trusting the
 * amount stored when the return request was originally created.
 */
export function calculateExchangeCouponAmount(
  request: StoredExchangeAmounts,
  liveOrderAmounts?: OrderShippingAmounts | null,
  feeQuote?: ReturnFeeQuote,
  liveOrderOptions?: PaidOrderOption[] | null,
): ExchangeCouponAmount {
  const itemsTotal = roundCurrency(
    request.items.reduce((sum, item) => {
      const price = toFiniteNumber(item.price) ?? 0;
      const quantity = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
      return sum + price * quantity;
    }, 0),
  );

  let originalShipping: number;

  if (liveOrderAmounts !== undefined) {
    originalShipping = getOriginalShippingFee(liveOrderAmounts);
  } else {
    const storedShipping = toFiniteNumber(request.shippingAmount);

    if (storedShipping !== null && storedShipping >= 0) {
      originalShipping = storedShipping;
    } else {
      // Newer records can be reconstructed as:
      // total refund + fee = items + original shipping.
      const storedRefund = toFiniteNumber(request.totalRefundAmount);
      const storedFee = toFiniteNumber(request.returnFee);
      const inferredShipping =
        storedRefund !== null && storedFee !== null
          ? storedRefund + storedFee - itemsTotal
          : 0;
      originalShipping = roundCurrency(Math.max(0, inferredShipping));
    }
  }

  const exchangeRate = toFiniteNumber(request.feeExchangeRate);
  const quote =
    feeQuote ??
    buildReturnFeeQuote(
      'exchange',
      request.currency || 'SAR',
      exchangeRate && exchangeRate > 0 ? exchangeRate : 1,
      request.feeExchangeRateSource === 'salla' ||
        request.feeExchangeRateSource === 'env' ||
        request.feeExchangeRateSource === 'stored'
        ? request.feeExchangeRateSource
        : request.currency && request.currency !== 'SAR'
          ? 'stored'
          : 'sar',
    );
  const processingFee = quote.processingFee;
  const orderOptionsTotal = getOrderOptionsTotal(liveOrderOptions);
  const customerPaidTotal = itemsTotal + originalShipping + orderOptionsTotal;
  const refundableSubtotal = customerPaidTotal - orderOptionsTotal;
  const fullAmount = roundCurrency(
    Math.max(0, refundableSubtotal - processingFee),
  );
  const fullAmountSar = roundCurrency(
    Math.max(
      0,
      refundableSubtotal * quote.exchangeRate - quote.processingFeeSar,
    ),
  );

  return {
    fullAmount,
    fullAmountSar,
    itemsTotal,
    originalShipping,
    orderOptionsTotal,
    processingFee,
    processingFeeSar: quote.processingFeeSar,
    currency: quote.currency,
    exchangeRate: quote.exchangeRate,
    exchangeRateSource: quote.exchangeRateSource,
  };
}

export type ExchangeCouponAmountSource = 'calculated' | 'override';

export interface ResolvedExchangeCouponAmount extends ExchangeCouponAmount {
  amountSource: ExchangeCouponAmountSource;
}

/**
 * Replaces the calculated credit with an amount an agent set by hand.
 *
 * Some order shapes price an exchanged line at 0 through no fault of the
 * customer — Salla books a bundle discount (`عرض اليوم الوطني 1+1`) entirely
 * against one line, so the piece the customer picked looks free. Rather than
 * guess at a fair split, returns-management lets an agent state the credit; this
 * keeps the rest of the breakdown (items, shipping, fee) intact so the stored
 * record still shows what the policy *would* have produced.
 */
export function applyCouponAmountOverride(
  calculation: ExchangeCouponAmount,
  override: number | string | { toString(): string } | null | undefined,
): ResolvedExchangeCouponAmount {
  const amount = toFiniteNumber(override);

  if (amount === null || amount <= 0) {
    return { ...calculation, amountSource: 'calculated' };
  }

  const fullAmount = roundCurrency(amount);

  return {
    ...calculation,
    fullAmount,
    fullAmountSar: roundCurrency(fullAmount * calculation.exchangeRate),
    amountSource: 'override',
  };
}
