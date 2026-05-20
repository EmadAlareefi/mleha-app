export const ERP_SUPPORTED_CURRENCY = 'SAR';

export function normalizeERPCurrency(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
}

export function isSupportedERPCurrency(value: unknown): boolean {
  return normalizeERPCurrency(value) === ERP_SUPPORTED_CURRENCY;
}

export function buildUnsupportedERPCurrencyMessage(value: unknown): string {
  const normalized = normalizeERPCurrency(value);

  if (!normalized) {
    return `لا يمكن إنشاء فاتورة أو مرتجع ERP لأن العملة غير محددة. فقط العملة ${ERP_SUPPORTED_CURRENCY} مدعومة.`;
  }

  return `لا يمكن إنشاء فاتورة أو مرتجع ERP لطلب بعملة ${normalized}. فقط العملة ${ERP_SUPPORTED_CURRENCY} مدعومة.`;
}
