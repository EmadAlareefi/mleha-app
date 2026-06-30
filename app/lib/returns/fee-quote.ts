import {
  buildReturnFeeQuote,
  normalizeReturnCurrency,
  type ReturnFeeQuote,
} from '@/lib/returns/fees';

type ReturnRequestType = 'return' | 'exchange';
type UnknownRecord = Record<string, unknown>;

const RATE_ENV_KEY = 'RETURN_FEE_SAR_RATES_JSON';

export class MissingReturnFeeExchangeRateError extends Error {
  constructor(public readonly currency: string) {
    super(`Missing SAR exchange rate for ${currency}`);
    this.name = 'MissingReturnFeeExchangeRateError';
  }
}

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const toFinitePositiveNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (isRecord(value)) {
    return toFinitePositiveNumber(value.value ?? value.amount ?? value.rate);
  }
  return null;
};

const pickOrderCurrency = (order: unknown): string => {
  if (!isRecord(order)) {
    return 'SAR';
  }
  const amounts = isRecord(order.amounts) ? order.amounts : {};
  const total = isRecord(amounts.total) ? amounts.total : {};
  const subtotal = isRecord(amounts.subtotal) ? amounts.subtotal : {};
  const shippingCost = isRecord(amounts.shipping_cost) ? amounts.shipping_cost : {};

  return normalizeReturnCurrency(
    total.currency ??
      subtotal.currency ??
      shippingCost.currency ??
      order.currency ??
      order.currency_code ??
      order.currencyCode,
  );
};

const getPathValue = (source: unknown, path: string[]): unknown => {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
};

const directRatePaths = [
  ['exchange_rate'],
  ['exchangeRate'],
  ['currency_exchange_rate'],
  ['currencyExchangeRate'],
  ['currency', 'exchange_rate'],
  ['currency', 'exchangeRate'],
  ['amounts', 'exchange_rate'],
  ['amounts', 'exchangeRate'],
  ['amounts', 'total', 'exchange_rate'],
  ['amounts', 'total', 'exchangeRate'],
];

const inverseRatePaths = [
  ['sar_rate'],
  ['sarRate'],
  ['amounts', 'sar_rate'],
  ['amounts', 'sarRate'],
  ['amounts', 'total', 'sar_rate'],
  ['amounts', 'total', 'sarRate'],
];

const readConfiguredRates = (): Record<string, number> => {
  const raw = process.env[RATE_ENV_KEY];
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([currency, value]) => [normalizeReturnCurrency(currency), toFinitePositiveNumber(value)])
        .filter((entry): entry is [string, number] => entry[1] !== null),
    );
  } catch {
    return {};
  }
};

export function resolveSarPerCurrencyUnitFromOrder(order: unknown, currencyInput?: unknown): number | null {
  const currency = normalizeReturnCurrency(currencyInput ?? pickOrderCurrency(order));
  if (currency === 'SAR') {
    return 1;
  }

  for (const path of directRatePaths) {
    const rate = toFinitePositiveNumber(getPathValue(order, path));
    if (rate) {
      return rate;
    }
  }

  for (const path of inverseRatePaths) {
    const inverseRate = toFinitePositiveNumber(getPathValue(order, path));
    if (inverseRate) {
      return 1 / inverseRate;
    }
  }

  return null;
}

export function getReturnFeeQuoteForOrder(order: unknown, type: ReturnRequestType): ReturnFeeQuote {
  const currency = pickOrderCurrency(order);

  if (currency === 'SAR') {
    return buildReturnFeeQuote(type, currency, 1, 'sar');
  }

  const sallaRate = resolveSarPerCurrencyUnitFromOrder(order, currency);
  if (sallaRate) {
    return buildReturnFeeQuote(type, currency, sallaRate, 'salla');
  }

  const envRate = readConfiguredRates()[currency];
  if (envRate) {
    return buildReturnFeeQuote(type, currency, envRate, 'env');
  }

  throw new MissingReturnFeeExchangeRateError(currency);
}

export function getReturnFeeQuotesForOrder(order: unknown) {
  return {
    return: getReturnFeeQuoteForOrder(order, 'return'),
    exchange: getReturnFeeQuoteForOrder(order, 'exchange'),
  };
}

export function buildMissingReturnFeeRateMessage(currency: string) {
  return `لا يمكن احتساب رسوم الإرجاع لعملة ${currency}. يرجى ضبط ${RATE_ENV_KEY} بسعر التحويل مقابل الريال السعودي.`;
}
