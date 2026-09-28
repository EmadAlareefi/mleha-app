import saCities from './data/sa-cities-districts.json';

/**
 * AJEX's Saudi city/district master list, as published at
 * https://files.aj-ex.com/Saudi_Cities_Districts.xlsx. Each district row is
 * `[districtCode, englishName, arabicName?]`.
 */
interface AjexCityRecord {
  code: string;
  name: string;
  region: string;
  districts: Array<[string, string] | [string, string, string]>;
}

export interface AjexResolvedLocation {
  city: string;
  cityCode: string;
  region: string;
  district: string | null;
  districtCode: string | null;
}

const CITIES = saCities as AjexCityRecord[];

/**
 * Arabic (and common alternative English) spellings Salla uses for each AJEX
 * city code. AJEX only publishes English city names, while Salla addresses
 * usually carry the Arabic one.
 */
const CITY_ALIASES: Record<string, string[]> = {
  RUH: ['الرياض', 'riyad', 'ar riyadh'],
  JED: ['جدة', 'جده', 'jeddah', 'jiddah', 'jedda'],
  MAC: ['مكة', 'مكة المكرمة', 'مكه', 'مكه المكرمه', 'makkah', 'mecca', 'makka'],
  MED: ['المدينة', 'المدينة المنورة', 'المدينه المنوره', 'madinah', 'al madinah', 'madina', 'medina'],
  DMM: ['الدمام', 'dammam'],
  DMM007: ['الخبر', 'khobar', 'al khobar'],
  DMM008: ['الظهران', 'dhahran'],
  DMM012: ['القطيف', 'qatif'],
  DMM011: ['سيهات', 'saihat'],
  DMM010: ['صفوى', 'صفوي', 'safwa'],
  DMM040: ['تاروت', 'tarout', 'tarut'],
  DMM001: ['بقيق', 'ابقيق', 'buqayq', 'abqaiq'],
  DMM009: ['راس تنورة', 'رأس تنورة', 'ras tanura'],
  DMM014: ['عنك', 'anak'],
  QJB: ['الجبيل', 'jubail', 'al jubail'],
  HOF: ['الهفوف', 'الأحساء', 'الاحساء', 'hofuf', 'al hofuf', 'al ahsa', 'alahsa', 'ahsa'],
  HOF003: ['المبرز', 'mubarraz', 'al mubarraz'],
  HBT: ['حفر الباطن', 'hafar al batin', 'hafr al batin'],
  HBT015: ['الخفجي', 'khafji'],
  AQI: ['القيصومة', 'qaisumah'],
  KMC: ['مدينة الملك خالد العسكرية', 'king khalid military city'],
  TIF: ['الطائف', 'الطايف', 'taif'],
  TIF001: ['الخرمة', 'khurma'],
  TIF032: ['تربة', 'turbah'],
  MAC001: ['الجموم', 'jumum'],
  JED012: ['رابغ', 'rabigh'],
  JED001: ['خليص', 'khulais'],
  JED003: ['الليث', 'lith'],
  JED006: ['مدينة الملك عبدالله الاقتصادية', 'king abdullah economic city', 'kaec'],
  JED033: ['ثول', 'thuwal'],
  JED015: ['بحرة', 'bahrah'],
  ABT058: ['القنفذة', 'qunfudhah', 'al qunfudhah'],
  YNB: ['ينبع', 'yanbu'],
  YNB001: ['املج', 'أملج', 'umluj'],
  YNB024: ['بدر', 'badr'],
  ULH: ['العلا', 'alula', 'al ula'],
  MED039: ['خيبر', 'khaybar'],
  MED011: ['الحناكية', 'henakiyah'],
  MED029: ['مهد الذهب', 'mahd al thahab'],
  TUU: ['تبوك', 'tabuk'],
  TUU019: ['حقل', 'haql'],
  TUU026: ['تيماء', 'tayma'],
  TUU001: ['البدع', 'al bad'],
  EJH: ['الوجه', 'al wajh', 'wajh'],
  EJH005: ['ضباء', 'ضبا', 'duba'],
  AJF: ['سكاكا', 'الجوف', 'sakaka', 'al jouf', 'jouf'],
  AJF012: ['دومة الجندل', 'dumah al jandal'],
  AJF025: ['طبرجل', 'tubarjal'],
  RAE: ['عرعر', 'arar'],
  RAH: ['رفحاء', 'rafha'],
  TUI: ['طريف', 'turaif'],
  URY: ['القريات', 'qurayyat', 'al qurayyat'],
  HAS: ['حائل', 'حايل', 'hail', 'hael'],
  ELQ: ['بريدة', 'بريده', 'القصيم', 'buraydah', 'buraidah', 'qassim'],
  ELQ018: ['عنيزة', 'عنيزه', 'unayzah', 'unaizah'],
  ELQ004: ['الرس', 'ar rass', 'rass'],
  ELQ021: ['المذنب', 'mithnab'],
  ELQ006: ['البدائع', 'badayea'],
  ELQ007: ['البكيرية', 'bukayriyah'],
  ELQ020: ['رياض الخبراء', 'riyadh al khabra'],
  AKH: ['الخرج', 'kharj', 'al kharj'],
  RUH002: ['الدرعية', 'diriyah'],
  RUH027: ['ضرما', 'dhurma'],
  RUH001: ['الدلم', 'dilam'],
  RUH006: ['تمير', 'tumair'],
  RUH008: ['حريملاء', 'huraymila'],
  RUH004: ['رماح', 'rumah'],
  RUH007: ['الحريق', 'hariq'],
  RUH048: ['ثادق', 'thadiq'],
  MJH: ['المجمعة', 'majmaah', 'al majmaah'],
  ZUL: ['الزلفي', 'zulfi'],
  DWD: ['الدوادمي', 'dawadmi'],
  DWD002: ['عفيف', 'afif'],
  DWD019: ['شقراء', 'shaqra'],
  DWD007: ['القويعية', 'quwaiiyah'],
  WAE: ['وادي الدواسر', 'wadi al dawasir'],
  WAE010: ['ليلى', 'الأفلاج', 'الافلاج', 'layla', 'aflaj'],
  SLF: ['السليل', 'sulayyil'],
  AHB: ['أبها', 'ابها', 'abha'],
  KMX: ['خميس مشيط', 'khamis mushait', 'khamis mushayt'],
  AHB003: ['أحد رفيدة', 'احد رفيده', 'ahad rafidah'],
  AHB039: ['محايل', 'محايل عسير', 'muhayil'],
  AHB017: ['النماص', 'namas'],
  AHB033: ['ظهران الجنوب', 'dhahran al janub'],
  AHB047: ['سراة عبيدة', 'sarat abidah'],
  AHB029: ['بارق', 'bariq'],
  AHB001: ['رجال ألمع', 'رجال المع', 'rijal alma'],
  AHB013: ['الحرجة', 'harajah'],
  BHH: ['بيشة', 'bisha'],
  BHH006: ['تثليث', 'tathleeth'],
  ABT: ['الباحة', 'الباحه', 'al bahah', 'baha', 'al baha'],
  ABT004: ['العقيق', 'al aqiq'],
  EAM: ['نجران', 'najran'],
  EAM008: ['حبونا', 'hubuna'],
  EAM001: ['الحسينية', 'husayniyah'],
  EAM012: ['يدمة', 'yadamah'],
  GIZ: ['جازان', 'جيزان', 'jazan', 'jizan', 'gizan'],
  GIZ001: ['صبيا', 'sabya'],
  GIZ004: ['أبو عريش', 'ابو عريش', 'abu arish'],
  GIZ116: ['صامطة', 'samtah'],
  GIZ081: ['بيش', 'baish'],
  GIZ101: ['أحد المسارحة', 'احد المسارحه', 'ahad al masarihah'],
  GIZ009: ['العارضة', 'aridhah'],
  GIZ002: ['ضمد', 'damad'],
  GIZ006: ['الداير', 'addayer'],
};

const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g;
const ARABIC_DIGITS = /[٠-٩]/g;
const EN_ARTICLES = /\b(al|el|ar|as|ad|az|at|ash|an|adh|ath)\b/g;
const DISTRICT_PREFIX = /^(حي|district|dist|hay|hai)\s+/;

/**
 * Folds the spelling differences between Salla's free-text addresses and the
 * AJEX master list: Arabic letter variants, the definite article in both
 * scripts, apostrophes, hyphens and spacing.
 */
export function normalizePlaceName(value: string): string {
  let text = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/['`’‘"]/g, '')
    .replace(/[-_.,،/\\()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text.replace(DISTRICT_PREFIX, '');
  // Arabic definite article at the start of each word.
  text = text.replace(/(^|\s)ال(?=\S{2,})/g, '$1');
  text = text.replace(EN_ARTICLES, ' ');
  return text.replace(/\s+/g, '');
}

const cityIndex = new Map<string, AjexCityRecord>();
const districtIndex = new Map<string, Map<string, [string, string]>>();

for (const city of CITIES) {
  const keys = [city.name, city.code, ...(CITY_ALIASES[city.code] ?? [])];
  for (const key of keys) {
    const normalized = normalizePlaceName(key);
    if (normalized && !cityIndex.has(normalized)) cityIndex.set(normalized, city);
  }

  const districts = new Map<string, [string, string]>();
  for (const [code, name, arabic] of city.districts) {
    for (const key of [name, arabic]) {
      if (!key) continue;
      const normalized = normalizePlaceName(key);
      if (normalized && !districts.has(normalized)) districts.set(normalized, [code, name]);
    }
  }
  districtIndex.set(city.code, districts);
}

export function findAjexCity(value: string | null | undefined): AjexCityRecord | null {
  if (!value) return null;
  return cityIndex.get(normalizePlaceName(value)) ?? null;
}

/**
 * Maps a Saudi city/district pair to the AJEX master list. The city is required
 * for a match; the district is matched within that city only, because district
 * names repeat across cities.
 */
export function resolveAjexSaudiLocation(
  city: string | null | undefined,
  district: string | null | undefined,
): AjexResolvedLocation | null {
  const record = findAjexCity(city);
  if (!record) return null;

  const districtMatch = district
    ? districtIndex.get(record.code)?.get(normalizePlaceName(district)) ?? null
    : null;

  return {
    city: record.name,
    cityCode: record.code,
    region: record.region,
    district: districtMatch ? districtMatch[1] : null,
    districtCode: districtMatch ? districtMatch[0] : null,
  };
}
