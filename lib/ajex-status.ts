import type { AjexLiveStatus } from '@/types/ajex';

/**
 * AJEX callback status codes (API v1.7 section 9) mapped to the same
 * short Arabic labels the warehouse uses for SMSA scans.
 */
const AJEX_STATUS_LABELS: Record<number, string> = {
  100: 'تم إنشاء الشحنة',
  102: 'ملغية',
  112: 'تم التواصل مع العميل',
  113: 'بانتظار تأكيد العنوان',
  114: 'تم تأكيد العنوان',
  200: 'بانتظار الاستلام',
  201: 'تم استلام الشحنة',
  204: 'تعذر الاستلام',
  210: 'تم استلام الشحنة',
  300: 'قيد النقل',
  301: 'قيد النقل',
  302: 'وصلت مركز الوجهة',
  304: 'قيد النقل',
  305: 'مرتجعة لمركز الوجهة',
  602: 'خارج للتسليم',
  604: 'تم التسليم',
  606: 'تعذر التسليم',
  608: 'جاري الإرجاع للمرسل',
  609: 'تم الإرجاع للمرسل',
  802: 'معلقة',
};

const DELIVERED_CODES = new Set([604]);

export const resolveAjexStatusLabel = (code: number | null): string | null => {
  if (code === null || !Number.isFinite(code)) {
    return null;
  }
  return AJEX_STATUS_LABELS[code] ?? null;
};

export const isAjexDeliveredCode = (code: number | null): boolean =>
  code !== null && DELIVERED_CODES.has(code);

export const resolveMajorAjexStatus = (tracking: AjexLiveStatus | null | undefined): string | null => {
  if (!tracking) {
    return null;
  }

  const code = Number.parseInt(tracking.code ?? '', 10);
  const label = resolveAjexStatusLabel(Number.isNaN(code) ? null : code);
  if (label) {
    return label;
  }

  if (tracking.delivered) {
    return 'تم التسليم';
  }

  return tracking.description?.trim() || null;
};
