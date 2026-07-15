import { buildReturnFeeQuote } from './fees';

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
