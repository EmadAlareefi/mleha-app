import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlaceName, resolveAjexSaudiLocation } from '../locations';

test('maps Arabic city and district names to AJEX codes', () => {
  assert.deepEqual(resolveAjexSaudiLocation('الرياض', 'حي العليا'), {
    city: 'Riyadh',
    cityCode: 'RUH',
    region: 'Central',
    district: 'Al Olaya',
    districtCode: 'SAU-CENTERAL-RUH-AL OLAYA',
  });
  assert.equal(resolveAjexSaudiLocation('جده', 'الروضة')?.districtCode, 'SAU-WESTERN-JED-AR RAWDAH');
  assert.equal(resolveAjexSaudiLocation('الأحساء', 'المزروعية')?.cityCode, 'HOF');
});

test('maps English spellings regardless of article and case', () => {
  assert.equal(resolveAjexSaudiLocation('riyadh', 'olaya')?.districtCode, 'SAU-CENTERAL-RUH-AL OLAYA');
  assert.equal(resolveAjexSaudiLocation('Al-Khobar', 'Al Aqrabiyah')?.cityCode, 'DMM007');
});

test('matches districts only within the resolved city', () => {
  // Ar Rawdah exists in both Riyadh and Jeddah with different codes.
  const riyadh = resolveAjexSaudiLocation('Riyadh', 'Ar Rawdah');
  const jeddah = resolveAjexSaudiLocation('Jeddah', 'Ar Rawdah');
  assert.ok(riyadh?.districtCode?.includes('-RUH-'));
  assert.ok(jeddah?.districtCode?.includes('-JED-'));
});

test('keeps the city when the district is unknown and rejects unknown cities', () => {
  const partial = resolveAjexSaudiLocation('الرياض', 'حي غير موجود');
  assert.equal(partial?.cityCode, 'RUH');
  assert.equal(partial?.districtCode, null);
  assert.equal(resolveAjexSaudiLocation('Atlantis', 'Olaya'), null);
  assert.equal(resolveAjexSaudiLocation(undefined, 'Olaya'), null);
});

test('normalizes Arabic letter variants and articles', () => {
  assert.equal(normalizePlaceName('مكة المكرمة'), normalizePlaceName('مكه المكرمه'));
  assert.equal(normalizePlaceName('Al Madinah'), normalizePlaceName('madinah'));
});
