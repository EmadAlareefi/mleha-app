import { Prisma } from '@prisma/client';

export const AFFILIATE_TAX_RATE = 0.15;
export const AFFILIATE_RATE_CHANGE_DATE = new Date('2026-07-24T21:00:00.000Z');
export const AFFILIATE_RATE_AFTER_CHANGE = 5;
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

export function getMonthKey(date: Date | null | undefined): string | null {
  if (!date) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getMonthLabel(date: Date | null | undefined): string {
  if (!date) {
    return 'غير معروف';
  }
  const monthFormatter = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return monthFormatter.format(date);
}
