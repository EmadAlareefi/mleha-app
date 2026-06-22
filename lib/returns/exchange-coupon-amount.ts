import { getOriginalShippingFee, getProcessingFee } from './fees';

interface ExchangeItem {
  price: number | string | { toString(): string };
  quantity: number;
}

interface StoredExchangeAmounts {
  items: ExchangeItem[];
  totalRefundAmount?: number | string | { toString(): string } | null;
  returnFee?: number | string | { toString(): string } | null;
  shippingAmount?: number | string | { toString(): string } | null;
}

interface OrderShippingAmounts {
  shipping_cost?: { amount?: number | string | null; taxable?: boolean } | null;
  shipping_tax?: { amount?: number | string | null } | null;
}

interface ExchangeCouponAmount {
  fullAmount: number;
  itemsTotal: number;
  originalShipping: number;
  processingFee: number;
}

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

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

  const processingFee = getProcessingFee('exchange');
  const fullAmount = roundCurrency(
    Math.max(0, itemsTotal + originalShipping - processingFee),
  );

  return {
    fullAmount,
    itemsTotal,
    originalShipping,
    processingFee,
  };
}
