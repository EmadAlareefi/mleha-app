import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getReturnFeeQuoteForOrder,
  MissingReturnFeeExchangeRateError,
} from '@/app/lib/returns/fee-quote';

test('uses configured SAR rate when Salla order has no explicit rate', () => {
  const previous = process.env.RETURN_FEE_SAR_RATES_JSON;
  process.env.RETURN_FEE_SAR_RATES_JSON = '{"USD":3.75}';

  try {
    const quote = getReturnFeeQuoteForOrder(
      {
        amounts: {
          total: { amount: 100, currency: 'USD' },
        },
      },
      'exchange',
    );

    assert.equal(quote.currency, 'USD');
    assert.equal(quote.exchangeRate, 3.75);
    assert.equal(quote.exchangeRateSource, 'env');
    assert.equal(quote.processingFee, 10.67);
  } finally {
    if (previous === undefined) {
      delete process.env.RETURN_FEE_SAR_RATES_JSON;
    } else {
      process.env.RETURN_FEE_SAR_RATES_JSON = previous;
    }
  }
});

test('throws when a non-SAR order has no usable rate', () => {
  const previous = process.env.RETURN_FEE_SAR_RATES_JSON;
  delete process.env.RETURN_FEE_SAR_RATES_JSON;

  try {
    assert.throws(
      () =>
        getReturnFeeQuoteForOrder(
          {
            amounts: {
              total: { amount: 100, currency: 'USD' },
            },
          },
          'return',
        ),
      MissingReturnFeeExchangeRateError,
    );
  } finally {
    if (previous !== undefined) {
      process.env.RETURN_FEE_SAR_RATES_JSON = previous;
    }
  }
});
