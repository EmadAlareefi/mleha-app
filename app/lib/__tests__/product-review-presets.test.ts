import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateProductReviewDrafts,
  PRODUCT_REVIEW_PHRASES,
} from '../product-review-presets';

test('generates the requested editable reviews for every selected product', () => {
  const drafts = generateProductReviewDrafts(
    [
      { id: '10', name: 'منتج أول', sku: 'A' },
      { id: '20', name: 'منتج ثان', sku: 'B' },
    ],
    3,
    () => 0.25
  );

  assert.equal(drafts.length, 6);
  assert.equal(drafts.filter((draft) => draft.productId === '10').length, 3);
  assert.equal(drafts.filter((draft) => draft.productId === '20').length, 3);
  assert.equal(drafts.every((draft) => draft.rating === 5), true);
  assert.equal(new Set(drafts.slice(0, 3).map((draft) => draft.body)).size, 3);
});

test('clamps generation to one through ten reviews per product', () => {
  const product = [{ id: '10', name: 'منتج' }];
  assert.equal(generateProductReviewDrafts(product, 0, () => 0).length, 1);
  assert.equal(generateProductReviewDrafts(product, 99, () => 0).length, 10);
  assert.ok(PRODUCT_REVIEW_PHRASES.length >= 10);
});
