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

export const SIZE_GUIDE_FIT_FIELDS = ['CHEST', 'WAIST'] as const;

export type SizeGuideField = (typeof SIZE_GUIDE_FIELDS)[number];
export type SizeGuideFitField = (typeof SIZE_GUIDE_FIT_FIELDS)[number];

export type SizeGuideRow = {
  size: string;
} & Record<SizeGuideField, string>;

export type SizeGuideDocument = {
  unit: 'in';
  twoPiece: boolean;
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

export function sizeGuideSkuCandidates(value: unknown): string[] {
  const raw = text(value);
  const candidates: string[] = [];
  const add = (candidate: unknown) => {
    const key = sizeGuideSkuKey(candidate);
    if (key.length >= 3 && !candidates.includes(key)) candidates.push(key);
  };

  add(raw);
  raw.split(/[-/_\s]+/).forEach(add);
  (raw.match(/\d{3,12}/g) || []).forEach(add);
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
    row.size = text(source.size ?? source.Size, 40);
    SIZE_GUIDE_FIELDS.forEach((field) => {
      row[field] = text(source[field], 120);
    });
    return row;
  });

  return {
    unit: 'in',
    twoPiece: rows.some((row) => Boolean(row.BLOUSE_LEN || row.SKIRT_LEN)),
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

    SIZE_GUIDE_FIELDS.forEach((field) => {
      if (row[field] && numericMeasurement(row[field]) == null) {
        issues.push({
          severity: 'warning',
          code: 'display_only_measurement',
          message: `${FIELD_LABELS[field]} في مقاس ${row.size || rowNumber} سيظهر كنص ولن يدخل في الحساب`,
          row: rowNumber,
          field,
        });
      }
    });
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
    const header = text(value).toUpperCase();
    if (!header && index === 0) return 'SKU';
    if (header === 'SIZE') return 'Size';
    return header;
  });
}

export function parseSizeGuideImport(buffer: Buffer, fileName: string): SizeGuideImportResult {
  if (!buffer.length) throw new Error('ملف الاستيراد فارغ');
  if (buffer.length > SIZE_GUIDE_IMPORT_MAX_BYTES) throw new Error('حجم الملف يتجاوز 5 ميجابايت');

  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  const isWorkbook = /\.xlsx?$/i.test(fileName);
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
  const required = ['SKU', 'Size'];
  required.forEach((field) => {
    if (!headers.includes(field)) throw new Error(`العمود ${field} غير موجود`);
  });
  SIZE_GUIDE_FIELDS.forEach((field) => {
    if (!headers.includes(field)) throw new Error(`العمود ${field} غير موجود`);
  });

  type Group = { sku: string; rawSkus: Set<string>; rows: SizeGuideRow[]; sourceRows: number[] };
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

    const row = emptyRow();
    row.size = text(record.Size, 40);
    SIZE_GUIDE_FIELDS.forEach((field) => {
      row[field] = text(record[field], 120);
    });

    const group = groups.get(skuKey) || {
      sku,
      rawSkus: new Set<string>(),
      rows: [],
      sourceRows: [],
    };
    group.rawSkus.add(sku);
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
    return { ...validated, sku: group.sku, skuKey, sourceRows: group.sourceRows };
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
