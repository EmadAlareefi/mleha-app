const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

/**
 * Flat return-leg (return shipment) fees by request type. Returns are charged a
 * full return leg (30 SAR); exchanges only a discounted return leg (10 SAR) to
 * encourage exchanges over returns. The original outbound shipment the customer
 * already paid is added on top of this — see {@link getProcessingFee}.
 */
export const RETURN_SHIPMENT_LEG_FEE = 30;
export const EXCHANGE_SHIPMENT_LEG_FEE = 10;

export function getReturnLegFee(type: 'return' | 'exchange'): number {
  return type === 'exchange' ? EXCHANGE_SHIPMENT_LEG_FEE : RETURN_SHIPMENT_LEG_FEE;
}

interface OrderShippingAmounts {
  shipping_cost?: { amount?: number | string | null } | null;
  shipping_tax?: { amount?: number | string | null } | null;
}

/**
 * Original outbound shipping the customer actually paid at checkout (gross,
 * including shipping VAT). Free-shipping orders return 0.
 */
export function getOriginalShippingFee(amounts?: OrderShippingAmounts | null): number {
  const cost = toNumber(amounts?.shipping_cost?.amount);
  const tax = toNumber(amounts?.shipping_tax?.amount);
  return roundCurrency(cost + tax);
}

/**
 * Total processing fee deducted from the refund: the original outbound shipping
 * the customer paid plus the flat return-leg fee for the request type. When the
 * order amounts are unknown (or the order shipped for free) only the return-leg
 * fee applies.
 */
export function getProcessingFee(
  type: 'return' | 'exchange',
  amounts?: OrderShippingAmounts | null,
): number {
  return roundCurrency(getOriginalShippingFee(amounts) + getReturnLegFee(type));
}

interface ReturnFeeCalculation {
  baseAmount: number;
  effectiveFee: number;
}

interface ReturnFeeBreakdown {
  baseShipmentFee: number;
  returnShipmentFee: number;
}

export function calculateReturnFee(baseFee: number): ReturnFeeCalculation {
  const normalizedBase = Number.isFinite(baseFee) ? Math.max(0, baseFee) : 0;
  const baseAmount = roundCurrency(normalizedBase);

  return {
    baseAmount,
    effectiveFee: baseAmount,
  };
}

export function getEffectiveReturnFee(baseFee: number): number {
  return calculateReturnFee(baseFee).effectiveFee;
}

export function splitReturnFee(fee: number): ReturnFeeBreakdown {
  const totalInHalalas = Math.round(getEffectiveReturnFee(fee) * 100);
  const baseShipmentInHalalas = Math.floor(totalInHalalas / 2);

  return {
    baseShipmentFee: baseShipmentInHalalas / 100,
    returnShipmentFee: (totalInHalalas - baseShipmentInHalalas) / 100,
  };
}
