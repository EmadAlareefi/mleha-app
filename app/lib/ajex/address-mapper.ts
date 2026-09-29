import saudiDistricts from './saudi-districts.json';

/**
 * Resolves Saudi city/district names to AJEX's own values and codes, from the
 * `Saudi_Cities_Districts.xlsx` workbook AJEX ships with API document v1.7
 * (converted to `saudi-districts.json`: region, city, cityCode, district,
 * districtCode, Arabic district name).
 */

export interface AjexResolvedLocation {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  cityCode: string;
  district: string;
  districtCode: string;
}

type DistrictRow = [string, string, string, string, string, string];
const ROWS = saudiDistricts as DistrictRow[];

const CITY_ALIASES: Record<string, string> = {
  الرياض: 'Riyadh',
  جده: 'Jeddah',
  جدة: 'Jeddah',
  الدمام: 'Dammam',
  مكه: 'Makkah',
  مكة: 'Makkah',
  'مكة المكرمة': 'Makkah',
  المدينه: 'Medina',
  المدينة: 'Medina',
  'المدينة المنورة': 'Medina',
  الخبر: 'Khobar',
  الظهران: 'Dhahran',
  بريده: 'Buraydah',
  بريدة: 'Buraydah',
  الطائف: 'Taif',
  تبوك: 'Tabuk',
};

export function normalizeAjexName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/^حي\s+/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLocaleLowerCase('en');
}

const toLocation = (row: DistrictRow): AjexResolvedLocation => ({
  country: 'Saudi Arabia',
  countryCode: 'SAU',
  region: row[0],
  city: row[1],
  cityCode: row[2],
  district: row[3],
  districtCode: row[4],
});

const cityRows = (city: string) => {
  const target = normalizeAjexName(CITY_ALIASES[city.trim()] ?? city);
  return ROWS.filter((row) => normalizeAjexName(row[1]) === target);
};

/**
 * The AJEX city (and region) for a city name, or null when AJEX doesn't serve it.
 * District fields are empty; use `resolveAjexLocation` for a full match.
 */
export function resolveAjexCity(city: string): Omit<AjexResolvedLocation, 'district' | 'districtCode'> | null {
  const row = cityRows(city)[0];
  if (!row) return null;
  const { country, countryCode, region, city: cityName, cityCode } = toLocation(row);
  return { country, countryCode, region, city: cityName, cityCode };
}

/** Exact AJEX city + district match (English or Arabic district name), or null. */
export function resolveAjexLocation(city: string, district: string): AjexResolvedLocation | null {
  const target = normalizeAjexName(district);
  if (!target) return null;
  const row = cityRows(city).find(
    (candidate) =>
      normalizeAjexName(candidate[3]) === target ||
      (candidate[5] && normalizeAjexName(candidate[5]) === target),
  );
  return row ? toLocation(row) : null;
}
