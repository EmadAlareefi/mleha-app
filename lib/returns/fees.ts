const roundCurrency = (value: number) => Math.round(value * 100) / 100;

interface ReturnFeeCalculation {
  baseAmount: number;
  effectiveFee: number;
}

export function calculateReturnFee(baseFee: number, shippingAmount: number): ReturnFeeCalculation {
  const normalizedBase = Number.isFinite(baseFee) ? Math.max(0, baseFee) : 0;
  const normalizedShipping = Number.isFinite(shippingAmount) ? Math.max(0, shippingAmount) : 0;
  const baseAmount = roundCurrency(normalizedBase);
  const effectiveFee = normalizedShipping > 0 ? roundCurrency(baseAmount / 2) : baseAmount;

  return {
    baseAmount,
    effectiveFee,
  };
}

export function getEffectiveReturnFee(baseFee: number, shippingAmount: number): number {
  return calculateReturnFee(baseFee, shippingAmount).effectiveFee;
}
