export const ERP_SUPPORTED_CURRENCY = 'SAR';
export const ERP_SAR_RATES_ENV_KEY = 'ERP_SAR_RATES_JSON';

// Shared with the returns module so a rate configured once covers both flows.
const RETURNS_SAR_RATES_ENV_KEY = 'RETURN_FEE_SAR_RATES_JSON';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function normalizeERPCurrency(value: unknown): string | null {
  if (value === null || value === undefined || isRecord(value)) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

export function isSupportedERPCurrency(value: unknown): boolean {
  return normalizeERPCurrency(value) === ERP_SUPPORTED_CURRENCY;
}

/**
 * Any named currency can be attempted: SAR posts as-is, other currencies are
 * converted with the exchange rate carried in the raw Salla payload (or the
 * configured env rates). Only orders with no currency at all stay blocked.
 */
export function isERPSyncableCurrency(value: unknown): boolean {
  return normalizeERPCurrency(value) !== null;
}

export function resolveERPOrderCurrency(currency: unknown, rawOrder: unknown): string | null {
  const direct = normalizeERPCurrency(currency);
  if (direct) {
    return direct;
  }

  if (!isRecord(rawOrder)) {
    return null;
  }

  const amounts = isRecord(rawOrder.amounts) ? rawOrder.amounts : {};
  const amountsTotal = isRecord(amounts.total) ? amounts.total : {};
  // List/webhook payload shape: total lives at the top level.
  const topLevelTotal = isRecord(rawOrder.total) ? rawOrder.total : {};
  // Salla's exchange_rate names the order currency as exchange_currency.
  const exchangeRate = isRecord(rawOrder.exchange_rate) ? rawOrder.exchange_rate : {};

  return (
    normalizeERPCurrency(rawOrder.currency) ??
    normalizeERPCurrency(rawOrder.currency_code) ??
    normalizeERPCurrency(amountsTotal.currency) ??
    normalizeERPCurrency(topLevelTotal.currency) ??
    normalizeERPCurrency(exchangeRate.exchange_currency)
  );
}

const toFinitePositiveNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

/**
 * Read a Salla exchange-rate value and return SAR per one unit of `currency`.
 * Salla ships it as `{ rate, base_currency, exchange_currency }` where the
 * rate is base-currency units per one exchange-currency unit, e.g.
 * `{ rate: "12.11", base_currency: "SAR", exchange_currency: "KWD" }`.
 */
function readSarPerUnitRate(value: unknown, currency: string): number | null {
  if (!isRecord(value)) {
    return toFinitePositiveNumber(value);
  }

  const rate = toFinitePositiveNumber(value.rate ?? value.value ?? value.amount);
  if (!rate) {
    return null;
  }

  const base = normalizeERPCurrency(value.base_currency ?? value.baseCurrency);
  const exchange = normalizeERPCurrency(value.exchange_currency ?? value.exchangeCurrency);

  if (base === ERP_SUPPORTED_CURRENCY && (!exchange || exchange === currency)) {
    return rate;
  }
  if (exchange === ERP_SUPPORTED_CURRENCY && (!base || base === currency)) {
    return 1 / rate;
  }
  if (!base && !exchange) {
    return rate;
  }

  // Labeled with currencies that don't match this order — don't guess.
  return null;
}

function readConfiguredSarRates(): Record<string, number> {
  const rates: Record<string, number> = {};

  // Returns-module rates first so ERP-specific rates win on conflict.
  for (const envKey of [RETURNS_SAR_RATES_ENV_KEY, ERP_SAR_RATES_ENV_KEY]) {
    const raw = process.env[envKey];
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) continue;

      for (const [currency, value] of Object.entries(parsed)) {
        const normalized = normalizeERPCurrency(currency);
        const rate = toFinitePositiveNumber(value);
        if (normalized && rate) {
          rates[normalized] = rate;
        }
      }
    } catch {
      // Ignore malformed JSON and fall through to whatever else resolves.
    }
  }

  return rates;
}

const RAW_ORDER_RATE_PATHS: string[][] = [
  ['exchange_rate'],
  ['exchangeRate'],
  ['currency_exchange_rate'],
  ['currencyExchangeRate'],
  ['amounts', 'exchange_rate'],
  ['amounts', 'exchangeRate'],
];

function getPathValue(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/**
 * Resolve how many SAR one unit of the order currency is worth.
 * Returns 1 for SAR, a positive rate when the raw Salla order (or the
 * configured env rates) provides one, and null when conversion is impossible.
 */
export function resolveERPSarRate(currency: unknown, rawOrder: unknown): number | null {
  const normalized = resolveERPOrderCurrency(currency, rawOrder);
  if (!normalized) {
    return null;
  }

  if (normalized === ERP_SUPPORTED_CURRENCY) {
    return 1;
  }

  for (const path of RAW_ORDER_RATE_PATHS) {
    const rate = readSarPerUnitRate(getPathValue(rawOrder, path), normalized);
    if (rate) {
      return rate;
    }
  }

  return readConfiguredSarRates()[normalized] ?? null;
}

export function buildUnsupportedERPCurrencyMessage(value: unknown): string {
  const normalized = normalizeERPCurrency(value);

  if (!normalized) {
    return `لا يمكن إنشاء فاتورة أو مرتجع ERP لأن العملة غير محددة. فقط العملة ${ERP_SUPPORTED_CURRENCY} مدعومة.`;
  }

  return `لا يمكن إنشاء فاتورة أو مرتجع ERP لطلب بعملة ${normalized}. فقط العملة ${ERP_SUPPORTED_CURRENCY} مدعومة.`;
}

export function buildMissingERPSarRateMessage(value: unknown): string {
  const normalized = normalizeERPCurrency(value);

  if (!normalized) {
    return buildUnsupportedERPCurrencyMessage(value);
  }

  return `تعذر تحويل عملة الطلب ${normalized} إلى ${ERP_SUPPORTED_CURRENCY} لعدم توفر سعر صرف في بيانات الطلب. يرجى ضبط ${ERP_SAR_RATES_ENV_KEY} بسعر التحويل مقابل الريال السعودي.`;
}

/**
 * Returns null when the order's amounts can be posted to ERP (directly for
 * SAR, or after conversion), otherwise an Arabic message explaining the block.
 */
export function getERPCurrencySyncBlockReason(currency: unknown, rawOrder: unknown): string | null {
  const normalized = resolveERPOrderCurrency(currency, rawOrder);

  if (!normalized) {
    return buildUnsupportedERPCurrencyMessage(null);
  }

  if (resolveERPSarRate(normalized, rawOrder) === null) {
    return buildMissingERPSarRateMessage(normalized);
  }

  return null;
}
