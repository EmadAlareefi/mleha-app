import assert from 'node:assert/strict';
import test from 'node:test';
import { detectInternationalOrder } from '@/app/lib/order-destination';

test('detects international shipment destination before stale Saudi customer country', () => {
  const result = detectInternationalOrder({
    customer: {
      country: 'Saudi Arabia',
    },
    shipments: [
      {
        ship_to: {
          country: 'United Arab Emirates',
          country_code: 'AE',
        },
      },
    ],
  });

  assert.equal(result.isInternational, true);
  assert.equal(result.country, 'AE');
});

test('treats Saudi destination country codes as domestic', () => {
  const result = detectInternationalOrder({
    shipping: {
      ship_to: {
        country_code: 'SA',
      },
    },
  });

  assert.equal(result.isInternational, false);
  assert.equal(result.country, 'SA');
});

test('uses explicit Salla international flag when country is missing', () => {
  const result = detectInternationalOrder({
    shipping: {
      is_international: true,
    },
  });

  assert.equal(result.isInternational, true);
  assert.equal(result.country, 'International');
});
