import assert from 'node:assert/strict';
import test from 'node:test';
import { effectivePrice, isExcludedProduct, normalizeProduct, skuLabel, skuOrderOptions } from '../returns/exchange-catalog';

const raw = {
  id: 525218146,
  name: 'فستان كتان',
  status: 'sale',
  price: { amount: 120, currency: 'SAR' },
  sale_price: { amount: 69 },
  main_image: 'https://cdn.salla.sa/a.jpg',
  images: [{ url: 'https://cdn.salla.sa/a.jpg' }, { url: 'https://cdn.salla.sa/b.jpg' }],
  categories: [{ name: 'فساتين' }],
  options: [
    { id: 1631773224, name: 'المقاسات', values: [{ id: 66202505, name: 'S' }, { id: 1574914698, name: 'M' }] },
  ],
  skus: [
    { id: 1346949293, sku: null, stock_quantity: 26, price: { amount: 69 }, regular_price: { amount: 120 }, related_option_values: [66202505] },
    { id: 571867054, sku: null, stock_quantity: 0, price: { amount: 120 }, sale_price: { amount: 69 }, related_option_values: [1574914698] },
  ],
};

test('normalizes sale price, gallery, options and per-size stock', () => {
  const product = normalizeProduct(raw);
  assert.equal(product.price, 69);
  assert.equal(product.regularPrice, 120);
  assert.equal(product.images.length, 2);
  assert.deepEqual(product.skus.map((sku) => [sku.id, sku.inStock, sku.price]), [['1346949293', true, 69], ['571867054', false, 69]]);
});

test('builds the POST /orders option payload and a size label for a SKU', () => {
  const product = normalizeProduct(raw);
  assert.deepEqual(skuOrderOptions(product, product.skus[0]), [{ id: '1631773224', value: ['66202505'] }]);
  assert.equal(skuLabel(product, product.skus[0]), 'S');
});

test('products without options become a single SKU', () => {
  const product = normalizeProduct({ id: 9, name: 'حزام', price: { amount: 50 }, quantity: 3, sku: 'BELT' });
  assert.equal(product.skus.length, 1);
  assert.equal(product.skus[0].id, '9');
  assert.equal(product.skus[0].stock, 3);
});

test('1 SAR promo items cannot be chosen as replacements', () => {
  assert.equal(isExcludedProduct({ categories: [{ name: 'القسم المجاني' }] }), true);
  assert.equal(isExcludedProduct({ categories: [{ name: 'فساتين' }] }), false);
});

test('sale price only counts when it is a real discount', () => {
  assert.equal(effectivePrice(100, 0), 100);
  assert.equal(effectivePrice(100, 80), 80);
  assert.equal(effectivePrice(100, 120), 100);
});
