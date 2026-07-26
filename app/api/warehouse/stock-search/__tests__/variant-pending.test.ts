import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  SallaProductSummary,
  SallaProductVariation,
} from '@/app/lib/salla-api';
import {
  collectPendingVariantEntries,
  findPendingVariantKey,
  getPendingVariantKey,
} from '../variant-pending';

const product: SallaProductSummary = {
  id: 1770746731,
  name: 'فستان تركواز',
  sku: '7770-10',
  variations: [],
};

const variations: SallaProductVariation[] = [
  { id: 146190333, name: 'S', availableQuantity: 6 },
  { id: 1519636222, name: 'M', availableQuantity: 9 },
  { id: 1344416761, name: 'XXL', availableQuantity: 8 },
];

test('matches an active order item to a SKU-less Salla variant by product_sku_id', () => {
  const entrySet = collectPendingVariantEntries(
    [product],
    { [product.id]: variations }
  );
  const item = {
    sku: '7770-10',
    product_sku_id: 1344416761,
    quantity: 1,
    options: [
      {
        name: 'المقاسات',
        value: { name: 'XXL', option_value: 'XXL' },
      },
    ],
  };

  assert.equal(
    findPendingVariantKey(item, entrySet.entries),
    getPendingVariantKey(product.id, variations[2])
  );
});

test('uses the selected option when the order payload has no variant id', () => {
  const entrySet = collectPendingVariantEntries(
    [product],
    { [product.id]: variations }
  );

  assert.equal(
    findPendingVariantKey(
      {
        sku: '7770-10',
        quantity: 1,
        options: [{ value: { name: 'M' } }],
      },
      entrySet.entries
    ),
    getPendingVariantKey(product.id, variations[1])
  );
});

test('does not assign a parent SKU quantity to every variant when it is ambiguous', () => {
  const entrySet = collectPendingVariantEntries(
    [product],
    { [product.id]: variations }
  );

  assert.equal(
    findPendingVariantKey({ sku: '7770-10', quantity: 1 }, entrySet.entries),
    null
  );
});
