import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findOrderMatchingReference,
  normalizeOrderReference,
  orderMatchesReference,
} from '../salla-order-reference';
import { toPublicOrderView } from '../returns/public-order-view';

test('accepts the shapes customers actually type', () => {
  assert.equal(normalizeOrderReference('251263484'), '251263484');
  assert.equal(normalizeOrderReference('  251263484  '), '251263484');
  assert.equal(normalizeOrderReference('#251263484'), '251263484');
  assert.equal(normalizeOrderReference('251-263-484'), '251263484');
  assert.equal(normalizeOrderReference('251 263 484'), '251263484');
  assert.equal(normalizeOrderReference(251263484), '251263484');
});

test('folds Arabic-Indic and Persian digits', () => {
  assert.equal(normalizeOrderReference('٢٥١٢٦٣٤٨٤'), '251263484');
  assert.equal(normalizeOrderReference('۲۵۱۲۶۳۴۸۴'), '251263484');
});

test('strips zero-width characters that ride along on a paste', () => {
  assert.equal(normalizeOrderReference('251263484​'), '251263484');
  assert.equal(normalizeOrderReference('﻿251263484‎'), '251263484');
});

test('preserves leading zeros, which are part of the identifier', () => {
  assert.equal(normalizeOrderReference('0251263484'), '0251263484');
});

test('rejects anything that cannot be an order reference', () => {
  // The reported repro: Salla drops this filter and answers with the store's
  // newest order, so it must never reach the API.
  assert.equal(normalizeOrderReference('SECURITY_TEST_20260808'), null);
  assert.equal(normalizeOrderReference(''), null);
  assert.equal(normalizeOrderReference('   '), null);
  assert.equal(normalizeOrderReference('12a3'), null);
  assert.equal(normalizeOrderReference('12e5'), null);
  assert.equal(normalizeOrderReference('1 OR 1=1'), null);
  assert.equal(normalizeOrderReference('../../etc/passwd'), null);
  assert.equal(normalizeOrderReference('1'.repeat(21)), null);
  assert.equal(normalizeOrderReference(null), null);
  assert.equal(normalizeOrderReference(undefined), null);
  assert.equal(normalizeOrderReference({ reference_id: '251263484' }), null);
});

test('matches an order on any of its reference spellings', () => {
  assert.ok(orderMatchesReference({ reference_id: '251263484' }, '251263484'));
  assert.ok(orderMatchesReference({ reference_id: 251263484 }, '251263484'));
  assert.ok(orderMatchesReference({ order_number: '251263484' }, '251263484'));
  assert.ok(orderMatchesReference({ referenceId: '251263484' }, '  251263484 '));
});

test('does not match an order carrying a different reference', () => {
  // The exact bug: the newest order came back for an unrelated request.
  assert.equal(orderMatchesReference({ reference_id: '999888777' }, '251263484'), false);
  assert.equal(orderMatchesReference({ reference_id: '999888777' }, 'SECURITY_TEST_20260808'), false);
  assert.equal(orderMatchesReference(null, '251263484'), false);
  assert.equal(orderMatchesReference({}, '251263484'), false);
});

test('does not match on the internal order id alone', () => {
  assert.equal(orderMatchesReference({ id: 251263484 }, '251263484'), false);
});

test('finds the matching order anywhere in the response, not just first', () => {
  const orders = [
    { id: 1, reference_id: '111111111' },
    { id: 2, reference_id: '222222222' },
    { id: 3, reference_id: '251263484' },
    { id: 4, reference_id: '444444444' },
  ];

  assert.equal(findOrderMatchingReference(orders, '251263484')?.id, 3);
});

test('returns null for an unfiltered list that contains no match', () => {
  // What Salla actually sends when it drops the reference_id filter: the whole
  // order list, newest first. data[0] here was the leak.
  const unfiltered = Array.from({ length: 20 }, (_, index) => ({
    id: 900 + index,
    reference_id: String(500000 + index),
  }));

  assert.equal(findOrderMatchingReference(unfiltered, 'SECURITY_TEST_20260808'), null);
  assert.equal(findOrderMatchingReference(unfiltered, '251263484'), null);
  assert.equal(findOrderMatchingReference([], '251263484'), null);
  assert.equal(findOrderMatchingReference(null, '251263484'), null);
});

const orderFixture = {
  id: 1234567,
  reference_id: '251263484',
  order_number: '251263484',
  status: { name: 'تم التوصيل', slug: 'delivered' },
  amounts: {
    total: { amount: 750, currency: 'SAR' },
    shipping_cost: { amount: 25, currency: 'SAR', taxable: true },
  },
  date: { created: '2026-08-01 10:00:00', updated: '2026-08-05 12:00:00' },
  customer: {
    id: 42,
    first_name: 'ريم',
    last_name: 'العتيبي',
    mobile: '512345678',
    email: 'reem@example.com',
    city: 'الرياض',
  },
  shipping_address: { country: 'Saudi Arabia', street: 'شارع الملك فهد' },
  shipping: { company: 'SMSA', tracking_number: 'X123', pickup_address: { country: 'SA' } },
  items: [
    {
      id: 987,
      name: 'فستان سهرة',
      sku: 'DR-001',
      quantity: 1,
      currency: 'SAR',
      images: [{ image: 'https://example.com/a.jpg' }],
      product: { id: 55, name: 'فستان سهرة', sku: 'DR-001', price: 725, thumbnail: 't.jpg' },
      variant: { id: 9, name: 'أحمر / M' },
      amounts: {
        price: { amount: 725 },
        total: { amount: 725 },
        price_without_tax: { amount: 630 },
        tax: { amount: { amount: 95 } },
        total_discount: { amount: 0 },
      },
    },
  ],
} as never;

/** Every key present anywhere in a serialized payload. */
function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, found));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      found.add(key);
      collectKeys(entry, found);
    }
  }
  return found;
}

test('the public order view carries no customer or address data at any depth', () => {
  const view = toPublicOrderView(orderFixture, { isInternational: false });
  const keys = collectKeys(JSON.parse(JSON.stringify(view)));

  for (const forbidden of [
    'customer',
    'email',
    'mobile',
    'phone',
    'shipping',
    'shipping_address',
    'billing_address',
    'address',
  ]) {
    assert.equal(keys.has(forbidden), false, `expected no "${forbidden}" key in the public view`);
  }

  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes('reem@example.com'), false);
  assert.equal(serialized.includes('512345678'), false);
  assert.equal(serialized.includes('العتيبي'), false);
});

test('the public order view keeps everything the returns flow renders', () => {
  const view = toPublicOrderView(orderFixture, { isInternational: true });

  assert.equal(view.id, 1234567);
  assert.equal(view.reference_id, '251263484');
  assert.equal(view.isInternational, true);
  assert.deepEqual(view.status, { name: 'تم التوصيل', slug: 'delivered' });
  assert.equal(view.amounts.total.amount, 750);
  assert.equal(view.amounts.shipping_cost?.amount, 25);
  assert.equal(view.date?.created, '2026-08-01 10:00:00');

  const item = view.items[0] as Record<string, any>;
  assert.equal(item.id, 987);
  assert.equal(item.sku, 'DR-001');
  assert.equal(item.quantity, 1);
  assert.equal(item.variant.name, 'أحمر / M');
  assert.equal(item.product.price, 725);
  assert.equal(item.images[0].image, 'https://example.com/a.jpg');
  // calculateItemPrice in ReturnForm reads exactly these three.
  assert.equal(item.amounts.price_without_tax.amount, 630);
  assert.equal(item.amounts.tax.amount.amount, 95);
  assert.equal(item.amounts.total_discount.amount, 0);
});

test('the public order view keeps item attributes discoverable', () => {
  // getItemAttributes scans arbitrary keys on the item, its product, variant,
  // details, metadata and options — none of that may be trimmed away.
  const withAttributes = {
    ...(orderFixture as Record<string, any>),
    items: [
      {
        id: 1,
        quantity: 1,
        options: [{ name: 'اللون', value: 'أحمر' }],
        details: { size: 'M' },
        metadata: { options: [{ name: 'مقاس', value: 'M' }] },
      },
    ],
  } as never;

  const item = toPublicOrderView(withAttributes, { isInternational: false })
    .items[0] as Record<string, any>;

  assert.equal(item.options[0].value, 'أحمر');
  assert.equal(item.details.size, 'M');
  assert.equal(item.metadata.options[0].value, 'M');
});
