import { getShippingTotal } from './shipping';

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

/**
 * Flat per-leg shipment fees. The refund is computed from the order total
 * (items + original shipping incl. VAT) minus two equal legs: the original
 * outbound shipment and the return/exchange shipment.
 *
 * Returns charge 30 SAR per leg (60 total); exchanges only 20 SAR per leg
 * (40 total) to encourage exchanges over returns.
 */
export const RETURN_SHIPMENT_LEG_FEE = 30;
export const EXCHANGE_SHIPMENT_LEG_FEE = 20;

export function getShipmentLegFee(type: 'return' | 'exchange'): number {
  return type === 'exchange' ? EXCHANGE_SHIPMENT_LEG_FEE : RETURN_SHIPMENT_LEG_FEE;
}

/**
 * Total processing fee deducted from the order total: both shipment legs
 * (original outbound + return/exchange). 60 SAR for returns, 40 SAR for
 * exchanges.
 */
export function getProcessingFee(type: 'return' | 'exchange'): number {
  return getShipmentLegFee(type) * 2;
}

interface OrderShippingAmounts {
  shipping_cost?: { amount?: number | string | null; taxable?: boolean } | null;
  shipping_tax?: { amount?: number | string | null } | null;
}

/**
 * Original outbound shipping the customer actually paid at checkout, gross
 * (including shipping VAT). When the tax isn't itemized the net cost is grossed
 * up by the VAT rate (e.g. 26.09 → 30.00). Free-shipping orders return 0.
 */
export function getOriginalShippingFee(amounts?: OrderShippingAmounts | null): number {
  return getShippingTotal(amounts?.shipping_cost ?? undefined, amounts?.shipping_tax ?? undefined);
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
