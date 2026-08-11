import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  differsOnlyBySkuZeroPadding,
  numericSkuKey,
  numericMeasurement,
  parseSizeGuideImport,
  serializeSizeGuidesCsv,
  sizeGuideSkuCandidates,
  sizeGuideSkuKey,
  validateSizeGuideDocument,
} from '../salla-size-guides';
import { extractSallaSizeOptions, reconcileSizeGuideRows } from '../salla-size-guide-products';

const HEADERS = ['  ', 'SALLA_PRODUCT_ID', 'Size', 'CHEST', 'WAIST', 'HIP', 'SHOULDER', 'LENGTH', 'SLEEVE', 'BLOUSE_LEN', 'SKIRT_LEN'];

function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'data');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('imports the data worksheet and treats a blank first header as SKU', () => {
  const result = parseSizeGuideImport(workbook([
    ['7049', '203892285', 'S', '36', '28', '', '', '57', '', '', ''],
    ['7049', '203892285', 'M', '38', '30', '', '', '57', '', '', ''],
  ]), 'sizes.xlsx');

  assert.equal(result.sheetName, 'data');
  assert.equal(result.summary.guides, 1);
  assert.equal(result.summary.publishable, 1);
  assert.equal(result.guides[0].sku, '7049');
  assert.equal(result.guides[0].productId, '203892285');
  assert.equal(result.guides[0].data.rows[1].CHEST, '38');
});

test('preserves leading zero SKUs as distinct guides', () => {
  const result = parseSizeGuideImport(workbook([
    ['66', '1001', 'S', '30', '26', '', '', '', '', '', ''],
    ['0066', '1002', 'S', '32', '28', '', '', '', '', '', ''],
  ]), 'sizes.xlsx');

  assert.deepEqual(result.guides.map((guide) => guide.skuKey), ['66', '0066']);
  assert.equal(sizeGuideSkuKey('0066'), '0066');
});

test('preserves an Excel numeric SKU when its cell format contains leading zeroes', () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    [98, '1001', 'S', '30', '26', '', '', '', '', '', ''],
  ]);
  sheet.A2.z = '0000';
  XLSX.utils.book_append_sheet(book, sheet, 'data');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', cellStyles: true }) as Buffer;

  const result = parseSizeGuideImport(buffer, 'formatted-skus.xlsx');
  assert.equal(result.guides[0].sku, '0098');
  assert.equal(result.guides[0].skuKey, '0098');
});

test('blocks duplicated and non-monotonic fit rows while retaining display-only text', () => {
  const duplicate = validateSizeGuideDocument({ rows: [
    { size: 'S', CHEST: '36', WAIST: '28', HIP: '-', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
    { size: 'S', CHEST: '34', WAIST: '30', HIP: 'ملاحظة', SHOULDER: '', LENGTH: '', SLEEVE: '', BLOUSE_LEN: '', SKIRT_LEN: '' },
  ] });

  assert.equal(duplicate.canPublish, false);
  assert.ok(duplicate.issues.some((issue) => issue.code === 'duplicate_size'));
  assert.ok(duplicate.issues.some((issue) => issue.code === 'non_monotonic_measurement'));
  assert.ok(duplicate.issues.some((issue) => issue.code === 'display_only_measurement'));
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

test('accepts prototype CSV headers and preserves the Salla product identity', () => {
  const csv = [
    'sku,salla_product_id,name,size,chest,waist,hip,shoulder,length,sleeve,blouse,skirt',
    '7490,203892285,فستان,S,34,27,37,17.9,52,,,',
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
  ] }).data.rows;
  const result = reconcileSizeGuideRows(current, ['S', 'M']);
  assert.equal(result.rows[0].CHEST, '34');
  assert.equal(result.rows[1].CHEST, '');
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
