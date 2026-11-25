import { categories, ExpenseError } from './domain';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const RIYADH = '+03:00';

/**
 * `from` / `to` filter on expenseDate. A bare `YYYY-MM-DD` covers that whole
 * day in Riyadh time (both ends inclusive); a full ISO timestamp is used as-is.
 */
export function parseDateRange(from: string | null, to: string | null) {
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = parseBound(from, 'start');
  if (to) range.lte = parseBound(to, 'end');
  if (range.gte && range.lte && range.gte > range.lte) throw new ExpenseError('from يجب أن يكون قبل to', 400);
  return range.gte || range.lte ? range : undefined;
}

function parseBound(value: string, edge: 'start' | 'end') {
  const trimmed = value.trim();
  const date = DATE_ONLY.test(trimmed)
    ? new Date(`${trimmed}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}${RIYADH}`)
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new ExpenseError(`تاريخ غير صالح: ${trimmed.slice(0, 40)}`, 400);
  return date;
}

const MAX_AMOUNT = 99_999_999.99; // Decimal(10, 2)

/** Validates a POST body from the API-key integration. Status/approval fields are never read. */
export function parseExternalExpense(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ExpenseError('الطلب يجب أن يكون JSON object', 400);
  const b = body as Record<string, unknown>;

  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const category = typeof b.category === 'string' ? b.category.trim() : '';
  const amount = typeof b.amount === 'number' ? b.amount : typeof b.amount === 'string' ? Number(b.amount) : NaN;
  if (!title || !category || !Number.isFinite(amount)) throw new ExpenseError('العنوان والمبلغ والفئة مطلوبة', 400);
  if (title.length > 300) throw new ExpenseError('العنوان أطول من المسموح', 400);
  if (!(categories as readonly string[]).includes(category)) throw new ExpenseError(`الفئة غير معروفة؛ المسموح: ${categories.join(', ')}`, 400);
  if (amount <= 0 || amount > MAX_AMOUNT) throw new ExpenseError('المبلغ يجب أن يكون أكبر من صفر وضمن الحد المسموح', 400);

  const currency = b.currency == null ? 'SAR' : typeof b.currency === 'string' && /^[A-Za-z]{3}$/.test(b.currency.trim()) ? b.currency.trim().toUpperCase() : null;
  if (!currency) throw new ExpenseError('رمز العملة غير صالح', 400);

  let expenseDate = new Date();
  if (b.expenseDate != null) {
    if (typeof b.expenseDate !== 'string') throw new ExpenseError('expenseDate غير صالح', 400);
    expenseDate = parseBound(b.expenseDate, 'start');
  }

  let externalId: string | undefined;
  if (b.externalId != null) {
    if (typeof b.externalId !== 'string' || !b.externalId.trim() || b.externalId.trim().length > 200) throw new ExpenseError('externalId يجب أن يكون نصاً حتى 200 حرف', 400);
    externalId = b.externalId.trim();
  }

  const optionalText = (key: string) => {
    const value = b[key];
    if (value == null) return undefined;
    if (typeof value !== 'string') throw new ExpenseError(`${key} يجب أن يكون نصاً`, 400);
    return value.trim() || undefined;
  };

  return {
    merchantId: optionalText('merchantId') || 'default',
    title,
    description: optionalText('description'),
    amount: Math.round(amount * 100) / 100,
    currency,
    category,
    expenseDate,
    notes: optionalText('notes'),
    externalId,
  };
}
