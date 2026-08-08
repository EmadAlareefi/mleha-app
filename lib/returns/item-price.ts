/**
 * The price of one unit of an order item, for refund purposes.
 *
 * Single source of truth shared by the customer-facing returns form (which
 * shows the estimate) and `/api/returns/create` (which stores the refund), so
 * the two cannot drift. The server treats this as authoritative and ignores any
 * price sent by the browser.
 *
 * Salla mixes two scales inside one `amounts` object:
 *   - `price_without_tax` and `tax.amount` are PER UNIT
 *   - `total_discount` and `total` are LINE TOTALS
 *
 * Evidence for the discount being a line total: `app/lib/erp-invoice.ts` builds
 * `grossLineHalalas = (price_without_tax + tax) * quantity` and then compares
 * `total_discount` against that line-level figure.
 *
 * The discount is therefore spread back across the ordered quantity here.
 * Subtracting it whole from a unit price — as the previous client-side formula
 * did — under-refunded any discounted line with a quantity above one.
 */

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

type Amount = number | string | { amount?: Amount } | null | undefined;

interface PricedOrderItem {
  quantity?: number | null;
  amounts?: {
    price_without_tax?: { amount?: Amount } | null;
    tax?: { amount?: Amount } | null;
    total_discount?: { amount?: Amount } | null;
    total?: { amount?: Amount } | null;
  } | null;
}

/**
 * Coerces Salla's several money shapes to a number. Mirrors
 * `toOrderOptionAmount` in `./fees.ts`, including the recursion that tolerates
 * both `tax.amount` and `tax.amount.amount`.
 */
const toAmount = (value: Amount): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object' && 'amount' in value) {
    return toAmount(value.amount);
  }
  return null;
};

/** The quantity the customer originally ordered on this line, floored at 1. */
const orderedQuantity = (item: PricedOrderItem): number => {
  const quantity = Number(item?.quantity);
  return Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1;
};

/**
 * Net price the customer paid for ONE unit of this line: the tax-inclusive unit
 * price, less that unit's share of the line discount.
 *
 * Falls back to `total.amount` spread over the ordered quantity when Salla omits
 * the detailed breakdown, which it does on some older orders.
 */
export function getOrderItemUnitPrice(item: PricedOrderItem | null | undefined): number {
  if (!item) {
    return 0;
  }

  const amounts = item.amounts;
  const priceWithoutTax = toAmount(amounts?.price_without_tax?.amount);
  const tax = toAmount(amounts?.tax?.amount);
  const lineDiscount = toAmount(amounts?.total_discount?.amount);
  const lineTotal = toAmount(amounts?.total?.amount);
  const quantity = orderedQuantity(item);

  const hasDetailedAmounts = priceWithoutTax !== null || tax !== null;

  if (!hasDetailedAmounts) {
    return roundCurrency(Math.max(0, (lineTotal ?? 0) / quantity));
  }

  const unitGross = (priceWithoutTax ?? 0) + (tax ?? 0);
  const unitDiscount = (lineDiscount ?? 0) / quantity;

  return roundCurrency(Math.max(0, unitGross - unitDiscount));
}

/** Refundable amount for `returnQuantity` units of this line. */
export function getReturnLineAmount(
  item: PricedOrderItem | null | undefined,
  returnQuantity: number
): number {
  const quantity = Number.isFinite(returnQuantity) ? Math.max(0, returnQuantity) : 0;
  return roundCurrency(getOrderItemUnitPrice(item) * quantity);
}
