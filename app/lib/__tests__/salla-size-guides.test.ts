import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {
  numericMeasurement,
  parseSizeGuideImport,
  sizeGuideSkuCandidates,
  sizeGuideSkuKey,
  validateSizeGuideDocument,
} from '../salla-size-guides';

const HEADERS = ['  ', 'Size', 'CHEST', 'WAIST', 'HIP', 'SHOULDER', 'LENGTH', 'SLEEVE', 'BLOUSE_LEN', 'SKIRT_LEN'];

function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADERS, ...rows]), 'data');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('imports the data worksheet and treats a blank first header as SKU', () => {
  const result = parseSizeGuideImport(workbook([
    ['7049', 'S', '36', '28', '', '', '57', '', '', ''],
    ['7049', 'M', '38', '30', '', '', '57', '', '', ''],
  ]), 'sizes.xlsx');

  assert.equal(result.sheetName, 'data');
  assert.equal(result.summary.guides, 1);
  assert.equal(result.summary.publishable, 1);
  assert.equal(result.guides[0].sku, '7049');
  assert.equal(result.guides[0].data.rows[1].CHEST, '38');
});

test('preserves leading zero SKUs as distinct guides', () => {
  const result = parseSizeGuideImport(workbook([
    ['66', 'S', '30', '26', '', '', '', '', '', ''],
    ['0066', 'S', '32', '28', '', '', '', '', '', ''],
  ]), 'sizes.xlsx');

  assert.deepEqual(result.guides.map((guide) => guide.skuKey), ['66', '0066']);
  assert.equal(sizeGuideSkuKey('0066'), '0066');
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
