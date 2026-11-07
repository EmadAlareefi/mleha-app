/**
 * How an exchange credit pays for the replacements the customer picked.
 * All amounts are customer-facing (VAT-inclusive) in the order currency.
 */
export interface ExchangeSettlement {
  cartTotal: number;
  credit: number;
  /** Part of the credit spent on this order (as a coupon on it). */
  creditApplied: number;
  /** What the customer still pays through the Salla payment link. */
  amountDue: number;
  /** Unused credit, issued as a separate coupon. */
  leftover: number;
  needsPayment: boolean;
}

const round = (value: number) => Math.round(value * 100) / 100;
/** Differences under a halala are rounding noise, not money owed. */
export const SETTLEMENT_EPSILON = 0.01;

export function planExchangeSettlement(credit: number, cartTotal: number): ExchangeSettlement {
  const safeCredit = round(Math.max(0, Number.isFinite(credit) ? credit : 0));
  const safeTotal = round(Math.max(0, Number.isFinite(cartTotal) ? cartTotal : 0));
  const creditApplied = round(Math.min(safeCredit, safeTotal));
  let amountDue = round(safeTotal - creditApplied);
  let leftover = round(safeCredit - creditApplied);
  if (amountDue < SETTLEMENT_EPSILON) amountDue = 0;
  if (leftover < SETTLEMENT_EPSILON) leftover = 0;
  return {
    cartTotal: safeTotal,
    credit: safeCredit,
    creditApplied,
    amountDue,
    leftover,
    needsPayment: amountDue > 0,
  };
}

export const MAX_EXCHANGE_LINE_QUANTITY = 5;
export const MAX_EXCHANGE_LINES = 10;
