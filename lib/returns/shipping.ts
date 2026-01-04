const VAT_RATE = 0.15;

type AmountLike = number | string | { amount?: number | string | null } | null | undefined;

const toAmount = (value: AmountLike): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === 'object' && 'amount' in value) {
    return toAmount(value.amount as AmountLike);
  }
  return 0;
};

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

interface ShippingCostLike {
  amount?: AmountLike;
  taxable?: boolean;
}

export function getShippingTotal(
  shippingCost?: ShippingCostLike | AmountLike,
  shippingTax?: AmountLike
): number {
  const costAmount =
    shippingCost && typeof shippingCost === 'object' && 'amount' in shippingCost
      ? toAmount(shippingCost.amount)
      : toAmount(shippingCost as AmountLike);

  const explicitTax =
    shippingTax && typeof shippingTax === 'object' && 'amount' in shippingTax
      ? toAmount(shippingTax.amount)
      : toAmount(shippingTax);

  const computedTax =
    explicitTax > 0
      ? explicitTax
      : costAmount > 0
      ? roundCurrency(costAmount * VAT_RATE)
      : 0;

  return roundCurrency(costAmount + computedTax);
}
