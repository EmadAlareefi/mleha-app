import * as XLSX from 'xlsx';

export const SIZE_GUIDE_SERVICE_KEY = 'salla-size-guides' as const;
export const SIZE_GUIDE_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export const SIZE_GUIDE_FIELDS = [
  'CHEST',
  'WAIST',
  'HIP',
  'SHOULDER',
  'LENGTH',
  'SLEEVE',
  'BLOUSE_LEN',
  'SKIRT_LEN',
] as const;

export const OPTIONAL_SIZE_GUIDE_FIELDS = ['HIP', 'SHOULDER', 'SLEEVE'] as const;

export const SIZE_GUIDE_FIT_FIELDS = ['CHEST', 'WAIST'] as const;

export type SizeGuideField = (typeof SIZE_GUIDE_FIELDS)[number];
export type SizeGuideFitField = (typeof SIZE_GUIDE_FIT_FIELDS)[number];

export type SizeGuideRow = {
  size: string;
} & Record<SizeGuideField, string>;

export type SizeGuideDocument = {
  unit: 'in';
  twoPiece: boolean;
  sallaSizeOptionId?: string;
  rows: SizeGuideRow[];
};

export type SizeGuideIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  row?: number;
  field?: SizeGuideField | 'SKU' | 'Size';
};

export type ValidatedSizeGuide = {
  data: SizeGuideDocument;
  issues: SizeGuideIssue[];
  canPublish: boolean;
};

export type ImportedSizeGuide = ValidatedSizeGuide & {
  sku: string;
  skuKey: string;
  productId: string;
  productName: string | null;
  sourceRows: number[];
};

export type SizeGuideImportResult = {
  sheetName: string;
  populatedRows: number;
  skippedRows: Array<{ row: number; message: string }>;
  guides: ImportedSizeGuide[];
  summary: {
    populatedRows: number;
    guides: number;
    publishable: number;
    blocked: number;
    warnings: number;
    skippedRows: number;
  };
};

const FIELD_LABELS: Record<SizeGuideField, string> = {
  CHEST: 'الصدر',
  WAIST: 'الخصر',
  HIP: 'الورك',
  SHOULDER: 'الكتف',
  LENGTH: 'الطول',
  SLEEVE: 'طول الكم',
  BLOUSE_LEN: 'طول البلوزة',
  SKIRT_LEN: 'طول التنورة',
};

function text(value: unknown, maxLength = 120): string {
  if (value == null) return '';
  return String(value).trim().slice(0, maxLength);
}

export function normalizeSizeGuideLabel(value: unknown): string {
  const label = text(value, 40).replace(/\s+/g, ' ');
  return /^2[\s_-]*X[\s_-]*L$/i.test(label) ? 'XXL' : label;
}

function emptyRow(): SizeGuideRow {
  return {
    size: '',
    CHEST: '',
    WAIST: '',
    HIP: '',
    SHOULDER: '',
    LENGTH: '',
    SLEEVE: '',
    BLOUSE_LEN: '',
    SKIRT_LEN: '',
  };
}

export function sizeGuideSkuKey(value: unknown): string {
  return text(value).toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function numericSkuKey(value: unknown): string | null {
  const raw = text(value);
  if (!/^\d+$/.test(raw)) return null;
  return raw.replace(/^0+(?=\d)/, '');
}

export function differsOnlyBySkuZeroPadding(left: unknown, right: unknown): boolean {
  const leftKey = sizeGuideSkuKey(left);
  const rightKey = sizeGuideSkuKey(right);
  const leftNumeric = numericSkuKey(left);
  const rightNumeric = numericSkuKey(right);
  return Boolean(
    leftKey &&
    rightKey &&
    leftKey !== rightKey &&
    leftNumeric &&
    leftNumeric === rightNumeric
  );
}

export function sizeGuideSkuCandidates(value: unknown): string[] {
  const raw = text(value);
  const candidates: string[] = [];
  const add = (candidate: unknown) => {
    const key = sizeGuideSkuKey(candidate);
    if (key.length >= 3 && !candidates.includes(key)) candidates.push(key);
  };
  const addNumeric = (candidate: string) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };

  add(raw);
  raw.split(/[-/_\s]+/).forEach(add);
  (raw.match(/\d{3,12}/g) || []).forEach(add);

  const numericKey = numericSkuKey(raw);
  if (numericKey) {
    addNumeric(numericKey);
    for (let width = numericKey.length + 1; width <= 12; width += 1) {
      addNumeric(numericKey.padStart(width, '0'));
    }
  }
  return candidates;
}

export function numericMeasurement(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseSizeGuideDocument(value: unknown): SizeGuideDocument {
  if (!value || typeof value !== 'object') throw new Error('بيانات دليل المقاسات غير صالحة');
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.rows)) throw new Error('صفوف دليل المقاسات مطلوبة');
  if (input.rows.length > 40) throw new Error('الحد الأعلى هو 40 مقاساً لكل منتج');

  const rows = input.rows.map((rawRow) => {
    if (!rawRow || typeof rawRow !== 'object') return emptyRow();
    const source = rawRow as Record<string, unknown>;
    const row = emptyRow();
    row.size = normalizeSizeGuideLabel(source.size ?? source.Size);
    SIZE_GUIDE_FIELDS.forEach((field) => {
      row[field] = text(source[field], 120);
    });
    return row;
  });

  return {
    unit: 'in',
    twoPiece: rows.some((row) => Boolean(row.BLOUSE_LEN || row.SKIRT_LEN)),
    ...(text(input.sallaSizeOptionId, 64) ? { sallaSizeOptionId: text(input.sallaSizeOptionId, 64) } : {}),
    rows,
  };
}

export function validateSizeGuideDocument(value: unknown): ValidatedSizeGuide {
  const data = parseSizeGuideDocument(value);
  const issues: SizeGuideIssue[] = [];

  if (data.rows.length === 0) {
    issues.push({ severity: 'error', code: 'empty_guide', message: 'أضف مقاساً واحداً على الأقل' });
  }

  const labels = new Map<string, number[]>();
  data.rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (!row.size) {
      issues.push({
        severity: 'error',
        code: 'missing_size',
        message: 'اسم المقاس مطلوب',
        row: rowNumber,
        field: 'Size',
      });
    } else {
      const key = row.size.toUpperCase();
      labels.set(key, [...(labels.get(key) || []), rowNumber]);
    }
  });

  labels.forEach((rowNumbers, label) => {
    if (rowNumbers.length > 1) {
      issues.push({
        severity: 'error',
        code: 'duplicate_size',
        message: `المقاس ${label} مكرر في الصفوف ${rowNumbers.join('، ')}`,
        row: rowNumbers[0],
        field: 'Size',
      });
    }
  });

  const hasUsableFitValue = SIZE_GUIDE_FIT_FIELDS.some((field) =>
    data.rows.some((row) => numericMeasurement(row[field]) != null)
  );
  if (!hasUsableFitValue) {
    issues.push({
      severity: 'error',
      code: 'missing_fit_measurements',
      message: 'يجب توفير قياس رقمي واحد على الأقل للصدر أو الخصر',
    });
  }

  SIZE_GUIDE_FIT_FIELDS.forEach((field) => {
    let previous: number | null = null;
    data.rows.forEach((row, index) => {
      const current = numericMeasurement(row[field]);
      if (current == null) return;
      if (previous != null && current < previous) {
        issues.push({
          severity: 'error',
          code: 'non_monotonic_measurement',
          message: `${FIELD_LABELS[field]} يجب أن يتدرج من الأصغر إلى الأكبر`,
          row: index + 1,
          field,
        });
      }
      previous = current;
    });
  });

  return { data, issues, canPublish: !issues.some((issue) => issue.severity === 'error') };
}

function normalizedHeaders(row: unknown[]): string[] {
  return row.map((value, index) => {
    const header = text(value).toUpperCase().replace(/[\s-]+/g, '_');
    if (!header && index === 0) return 'SKU';
    if (header === 'SIZE') return 'Size';
    if (header === 'PRODUCT_ID') return 'SALLA_PRODUCT_ID';
    if (header === 'PRODUCT_NAME') return 'NAME';
    if (header === 'BLOUSE') return 'BLOUSE_LEN';
    if (header === 'SKIRT') return 'SKIRT_LEN';
    return header;
  });
}

export function parseSizeGuideImport(buffer: Buffer, fileName: string): SizeGuideImportResult {
  if (!buffer.length) throw new Error('ملف الاستيراد فارغ');
  if (buffer.length > SIZE_GUIDE_IMPORT_MAX_BYTES) throw new Error('حجم الملف يتجاوز 5 ميجابايت');

  const isWorkbook = /\.xlsx?$/i.test(fileName);
  const workbook = isWorkbook
    ? XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false })
    : XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: false, cellDates: false });
  const sheetName = isWorkbook
    ? workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'data')
    : workbook.SheetNames[0];
  if (!sheetName) throw new Error('ورقة data غير موجودة في ملف Excel');

  const sheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  if (allRows.length < 2) throw new Error('ورقة البيانات فارغة');

  const headers = normalizedHeaders(allRows[0]);
  const required = ['SKU', 'SALLA_PRODUCT_ID', 'Size'];
  required.forEach((field) => {
    if (!headers.includes(field)) throw new Error(`العمود ${field} غير موجود`);
  });
  SIZE_GUIDE_FIELDS.filter(
    (field) => !(OPTIONAL_SIZE_GUIDE_FIELDS as readonly string[]).includes(field)
  ).forEach((field) => {
    if (!headers.includes(field)) throw new Error(`العمود ${field} غير موجود`);
  });

  type Group = {
    sku: string;
    rawSkus: Set<string>;
    productId: string;
    rawProductIds: Set<string>;
    productName: string | null;
    rows: SizeGuideRow[];
    sourceRows: number[];
  };
  const groups = new Map<string, Group>();
  const skippedRows: Array<{ row: number; message: string }> = [];
  let populatedRows = 0;

  allRows.slice(1).forEach((values, offset) => {
    const excelRow = offset + 2;
    if (!values.some((value) => text(value))) return;
    populatedRows += 1;
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const sku = text(record.SKU);
    const skuKey = sizeGuideSkuKey(sku);
    if (!sku || !skuKey) {
      skippedRows.push({ row: excelRow, message: 'SKU مفقود' });
      return;
    }
    const productId = text(record.SALLA_PRODUCT_ID, 32);
    if (!/^\d+$/.test(productId)) {
      skippedRows.push({ row: excelRow, message: 'رقم منتج سلة مفقود أو غير صالح' });
      return;
    }

    const row = emptyRow();
    row.size = text(record.Size, 40);
    SIZE_GUIDE_FIELDS.forEach((field) => {
      row[field] = text(record[field], 120);
    });

    const group = groups.get(skuKey) || {
      sku,
      rawSkus: new Set<string>(),
      productId,
      rawProductIds: new Set<string>(),
      productName: optionalSizeGuideText(record.NAME, 250),
      rows: [],
      sourceRows: [],
    };
    group.rawSkus.add(sku);
    group.rawProductIds.add(productId);
    if (!group.productName) group.productName = optionalSizeGuideText(record.NAME, 250);
    group.rows.push(row);
    group.sourceRows.push(excelRow);
    groups.set(skuKey, group);
  });

  const guides = Array.from(groups.entries()).map(([skuKey, group]) => {
    const validated = validateSizeGuideDocument({ rows: group.rows });
    if (group.rawSkus.size > 1) {
      validated.issues.unshift({
        severity: 'error',
        code: 'sku_collision',
        message: `قيم SKU التالية تتطابق بعد إزالة الرموز: ${Array.from(group.rawSkus).join('، ')}`,
        field: 'SKU',
      });
      validated.canPublish = false;
    }
    if (group.rawProductIds.size > 1) {
      validated.issues.unshift({
        severity: 'error',
        code: 'product_id_collision',
        message: `SKU مرتبط بأكثر من رقم منتج سلة: ${Array.from(group.rawProductIds).join('، ')}`,
        field: 'SKU',
      });
      validated.canPublish = false;
    }
    return {
      ...validated,
      sku: group.sku,
      skuKey,
      productId: group.productId,
      productName: group.productName,
      sourceRows: group.sourceRows,
    };
  });

  const warnings = guides.reduce(
    (total, guide) => total + guide.issues.filter((issue) => issue.severity === 'warning').length,
    0
  );
  const publishable = guides.filter((guide) => guide.canPublish).length;

  return {
    sheetName,
    populatedRows,
    skippedRows,
    guides,
    summary: {
      populatedRows,
      guides: guides.length,
      publishable,
      blocked: guides.length - publishable,
      warnings,
      skippedRows: skippedRows.length,
    },
  };
}

export function sizeGuideAudit(user: unknown) {
  const value = user && typeof user === 'object' ? (user as Record<string, unknown>) : {};
  return {
    id: typeof value.id === 'string' ? value.id : null,
    name: typeof value.name === 'string' ? value.name : null,
    username: typeof value.username === 'string' ? value.username : null,
  };
}

export function parseSizeGuideSku(value: unknown): { sku: string; skuKey: string } {
  const sku = text(value, 120);
  const skuKey = sizeGuideSkuKey(sku);
  if (!sku || skuKey.length < 1) throw new Error('SKU مطلوب');
  return { sku, skuKey };
}

export function optionalSizeGuideText(value: unknown, maxLength: number): string | null {
  const result = text(value, maxLength);
  return result || null;
}

type ExportableSizeGuide = {
  sku: string;
  productId?: string | null;
  productName?: string | null;
  draftData: unknown;
  publishedAt?: Date | string | null;
  updatedAt: Date | string;
};

function csvCell(value: unknown): string {
  const raw = value == null ? '' : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function serializeSizeGuidesCsv(guides: ExportableSizeGuide[]): string {
  const headers = [
    'sku', 'salla_product_id', 'name', 'size',
    'chest', 'waist', 'hip', 'shoulder', 'length', 'sleeve', 'blouse', 'skirt',
    'status', 'updated',
  ];
  const lines = [headers.join(',')];

  guides.forEach((guide) => {
    const document = parseSizeGuideDocument(guide.draftData);
    document.rows.forEach((row) => {
      const updated = guide.updatedAt instanceof Date
        ? guide.updatedAt.toISOString()
        : new Date(guide.updatedAt).toISOString();
      lines.push([
        guide.sku,
        guide.productId || '',
        guide.productName || '',
        row.size,
        row.CHEST,
        row.WAIST,
        row.HIP,
        row.SHOULDER,
        row.LENGTH,
        row.SLEEVE,
        row.BLOUSE_LEN,
        row.SKIRT_LEN,
        guide.publishedAt ? 'published' : 'draft',
        updated,
      ].map(csvCell).join(','));
    });
  });

  return `\uFEFF${lines.join('\r\n')}`;
}
