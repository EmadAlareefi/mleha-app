import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  differsOnlyBySkuZeroPadding,
  numericSkuKey,
  numericMeasurement,
  normalizeSizeGuideLabel,
  parseSizeGuideImport,
  serializeSizeGuidesCsv,
  sizeGuideSkuCandidates,
  sizeGuideSkuKey,
  validateSizeGuideDocument,
} from '../salla-size-guides';
import { extractSallaSizeOptions, reconcileSizeGuideRows } from '../salla-size-guide-products';
import {
  isSizeGuideProductFamilySku,
  productMatchesSizeGuideRows,
  sharedSizeGuideFamilySku,
  sizeGuideProductsShareSizes,
} from '../salla-size-guide-links';

const HEADERS = ['  ', 'SALLA_PRODUCT_ID', 'Size', 'CHEST', 'WAIST', 'LENGTH', 'BLOUSE_LEN', 'SKIRT_LEN'];

function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'data');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('imports the data worksheet and treats a blank first header as SKU', () => {
  const result = parseSizeGuideImport(workbook([
    ['7049', '203892285', 'S', '36', '28', '57', '', ''],
    ['7049', '203892285', 'M', '38', '30', '57', '', ''],
  ]), 'sizes.xlsx');

  assert.equal(result.sheetName, 'data');
  assert.equal(result.summary.guides, 1);
  assert.equal(result.summary.publishable, 1);
  assert.equal(result.guides[0].sku, '7049');
  assert.equal(result.guides[0].productId, '203892285');
  assert.equal(result.guides[0].data.rows[1].CHEST, '38');
  assert.equal(result.summary.warnings, 0);
  assert.equal(result.guides[0].data.rows[0].HIP, '');
  assert.equal(result.guides[0].data.rows[0].SHOULDER, '');
  assert.equal(result.guides[0].data.rows[0].SLEEVE, '');
});

test('preserves leading zero SKUs as distinct guides', () => {
  const result = parseSizeGuideImport(workbook([
    ['66', '1001', 'S', '30', '26', '', '', ''],
    ['0066', '1002', 'S', '32', '28', '', '', ''],
  ]), 'sizes.xlsx');

  assert.deepEqual(result.guides.map((guide) => guide.skuKey), ['66', '0066']);
  assert.equal(sizeGuideSkuKey('0066'), '0066');
});

test('preserves an Excel numeric SKU when its cell format contains leading zeroes', () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    [98, '1001', 'S', '30', '26', '', '', ''],
  ]);
  sheet.A2.z = '0000';
  XLSX.utils.book_append_sheet(book, sheet, 'data');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;

  const result = parseSizeGuideImport(buffer, 'formatted-skus.xlsx');
  assert.equal(result.guides[0].sku, '0098');
  assert.equal(result.guides[0].skuKey, '0098');
});

test('blocks duplicated and non-monotonic fit rows without warning about display-only text', () => {
  const duplicate = validateSizeGuideDocument({ rows: [
    { size: 'S', CHEST: '36', WAIST: '28', HIP: '-', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
    { size: 'S', CHEST: '34', WAIST: '30', HIP: 'ملاحظة', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
  ] });

  assert.equal(duplicate.canPublish, false);
  assert.ok(duplicate.issues.some((issue) => issue.code === 'duplicate_size'));
  assert.ok(duplicate.issues.some((issue) => issue.code === 'non_monotonic_measurement'));
  assert.equal(duplicate.issues.some((issue) => issue.code === 'display_only_measurement'), false);
  assert.equal(duplicate.data.rows[1].HIP, 'ملاحظة');
  assert.equal(numericMeasurement('-'), null);
});

test('SKU candidates prefer the exact normalized value without stripping leading zeros', () => {
  assert.deepEqual(sizeGuideSkuCandidates('ML-007628-A'), ['ML007628A', '007628']);
});

test('numeric SKU candidates bridge legacy values that lost leading zeroes', () => {
  assert.deepEqual(sizeGuideSkuCandidates('0098').slice(0, 4), ['0098', '98', '098', '00098']);
  assert.ok(sizeGuideSkuCandidates('98').includes('0098'));
  assert.equal(numericSkuKey('0000'), '0');
  assert.equal(numericSkuKey('ML-0098'), null);
  assert.equal(numericSkuKey('001-11'), null);
  assert.equal(sizeGuideSkuCandidates('001-11').includes('111'), false);
  assert.equal(differsOnlyBySkuZeroPadding('98', '0098'), true);
  assert.equal(differsOnlyBySkuZeroPadding('98', '0099'), false);
});

test('normalizes the 2XL alias to Salla XXL', () => {
  assert.equal(normalizeSizeGuideLabel('2xl'), 'XXL');
  assert.equal(normalizeSizeGuideLabel('2 XL'), 'XXL');
  const guide = validateSizeGuideDocument({ rows: [
    { size: '2XL', CHEST: '42', WAIST: '36', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
  ] });
  assert.equal(guide.data.rows[0].size, 'XXL');
});

test('matches only explicit SKU families with the same ordered Salla sizes', () => {
  const product = {
    id: 1,
    sku: '7615-05',
    name: 'Family product',
    options: [{
      id: 10,
      name: 'المقاسات',
      values: ['S', 'M', 'L'].map((name, index) => ({ id: index, name })),
    }],
  };
  const document = validateSizeGuideDocument({ rows: [
    { size: 'S', CHEST: '30', WAIST: '', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
    { size: 'M', CHEST: '32', WAIST: '', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
    { size: 'L', CHEST: '34', WAIST: '', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
  ] }).data;

  assert.equal(isSizeGuideProductFamilySku('7615', '7615-05'), true);
  assert.equal(isSizeGuideProductFamilySku('7615', '76150-05'), false);
  assert.equal(isSizeGuideProductFamilySku('7615', '7615'), false);
  assert.equal(productMatchesSizeGuideRows(product, document), true);
  assert.equal(productMatchesSizeGuideRows({ ...product, options: [{ ...product.options[0], values: [{ id: 1, name: 'S' }] }] }, document), false);
});

test('derives one family SKU when several Salla products are selected together', () => {
  assert.equal(sharedSizeGuideFamilySku(['7776-20', '7776-25', '7776-26', '7776-30']), '7776');
  assert.equal(sharedSizeGuideFamilySku(['7776-20', '8888-20']), null);
  assert.equal(sharedSizeGuideFamilySku(['7776-20']), null);
  assert.equal(sharedSizeGuideFamilySku(['7776']), null);

  const primary = {
    id: '1', sku: '7776-20', name: 'Primary', imageUrl: null,
    sizeOption: { id: '10', name: 'Size', values: ['S', 'M', '2XL'].map((label) => ({ id: label, label, isOutOfStock: false })) },
  };
  const matching = {
    ...primary,
    id: '2', sku: '7776-25',
    sizeOption: { ...primary.sizeOption, values: ['S', 'M', 'XXL'].map((label) => ({ id: label, label, isOutOfStock: false })) },
  };
  assert.equal(sizeGuideProductsShareSizes(primary, matching), true);
  assert.equal(sizeGuideProductsShareSizes(primary, { ...matching, sizeOption: { ...matching.sizeOption, values: matching.sizeOption.values.slice(0, 2) } }), false);
});

test('accepts prototype CSV headers and preserves the Salla product identity', () => {
  const csv = [
    'sku,salla_product_id,name,size,chest,waist,length,blouse,skirt',
    '7490,203892285,فستان,S,34,27,52,,',
  ].join('\n');
  const result = parseSizeGuideImport(Buffer.from(csv), 'sizes.csv');
  assert.equal(result.guides[0].productId, '203892285');
  assert.equal(result.guides[0].productName, 'فستان');
  assert.equal(result.guides[0].data.rows[0].BLOUSE_LEN, '');
});

test('extracts Arabic and translated English size options while retaining out-of-stock values', () => {
  const result = extractSallaSizeOptions([
    { id: 1, name: 'اللون', values: [{ id: 11, name: 'أسود' }] },
    {
      id: 2,
      name: 'المقاس',
      translations: { en: { option_name: 'Size' } },
      values: [
        { id: 21, name: 'S', isOutOfStock: true },
        { id: 22, name: 'M', isOutOfStock: false },
      ],
    },
  ]);
  assert.equal(result.error, null);
  assert.deepEqual(result.selected?.values.map((value) => [value.label, value.isOutOfStock]), [['S', true], ['M', false]]);
});

test('reconciles Salla sizes without losing matching measurements', () => {
  const current = validateSizeGuideDocument({ rows: [
    { size: 's', CHEST: '34', WAIST: '27', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
    { size: 'L', CHEST: '38', WAIST: '31', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
    { size: '2XL', CHEST: '42', WAIST: '35', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
  ] }).data.rows;
  const result = reconcileSizeGuideRows(current, ['S', 'M', 'XXL']);
  assert.equal(result.rows[0].CHEST, '34');
  assert.equal(result.rows[1].CHEST, '');
  assert.equal(result.rows[2].CHEST, '42');
  assert.equal(result.rows[2].size, 'XXL');
  assert.deepEqual(result.added, ['M']);
  assert.deepEqual(result.removed.map((row) => row.size), ['L']);
});

test('exports a BOM-prefixed CSV that can be imported again', () => {
  const csv = serializeSizeGuidesCsv([{
    sku: '7490',
    productId: '203892285',
    productName: 'فستان، مطرز',
    draftData: { rows: [{ size: 'S', CHEST: '34', WAIST: '27', HIP: '', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' }] },
    publishedAt: new Date('2026-08-10T00:00:00Z'),
    updatedAt: new Date('2026-08-11T00:00:00Z'),
  }]);
  assert.ok(csv.startsWith('\uFEFF'));
  const imported = parseSizeGuideImport(Buffer.from(csv), 'roundtrip.csv');
  assert.equal(imported.guides[0].productName, 'فستان، مطرز');
  assert.equal(imported.guides[0].data.rows[0].CHEST, '34');
});
