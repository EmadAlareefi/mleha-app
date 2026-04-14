import { Prisma } from '@prisma/client';

export const AFFILIATE_TAX_RATE = 0.15;

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
  const monthFormatter = new Intl.DateTimeFormat('ar', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return monthFormatter.format(date);
}
