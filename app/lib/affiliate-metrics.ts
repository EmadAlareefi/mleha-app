import { Prisma } from '@prisma/client';

export const AFFILIATE_TAX_RATE = 0.15;
export const AFFILIATE_RATE_CHANGE_DATE = new Date('2026-07-24T21:00:00.000Z');
export const AFFILIATE_RATE_AFTER_CHANGE = 5;
// November 3–7, 2026 inclusive in Asia/Riyadh (UTC+03:00).
const AFFILIATE_COMMISSION_PAUSE_START = new Date('2026-11-03T00:00:00+03:00');
const AFFILIATE_COMMISSION_PAUSE_END = new Date('2026-11-08T00:00:00+03:00');
export const NATIONAL_DAY_OFFERS_CATEGORY = 'عروض اليوم الوطني';

export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  return Number(value);
}

export function calculateNetAmount(
  totalAmount: Prisma.Decimal | number | null,
  shippingAmount: Prisma.Decimal | number | null
): number {
  const total = decimalToNumber(totalAmount);
  const shipping = decimalToNumber(shippingAmount);
  const taxableBase = Math.max(total - shipping, 0);
  const tax = taxableBase * AFFILIATE_TAX_RATE;
  const netAmount = Math.max(taxableBase - tax, 0);
  return netAmount;
}

export function getAffiliateCommissionRate(
  placedAt: Date | null | undefined,
  storedRate: Prisma.Decimal | number | null | undefined,
  fallbackRate = 10
): number {
  if (
    placedAt &&
    placedAt >= AFFILIATE_COMMISSION_PAUSE_START &&
    placedAt < AFFILIATE_COMMISSION_PAUSE_END
  ) {
    return 0;
  }
  if (placedAt && placedAt >= AFFILIATE_RATE_CHANGE_DATE) {
    return AFFILIATE_RATE_AFTER_CHANGE;
  }
  return storedRate === null || storedRate === undefined ? fallbackRate : Number(storedRate);
}

export function isNationalDayOffersCategory(categoryName: string): boolean {
  return categoryName.trim().replace(/\s+/g, ' ') === NATIONAL_DAY_OFFERS_CATEGORY;
}

export function calculateCommissionableNetAmount(
  totalAmount: Prisma.Decimal | number | null,
  shippingAmount: Prisma.Decimal | number | null,
  excludedItemsAmount: Prisma.Decimal | number | null | undefined
): number {
  const total = decimalToNumber(totalAmount);
  const shipping = decimalToNumber(shippingAmount);
  const taxableBase = Math.max(total - shipping, 0);
  const excluded = Math.min(Math.max(decimalToNumber(excludedItemsAmount), 0), taxableBase);
  return Math.max(taxableBase - excluded, 0) * (1 - AFFILIATE_TAX_RATE);
}

export function isDelivered(statusSlug: string | null | undefined, statusName: string | null | undefined): boolean {
  const normalizedSlug = statusSlug?.toLowerCase();
  if (normalizedSlug === 'delivered') {
    return true;
  }
  const normalizedName = statusName?.trim();
  return normalizedName === 'تم التوصيل';
}

const RIYADH_MONTH_OFFSET_MS = 3 * 60 * 60 * 1000;

export function getMonthKey(date: Date | null | undefined): string | null {
  if (!date) {
    return null;
  }
  // Month of the Riyadh calendar date (placedAt is a real UTC instant).
  const riyadh = new Date(date.getTime() + RIYADH_MONTH_OFFSET_MS);
  const year = riyadh.getUTCFullYear();
  const month = String(riyadh.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getMonthLabel(date: Date | null | undefined): string {
  if (!date) {
    return 'غير معروف';
  }
  const monthFormatter = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Riyadh',
  });
  return monthFormatter.format(date);
}
