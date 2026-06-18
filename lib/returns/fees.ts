const roundCurrency = (value: number) => Math.round(value * 100) / 100;

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
