import { getShippingTotal } from './shipping';

const roundCurrency = (value: number) => Math.round(value * 100) / 100;
const BASE_FEE_CURRENCY = 'SAR';

type ReturnRequestType = 'return' | 'exchange';

export type ReturnFeeExchangeRateSource = 'sar' | 'salla' | 'env' | 'stored';

export interface ReturnFeeQuote {
  currency: string;
  baseCurrency: typeof BASE_FEE_CURRENCY;
  exchangeRate: number;
  exchangeRateSource: ReturnFeeExchangeRateSource;
  shipmentLegFee: number;
  returnShipmentFee: number;
  processingFee: number;
  shipmentLegFeeSar: number;
  processingFeeSar: number;
}

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
export const RETURN_FEE_BASE_CURRENCY = BASE_FEE_CURRENCY;

export function getShipmentLegFee(type: ReturnRequestType): number {
  return type === 'exchange' ? EXCHANGE_SHIPMENT_LEG_FEE : RETURN_SHIPMENT_LEG_FEE;
}

/**
 * Total processing fee deducted from the order total: both shipment legs
 * (original outbound + return/exchange). 60 SAR for returns, 40 SAR for
 * exchanges.
 */
export function getProcessingFee(type: ReturnRequestType): number {
  return getShipmentLegFee(type) * 2;
}

export function normalizeReturnCurrency(value: unknown): string {
  if (typeof value !== 'string') {
    return BASE_FEE_CURRENCY;
  }

  const normalized = value.trim().toUpperCase();
  return normalized || BASE_FEE_CURRENCY;
}

export function convertSarFeeToCurrency(amountSar: number, sarPerCurrencyUnit: number): number {
  const safeAmount = Number.isFinite(amountSar) ? Math.max(0, amountSar) : 0;
  const safeRate =
    Number.isFinite(sarPerCurrencyUnit) && sarPerCurrencyUnit > 0 ? sarPerCurrencyUnit : 1;
  return roundCurrency(safeAmount / safeRate);
}

export function buildReturnFeeQuote(
  type: ReturnRequestType,
  currencyInput?: unknown,
  sarPerCurrencyUnit = 1,
  exchangeRateSource: ReturnFeeExchangeRateSource = 'sar',
): ReturnFeeQuote {
  const currency = normalizeReturnCurrency(currencyInput);
  const exchangeRate = currency === BASE_FEE_CURRENCY ? 1 : sarPerCurrencyUnit;
  const safeRate =
    Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  const shipmentLegFeeSar = getShipmentLegFee(type);
  const processingFeeSar = getProcessingFee(type);
  const processingFee = convertSarFeeToCurrency(processingFeeSar, safeRate);
  const baseShipmentFee = Math.floor(processingFee * 100 / 2) / 100;

  return {
    currency,
    baseCurrency: BASE_FEE_CURRENCY,
    exchangeRate: safeRate,
    exchangeRateSource: currency === BASE_FEE_CURRENCY ? 'sar' : exchangeRateSource,
    shipmentLegFee: baseShipmentFee,
    returnShipmentFee: roundCurrency(processingFee - baseShipmentFee),
    processingFee,
    shipmentLegFeeSar,
    processingFeeSar,
  };
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
