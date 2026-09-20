import { STATUS_IDS, SUB_STATUSES } from '@/SALLA_ORDER_STATUSES';

export type OrderPrepTargetStatus = 'preparing' | 'waiting' | 'completed';

export const INTERNATIONAL_IN_PROGRESS = SUB_STATUSES.IN_PROGRESS_INTERNATIONAL;

/**
 * Salla status an order prep transition maps to. International orders are moved
 * to the "جاري التجهيز الدولي" sub-status instead of the regular "جاري التجهيز".
 */
export function resolveOrderPrepSallaStatusId(
  status: OrderPrepTargetStatus,
  isInternational = false,
): number | null {
  const inProgressId = isInternational
    ? INTERNATIONAL_IN_PROGRESS.id
    : STATUS_IDS.IN_PROGRESS;

  switch (status) {
    case 'preparing':
      return inProgressId ?? null;
    case 'waiting':
      return STATUS_IDS.UNDER_REVIEW ?? null;
    case 'completed':
      return inProgressId ?? null;
    default:
      return null;
  }
}

export function resolveOrderPrepStatusName(
  status: OrderPrepTargetStatus,
  isInternational = false,
): string | null {
  switch (status) {
    case 'preparing':
      return isInternational ? INTERNATIONAL_IN_PROGRESS.name : 'جاري التجهيز';
    case 'waiting':
      return 'قيد الانتظار';
    case 'completed':
      return 'تم التنفيذ';
    default:
      return null;
  }
}
