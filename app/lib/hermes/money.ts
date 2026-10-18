import { Prisma } from '@prisma/client';
import { resolveERPSarRate } from '@/lib/erp-currency';

/**
 * Money handling for the Hermes API. All arithmetic uses Prisma.Decimal
 * (decimal.js) and amounts leave the API as strings with two decimals, never
 * as JS floats.
 */

export type Decimal = Prisma.Decimal;
export const ZERO = new Prisma.Decimal(0);

export function toDecimal(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

export function formatMoney(value: Prisma.Decimal | number | string | null | undefined): string | null {
  const decimal = toDecimal(value);
  return decimal ? decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) : null;
}

export function sum(values: (Prisma.Decimal | null | undefined)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, value) => (value ? acc.plus(value) : acc), ZERO);
}

/**
 * SAR per one unit of the order currency, reusing the ERP sync's resolution
 * (Salla's per-order `exchange_rate`, then configured env rates). Null when
 * the order cannot be converted reliably.
 */
export function sarRateFor(currency: string | null, exchangeRate: unknown): Prisma.Decimal | null {
  const rate = resolveERPSarRate(currency, { currency, exchange_rate: exchangeRate });
  return rate ? new Prisma.Decimal(rate) : null;
}

export function toSar(amount: Prisma.Decimal | null, rate: Prisma.Decimal | null): Prisma.Decimal | null {
  if (!amount || !rate) return null;
  return amount.times(rate);
}

/** Percentage change from `previous` to `current`, two decimals; null when undefined. */
export function percentChange(
  current: Prisma.Decimal | number | null,
  previous: Prisma.Decimal | number | null
): string | null {
  const now = toDecimal(current);
  const before = toDecimal(previous);
  if (!now || !before || before.isZero()) return null;
  return now.minus(before).dividedBy(before.abs()).times(100).toDecimalPlaces(2).toFixed(2);
}

export function ratio(numerator: number, denominator: number): string | null {
  if (!denominator) return null;
  return new Prisma.Decimal(numerator).dividedBy(denominator).times(100).toDecimalPlaces(2).toFixed(2);
}
