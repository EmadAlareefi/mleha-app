import { normalizeE164Phone } from '@/app/lib/phone';

export const MARKETING_SERVICE_KEY = 'marketing-campaigns' as const;
export const MARKETING_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const MARKETING_IMPORT_MAX_ROWS = 5_000;
export const MARKETING_CAMPAIGN_MAX_RECIPIENTS = 5_000;
export const MARKETING_SEND_BATCH_SIZE = 10;

export type MarketingConsentStatus = 'unknown' | 'opted_in' | 'opted_out';

export type ImportedMarketingCustomer = {
  name: string | null;
  phone: string;
  email: string | null;
  consentStatus: MarketingConsentStatus;
  row: number;
};

export type MarketingImportResult = {
  customers: ImportedMarketingCustomer[];
  errors: Array<{ row: number; message: string }>;
  duplicatePhones: number;
};

function normalizeNumerals(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

export function parseConsentStatus(value: unknown): MarketingConsentStatus {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['opted_in', 'optin', 'yes', 'true', '1', 'موافق', 'مشترك'].includes(normalized)) {
    return 'opted_in';
  }
  if (['opted_out', 'optout', 'no', 'false', '0', 'غير_موافق', 'ملغي'].includes(normalized)) {
    return 'opted_out';
  }
  return 'unknown';
}

export function extractClaimedAudienceSize(description: string): number | null {
  const text = normalizeNumerals(description);
  const match = text.match(/(?:ضمن|among)\s+(?:أول\s+|only\s+)?(\d{1,6})\s+(?:عميلة|عميل|customer)/iu);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  return [',', ';', '\t'].sort((a, b) => countDelimiter(firstLine, b) - countDelimiter(firstLine, a))[0];
}

export function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/[أإآ]/g, 'ا');
}

const headerAliases = {
  name: new Set(['name', 'fullname', 'customername', 'الاسم', 'اسمالعميل', 'اسمالعميلة']),
  phone: new Set(['phone', 'mobile', 'whatsapp', 'phonenumber', 'الجوال', 'رقمالجوال', 'الهاتف', 'رقمالهاتف']),
  email: new Set(['email', 'customeremail', 'البريد', 'البريدالالكتروني']),
  consent: new Set(['consent', 'consentstatus', 'marketingconsent', 'optin', 'الموافقة', 'حالةالموافقة']),
};

function findHeader(headers: string[], aliases: Set<string>) {
  return headers.findIndex((header) => aliases.has(normalizeHeader(header)));
}

export function parseMarketingCustomerCsv(
  text: string,
  defaultConsent: MarketingConsentStatus = 'unknown'
): MarketingImportResult {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('ملف CSV لا يحتوي على بيانات عملاء');
  if (rows.length - 1 > MARKETING_IMPORT_MAX_ROWS) {
    throw new Error(`الحد الأعلى للاستيراد هو ${MARKETING_IMPORT_MAX_ROWS} عميل في الملف الواحد`);
  }

  const headers = rows[0];
  const nameIndex = findHeader(headers, headerAliases.name);
  const phoneIndex = findHeader(headers, headerAliases.phone);
  const emailIndex = findHeader(headers, headerAliases.email);
  const consentIndex = findHeader(headers, headerAliases.consent);
  if (phoneIndex < 0) throw new Error('يجب أن يحتوي الملف على عمود phone أو mobile أو رقم الجوال');

  const customers: ImportedMarketingCustomer[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  const seen = new Set<string>();
  let duplicatePhones = 0;

  rows.slice(1).forEach((values, offset) => {
    const rowNumber = offset + 2;
    const phone = normalizeE164Phone(values[phoneIndex]);
    if (!phone) {
      errors.push({ row: rowNumber, message: 'رقم الجوال غير صالح أو لا يحتوي على رمز دولة' });
      return;
    }
    if (seen.has(phone)) {
      duplicatePhones += 1;
      return;
    }
    seen.add(phone);
    const rowConsent = consentIndex >= 0 ? parseConsentStatus(values[consentIndex]) : defaultConsent;
    customers.push({
      name: nameIndex >= 0 ? values[nameIndex]?.trim().slice(0, 160) || null : null,
      phone,
      email: emailIndex >= 0 ? values[emailIndex]?.trim().toLowerCase().slice(0, 320) || null : null,
      consentStatus: rowConsent,
      row: rowNumber,
    });
  });

  return { customers, errors, duplicatePhones };
}

export function providerMessageId(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const value = response as Record<string, any>;
  const candidate = value.messageId ?? value.id ?? value.data?.messageId ?? value.data?.id;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}
