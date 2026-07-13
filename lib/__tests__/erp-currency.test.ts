import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMissingERPSarRateMessage,
  buildUnsupportedERPCurrencyMessage,
  getERPCurrencySyncBlockReason,
  isERPSyncableCurrency,
  normalizeERPCurrency,
  resolveERPOrderCurrency,
  resolveERPSarRate,
} from '../erp-currency';

const kwdRawOrder = {
  currency: 'KWD',
  exchange_rate: {
    rate: '12.11871493',
    base_currency: 'SAR',
    exchange_currency: 'KWD',
  },
  amounts: {
    total: { amount: 37.91, currency: 'KWD' },
  },
};

test('normalizes currency codes and rejects empty values', () => {
  assert.equal(normalizeERPCurrency(' sar '), 'SAR');
  assert.equal(normalizeERPCurrency('kwd'), 'KWD');
  assert.equal(normalizeERPCurrency(null), null);
  assert.equal(normalizeERPCurrency(''), null);
  assert.equal(normalizeERPCurrency({ currency: 'SAR' }), null);
});

test('any named currency is syncable, missing currency is not', () => {
  assert.equal(isERPSyncableCurrency('SAR'), true);
  assert.equal(isERPSyncableCurrency('AED'), true);
  assert.equal(isERPSyncableCurrency(null), false);
});

test('falls back to raw order fields when stored currency is missing', () => {
  assert.equal(resolveERPOrderCurrency(null, kwdRawOrder), 'KWD');
  assert.equal(resolveERPOrderCurrency('usd', kwdRawOrder), 'USD');
  assert.equal(
    resolveERPOrderCurrency(null, { amounts: { total: { currency: 'aed' } } }),
    'AED'
  );
  assert.equal(resolveERPOrderCurrency(null, null), null);
});

test('resolves currency from list/webhook-shaped payloads', () => {
  // List payloads carry `total` at the top level instead of `amounts`.
  assert.equal(
    resolveERPOrderCurrency(null, { total: { amount: 119, currency: 'SAR' } }),
    'SAR'
  );
  // Last resort: the exchange_rate object names the order currency.
  assert.equal(
    resolveERPOrderCurrency(null, {
      exchange_rate: { rate: '12.11', base_currency: 'SAR', exchange_currency: 'KWD' },
    }),
    'KWD'
  );
});

test('SAR orders resolve to a rate of 1 without needing raw data', () => {
  assert.equal(resolveERPSarRate('SAR', null), 1);
});

test('reads the Salla exchange_rate object as SAR per order-currency unit', () => {
  assert.equal(resolveERPSarRate('KWD', kwdRawOrder), 12.11871493);
});

test('inverts the rate when base/exchange currencies are flipped', () => {
  const rate = resolveERPSarRate('KWD', {
    exchange_rate: {
      rate: '12.5',
      base_currency: 'KWD',
      exchange_currency: 'SAR',
    },
  });
  assert.equal(rate, 1 / 12.5);
});

test('ignores exchange rates labeled for a different currency pair', () => {
  const rate = resolveERPSarRate('KWD', {
    exchange_rate: {
      rate: '3.67',
      base_currency: 'USD',
      exchange_currency: 'AED',
    },
  });
  assert.equal(rate, null);
});

test('accepts a bare numeric exchange_rate as SAR per unit', () => {
  assert.equal(resolveERPSarRate('AED', { exchange_rate: '1.02' }), 1.02);
});

test('falls back to env-configured rates when the raw order has none', (t) => {
  process.env.ERP_SAR_RATES_JSON = JSON.stringify({ aed: 1.02 });
  t.after(() => {
    delete process.env.ERP_SAR_RATES_JSON;
  });

  assert.equal(resolveERPSarRate('AED', {}), 1.02);
  assert.equal(resolveERPSarRate('OMR', {}), null);
});

test('ERP-specific env rates win over the returns env rates', (t) => {
  process.env.RETURN_FEE_SAR_RATES_JSON = JSON.stringify({ AED: 1 });
  process.env.ERP_SAR_RATES_JSON = JSON.stringify({ AED: 1.02 });
  t.after(() => {
    delete process.env.RETURN_FEE_SAR_RATES_JSON;
    delete process.env.ERP_SAR_RATES_JSON;
  });

  assert.equal(resolveERPSarRate('AED', {}), 1.02);
});

test('block reason: null for convertible orders, message otherwise', () => {
  assert.equal(getERPCurrencySyncBlockReason('SAR', null), null);
  assert.equal(getERPCurrencySyncBlockReason('KWD', kwdRawOrder), null);
  assert.equal(
    getERPCurrencySyncBlockReason(null, null),
    buildUnsupportedERPCurrencyMessage(null)
  );
  assert.equal(
    getERPCurrencySyncBlockReason('OMR', {}),
    buildMissingERPSarRateMessage('OMR')
  );
});
