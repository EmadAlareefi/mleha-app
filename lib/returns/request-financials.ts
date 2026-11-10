import { buildReturnFeeQuote, normalizeReturnCurrency } from './fees';

type ReturnRequestType = 'return' | 'exchange';
type NumericValue = number | string | { toString(): string } | null | undefined;

interface ReturnRequestItemAmount {
  price: NumericValue;
  quantity: number;
}

interface RecalculateReturnRequestFinancialsInput {
  type: ReturnRequestType;
  currency?: string | null;
  exchangeRate?: NumericValue;
  totalRefundAmount?: NumericValue;
  returnFee?: NumericValue;
  shippingAmount?: NumericValue;
  items: ReturnRequestItemAmount[];
}

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const toFiniteNumber = (value: NumericValue): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Reprices a request after its processing type changes. The stored refund plus
 * fee is the preferred gross basis because it preserves the amount approved at
 * creation time. Item and shipping values are a fallback for older records.
 */
export function recalculateReturnRequestFinancials({
  type,
  currency,
  exchangeRate,
  totalRefundAmount,
  returnFee,
  shippingAmount,
  items,
}: RecalculateReturnRequestFinancialsInput) {
  const storedRefund = toFiniteNumber(totalRefundAmount);
  const storedFee = toFiniteNumber(returnFee);
  const storedRate = toFiniteNumber(exchangeRate);
  const safeRate = storedRate !== null && storedRate > 0 ? storedRate : 1;
  const feeQuote = buildReturnFeeQuote(type, currency, safeRate, 'stored');

  const itemAndShippingTotal = items.reduce((total, item) => {
    const price = toFiniteNumber(item.price) ?? 0;
    const quantity = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
    return total + price * quantity;
  }, Math.max(0, toFiniteNumber(shippingAmount) ?? 0));

  const grossAmount =
    storedRefund !== null && storedRefund >= 0 && storedFee !== null && storedFee >= 0
      ? storedRefund + storedFee
      : itemAndShippingTotal;

  return {
    returnFee: feeQuote.processingFee,
    totalRefundAmount: roundCurrency(Math.max(0, grossAmount - feeQuote.processingFee)),
    feeExchangeRate: feeQuote.exchangeRate,
    feeExchangeRateSource: feeQuote.exchangeRateSource,
  };
}

export interface PieceAmount {
  type: 'return' | 'exchange';
  price: NumericValue;
  quantity?: number;
  /** false when staff excluded a piece from the money refund (e.g. damaged). */
  refundIncluded?: boolean;
}

export interface SplitFinancialsInput {
  pieces: PieceAmount[];
  /** Original outbound shipping the customer paid, gross. */
  originalShipping: number;
  /** Processing fee (both legs) for a request with at least one return piece. */
  returnProcessingFee: number;
  /** Processing fee for an exchange-only request. */
  exchangeProcessingFee: number;
}

export interface SplitFinancials {
  requestType: 'return' | 'exchange' | 'mixed';
  returnItemsTotal: number;
  exchangeItemsTotal: number;
  originalShipping: number;
  /** One fee per request: there is one return shipment. */
  processingFee: number;
  /** Money back to the customer for the return pieces. */
  refundAmount: number;
  /** Exchange credit for the exchange pieces. */
  couponAmount: number;
  /** Portion of the fee taken from the coupon because the refund could not cover it. */
  feeTakenFromCoupon: number;
}

/**
 * Splits one request into a money refund (return pieces) and an exchange
 * credit (exchange pieces).
 *
 * - One shipment, so one fee. Any return piece makes it the return fee.
 * - Original shipping follows the refund when there is one, else the coupon.
 * - The fee is deducted from the refund first; any remainder from the coupon.
 *
 * A pure-return request equals the pre-v2 refund (items + shipping − fee), and
 * a pure-exchange request equals `calculateExchangeCouponAmount`.
 */
export function splitRequestFinancials({
  pieces,
  originalShipping,
  returnProcessingFee,
  exchangeProcessingFee,
}: SplitFinancialsInput): SplitFinancials {
  const sum = (type: 'return' | 'exchange', onlyRefundable = false) =>
    roundCurrency(
      pieces
        .filter((piece) => piece.type === type && (!onlyRefundable || piece.refundIncluded !== false))
        .reduce((total, piece) => {
          const price = toFiniteNumber(piece.price) ?? 0;
          const quantity = Number.isFinite(piece.quantity) ? Math.max(0, piece.quantity as number) : 1;
          return total + price * quantity;
        }, 0),
    );

  const hasReturn = pieces.some((piece) => piece.type === 'return');
  const hasExchange = pieces.some((piece) => piece.type === 'exchange');
  const requestType = hasReturn && hasExchange ? 'mixed' : hasExchange ? 'exchange' : 'return';
  const shipping = Math.max(0, Number.isFinite(originalShipping) ? originalShipping : 0);
  const processingFee = Math.max(0, hasReturn ? returnProcessingFee : exchangeProcessingFee);

  const returnItemsTotal = sum('return', true);
  const exchangeItemsTotal = sum('exchange');
  const refundGross = hasReturn ? returnItemsTotal + shipping : 0;
  const couponGross = exchangeItemsTotal + (hasReturn ? 0 : shipping);

  const refundAmount = roundCurrency(Math.max(0, refundGross - processingFee));
  const feeTakenFromCoupon = hasExchange ? roundCurrency(Math.max(0, processingFee - refundGross)) : 0;
  const couponAmount = hasExchange ? roundCurrency(Math.max(0, couponGross - feeTakenFromCoupon)) : 0;

  return {
    requestType,
    returnItemsTotal,
    exchangeItemsTotal,
    originalShipping: roundCurrency(shipping),
    processingFee: roundCurrency(processingFee),
    refundAmount,
    couponAmount,
    feeTakenFromCoupon,
  };
}

export interface StoredAmountsInput {
  items: Array<{ type?: string | null; price: NumericValue; quantity?: number; refundIncluded?: boolean | null }>;
  shippingAmount?: NumericValue;
  currency?: string | null;
  feeExchangeRate?: NumericValue;
  /** Credit set by hand in returns-management; wins over the calculated credit. */
  couponAmountOverride?: NumericValue;
}

export interface StoredAmounts {
  type: 'return' | 'exchange' | 'mixed';
  returnFee: number;
  /**
   * What the `totalRefundAmount` column stores: the money refund, except on
   * exchange-only requests, where it keeps its pre-v2 meaning (the credit).
   */
  totalRefundAmount: number;
  /** What the `couponAmount` column stores (null without exchange pieces). */
  couponAmount: number | null;
  /** Money back for the return pieces; 0 without return pieces. */
  refundAmount: number;
  /** Exchange credit for the exchange pieces; 0 without exchange pieces. */
  creditAmount: number;
}

/**
 * The amounts stored on a request, recomputed from its pieces with the same
 * split as creation (`splitRequestFinancials`). Used whenever staff or the
 * warehouse change pieces, so the list never shows stale money.
 */
export function storedRequestAmounts(input: StoredAmountsInput): StoredAmounts {
  const rate = toFiniteNumber(input.feeExchangeRate);
  const safeRate = rate !== null && rate > 0 ? rate : 1;
  const currency = normalizeReturnCurrency(input.currency);
  const source = currency === 'SAR' ? 'sar' : 'stored';
  const split = splitRequestFinancials({
    pieces: input.items.map((item) => ({
      type: item.type === 'exchange' ? 'exchange' : 'return',
      price: item.price,
      quantity: item.quantity,
      refundIncluded: item.refundIncluded !== false,
    })),
    originalShipping: Math.max(0, toFiniteNumber(input.shippingAmount) ?? 0),
    returnProcessingFee: buildReturnFeeQuote('return', currency, safeRate, source).processingFee,
    exchangeProcessingFee: buildReturnFeeQuote('exchange', currency, safeRate, source).processingFee,
  });
  const override = toFiniteNumber(input.couponAmountOverride);
  const hasExchange = split.requestType !== 'return';
  const credit = hasExchange && override !== null && override > 0 ? roundCurrency(override) : split.couponAmount;
  return {
    type: split.requestType,
    returnFee: split.processingFee,
    totalRefundAmount: split.requestType === 'exchange' ? credit : split.refundAmount,
    couponAmount: hasExchange && credit > 0 ? credit : null,
    refundAmount: split.refundAmount,
    creditAmount: hasExchange ? credit : 0,
  };
}
