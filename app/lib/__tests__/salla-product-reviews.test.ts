import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PRODUCT_REVIEWS_PER_BATCH,
  parseProductId,
  parseProductReviewCreate,
  parseRating,
  parseReviewImageData,
} from '../salla-product-reviews';

test('accepts exact digit-string Salla ids without numeric precision loss', () => {
  assert.equal(parseProductId('3014694887033630745'), '3014694887033630745');
  assert.throws(() => parseProductId('product-10'), /رقم المنتج/);
});

test('validates and trims a bulk review row', () => {
  assert.deepEqual(
    parseProductReviewCreate({
      productId: '123',
      productName: '  فستان سهرة  ',
      productSku: ' A-1 ',
      productImageUrl: 'https://cdn.salla.sa/product.jpg',
      reviewerName: ' ريم ',
      reviewerCity: ' جدة ',
      body: ' جميل جداً ',
      reviewImageData: 'data:image/png;base64,YWJjZA==',
      rating: 5,
    }),
    {
      productId: '123',
      productName: 'فستان سهرة',
      productSku: 'A-1',
      productImageUrl: 'https://cdn.salla.sa/product.jpg',
      reviewerName: 'ريم',
      reviewerCity: 'جدة',
      body: 'جميل جداً',
      reviewImageData: 'data:image/png;base64,YWJjZA==',
      rating: 5,
    }
  );
  assert.equal(MAX_PRODUCT_REVIEWS_PER_BATCH, 100);
});

test('rejects invalid ratings and unsafe image protocols', () => {
  assert.throws(() => parseRating(0), /بين 1 و5/);
  assert.throws(() => parseRating(6), /بين 1 و5/);
  assert.throws(
    () => parseProductReviewCreate({
      productId: '123',
      productName: 'فستان',
      productImageUrl: 'javascript:alert(1)',
      reviewerName: 'ريم',
      reviewerCity: 'جدة',
      body: 'جميل',
      rating: 5,
    }),
    /رابط صورة المنتج/
  );
  assert.equal(parseReviewImageData(null), null);
  assert.throws(() => parseReviewImageData('data:image/svg+xml;base64,PHN2Zz4='), /غير مدعومة/);
});
