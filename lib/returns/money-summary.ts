import { storedRequestAmounts } from './request-financials';

/**
 * What a return request means in money, for every screen that shows it (list
 * card, detail, full page). Pure, so it runs in the browser too.
 *
 * Piece types decide what is shown: a refund only when a piece is returned, a
 * credit only when a piece is exchanged. `totalRefundAmount` is never shown as
 * a refund on its own — on exchange-only requests it stores the credit.
 */

type NumericValue = number | string | { toString(): string } | null | undefined;

export interface MoneyInput {
  type: string;
  currency?: string | null;
  totalRefundAmount?: NumericValue;
  couponAmount?: NumericValue;
  couponAmountOverride?: NumericValue;
  returnFee?: NumericValue;
  shippingAmount?: NumericValue;
  feeExchangeRate?: NumericValue;
  refundStatus?: string | null;
  refundedAmount?: NumericValue;
  couponCode?: string | null;
  exchangeMode?: string | null;
  exchangeOrderId?: string | null;
  exchangeOrderNumber?: string | null;
  exchangePaymentStatus?: string | null;
  exchangeCreditAmount?: NumericValue;
  leftoverCouponAmount?: NumericValue;
  leftoverCouponCode?: string | null;
  items: Array<{ type?: string | null; price: NumericValue; quantity?: number; refundIncluded?: boolean | null }>;
}

export interface MoneySummary {
  /** From the pieces. */
  derivedType: 'return' | 'exchange' | 'mixed';
  /** The stored request type disagrees with its pieces (old data); amounts are recomputed. */
  typeMismatch: boolean;
  hasReturn: boolean;
  hasExchange: boolean;
  refund: null | { amount: number; status: string; refunded: boolean };
  credit: null | {
    amount: number;
    /** Where the credit went: a coupon, an app-created replacement order, or nothing yet. */
    via: 'coupon' | 'replacement' | 'not_issued';
    code: string | null;
    orderNumber: string | null;
    overridden: boolean;
    leftover: number | null;
    leftoverCode: string | null;
  };
  fee: number;
  shipping: number;
  currency: string;
}

const ACTIVE_REPLACEMENT = new Set(['creating', 'pending', 'paid', 'not_required', 'expiring']);

const num = (value: NumericValue): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function summarizeRequestMoney(request: MoneyInput): MoneySummary {
  const items = Array.isArray(request.items) ? request.items : [];
  const hasReturn = items.some((item) => item.type !== 'exchange');
  const hasExchange = items.some((item) => item.type === 'exchange');
  const derivedType = hasReturn && hasExchange ? 'mixed' : hasExchange ? 'exchange' : 'return';
  const knownType = ['return', 'exchange', 'mixed'].includes(request.type);
  const typeMismatch = items.length > 0 && knownType && request.type !== derivedType;

  let refundAmount: number;
  let creditAmount: number;
  if (typeMismatch) {
    const recomputed = storedRequestAmounts({
      items,
      shippingAmount: request.shippingAmount,
      currency: request.currency,
      feeExchangeRate: request.feeExchangeRate,
      couponAmountOverride: request.couponAmountOverride,
    });
    refundAmount = recomputed.refundAmount;
    creditAmount = recomputed.creditAmount;
  } else {
    refundAmount = derivedType === 'exchange' ? 0 : num(request.totalRefundAmount) ?? 0;
    creditAmount = num(request.couponAmount) ?? (derivedType === 'exchange' ? num(request.totalRefundAmount) ?? 0 : 0);
  }

  const refundStatus = request.refundStatus || 'none';
  const refunded = refundStatus === 'refunded';
  const refund = hasReturn
    ? { amount: refunded ? num(request.refundedAmount) ?? refundAmount : refundAmount, status: refundStatus, refunded }
    : null;

  const replacement =
    request.exchangeMode === 'order' &&
    Boolean(request.exchangeOrderId) &&
    ACTIVE_REPLACEMENT.has(request.exchangePaymentStatus || '');
  const override = num(request.couponAmountOverride);
  const credit = hasExchange
    ? {
        amount: replacement ? num(request.exchangeCreditAmount) ?? creditAmount : creditAmount,
        via: (replacement ? 'replacement' : request.couponCode ? 'coupon' : 'not_issued') as 'coupon' | 'replacement' | 'not_issued',
        code: request.couponCode || null,
        orderNumber: replacement ? request.exchangeOrderNumber || request.exchangeOrderId || null : null,
        overridden: override !== null && override > 0,
        leftover: num(request.leftoverCouponAmount),
        leftoverCode: request.leftoverCouponCode || null,
      }
    : null;

  return {
    derivedType,
    typeMismatch,
    hasReturn,
    hasExchange,
    refund,
    credit,
    fee: num(request.returnFee) ?? 0,
    shipping: num(request.shippingAmount) ?? 0,
    currency: (request.currency || 'SAR').trim().toUpperCase() || 'SAR',
  };
}
