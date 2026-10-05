export const categories = ['shipping', 'packaging', 'marketing', 'operations', 'partner-current', 'salaries', 'utilities', 'rent', 'maintenance', 'other'] as const;
export const providers = ['meta', 'tiktok', 'snapchat'] as const;
export type Provider = typeof providers[number];
export type Frequency = 'monthly' | 'yearly';

export class ExpenseError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ExpenseError(`${name}: قيمة غير صالحة`);
  return value.trim();
}
export function dateOnly(value: unknown): string {
  const date = text(value, 'التاريخ', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new ExpenseError('التاريخ غير صالح');
  return date;
}
export function today(now = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function expenseInstant(date: string): Date { return new Date(`${dateOnly(date)}T00:00:00+03:00`); }
export function money(value: unknown, allowNegative = false): string {
  const raw = String(value);
  if (!/^-?\d{1,8}(\.\d{1,2})?$/.test(raw) || !Number.isFinite(Number(raw)) || (!allowNegative && Number(raw) <= 0)) throw new ExpenseError('المبلغ غير صالح؛ استخدم منزلتين عشريتين كحد أقصى');
  return Number(raw).toFixed(2);
}
export function currency(value: unknown): string {
  const code = text(value, 'العملة', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new ExpenseError('العملة غير صالحة');
  return code;
}
export function provider(value: unknown): Provider {
  if (!providers.includes(value as Provider)) throw new ExpenseError('المنصة غير صالحة');
  return value as Provider;
}
export function subscriptionInput(body: Record<string, unknown>) {
  const frequency = body.frequency;
  if (frequency !== 'monthly' && frequency !== 'yearly') throw new ExpenseError('التكرار غير صالح');
  const category = text(body.category, 'الفئة');
  if (!(categories as readonly string[]).includes(category)) throw new ExpenseError('الفئة غير صالحة');
  const startDate = dateOnly(body.startDate);
  const endDate = body.endDate ? dateOnly(body.endDate) : null;
  if (endDate && endDate < startDate) throw new ExpenseError('تاريخ النهاية يسبق البداية');
  return { title: text(body.title, 'العنوان'), amount: money(body.amount), currency: currency(body.currency || 'SAR'), category, frequency, startDate, endDate, notes: body.notes ? text(body.notes, 'الملاحظات', 4000) : null };
}
// Always calculate from the original anchor, never from a clamped February date.
export function nextOccurrence(start: string, frequency: string, after: string, inclusive = false): string {
  const [year, month, day] = dateOnly(start).split('-').map(Number);
  dateOnly(after);
  const [ay, am] = after.split('-').map(Number);
  const step = frequency === 'yearly' ? 12 : 1;
  let offset = Math.max(0, Math.floor(((ay - year) * 12 + am - month) / step) * step);
  for (;;) {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, lastDay));
    const result = first.toISOString().slice(0, 10);
    if (result > after || (inclusive && result === after)) return result;
    offset += step;
  }
}
export function withinCutoff(issueDate: string, importFrom: string) { return dateOnly(issueDate) >= dateOnly(importFrom); }
export function validatePdf(bytes: Uint8Array): Buffer {
  const buffer = Buffer.from(bytes);
  if (buffer.length > 5 * 1024 * 1024 || buffer.length < 5 || buffer.subarray(0, 5).toString() !== '%PDF-') throw new ExpenseError('يلزم ملف PDF صالح بحجم لا يتجاوز 5 ميجابايت');
  return buffer;
}
