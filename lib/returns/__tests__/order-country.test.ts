import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInternationalOrder } from '../order-country';

test('customer fallback trusts country_code over a city typed as the country', () => {
  assert.equal(isInternationalOrder({ customer: { country: 'الخرج', country_code: 'SA' } }), false);
});

test('customer fallback with a foreign country_code is international', () => {
  assert.equal(isInternationalOrder({ customer: { country: 'Dubai', country_code: 'AE' } }), true);
});

test('customer fallback without a code still reads the country name', () => {
  assert.equal(isInternationalOrder({ customer: { country: 'السعودية' } }), false);
  assert.equal(isInternationalOrder({ customer: { country: 'Kuwait' } }), true);
});

test('shipping address wins over the customer profile', () => {
  assert.equal(
    isInternationalOrder({ shipping: { country: 'Kuwait' }, customer: { country_code: 'SA' } }),
    true,
  );
});
