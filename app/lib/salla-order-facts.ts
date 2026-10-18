import { Prisma } from '@prisma/client';

/**
 * Small facts derived from a Salla order payload when the order is written,
 * so reporting can read plain columns instead of de-TOASTing `rawOrder` for
 * every row (a 92-day report otherwise spends seconds decompressing JSON).
 *
 * The rules must stay identical to the SQL fallback in
 * `app/lib/hermes/store-prisma.ts` (REPORT_COLUMNS), which is used for rows
 * written before these columns existed.
 */

type AnyRecord = Record<string, unknown>;

const NUMERIC_STRING = /^-?[0-9]+([.][0-9]+)?$/;

const asRecord = (value: unknown): AnyRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;

/** Salla reports `amounts.discounts[].discount` as a decimal string. */
function discountAmount(entry: unknown): Prisma.Decimal {
  const raw = asRecord(entry)?.discount;
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  return NUMERIC_STRING.test(text) ? new Prisma.Decimal(text) : new Prisma.Decimal(0);
}

/** `refunded_items[].amounts.total.amount` is a JSON number. */
function refundedItemAmount(entry: unknown): Prisma.Decimal {
  const amount = asRecord(asRecord(asRecord(entry)?.amounts)?.total)?.amount;
  return typeof amount === 'number' && Number.isFinite(amount)
    ? new Prisma.Decimal(amount)
    : new Prisma.Decimal(0);
}

export interface SallaOrderFacts {
  discountTotal: Prisma.Decimal;
  refundedItemsTotal: Prisma.Decimal;
  refundedItemsCount: number;
  isPendingPayment: boolean | null;
  exchangeRate: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export function extractSallaOrderFacts(order: unknown): SallaOrderFacts {
  const record = asRecord(order) ?? {};
  const discounts = asRecord(record.amounts)?.discounts;
  const refunded = record.refunded_items;
  const exchangeRate = asRecord(record.exchange_rate);

  return {
    discountTotal: (Array.isArray(discounts) ? discounts : []).reduce<Prisma.Decimal>(
      (total, entry) => total.plus(discountAmount(entry)),
      new Prisma.Decimal(0)
    ),
    refundedItemsTotal: (Array.isArray(refunded) ? refunded : []).reduce<Prisma.Decimal>(
      (total, entry) => total.plus(refundedItemAmount(entry)),
      new Prisma.Decimal(0)
    ),
    refundedItemsCount: Array.isArray(refunded) ? refunded.length : 0,
    isPendingPayment: typeof record.is_pending_payment === 'boolean' ? record.is_pending_payment : null,
    exchangeRate: exchangeRate ? (exchangeRate as Prisma.InputJsonValue) : Prisma.JsonNull,
  };
}

/** Column values for SallaOrder create/update. */
export function sallaOrderFactsData(order: unknown, computedAt: Date = new Date()) {
  return { ...extractSallaOrderFacts(order), factsComputedAt: computedAt };
}
