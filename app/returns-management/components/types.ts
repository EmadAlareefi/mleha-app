import type { ReturnItemCondition } from '@/app/lib/returns/inspection';
import type { LocalTrackingShipment } from '@/app/lib/local-shipping/tracking-query';
import type { ReturnStage } from '@/lib/returns/workflow';
import type { SmsaLiveStatus } from '@/types/smsa';

export interface ReturnItem {
  id: string;
  productName: string;
  productSku?: string | null;
  variantName?: string | null;
  quantity: number;
  price: number | string;
  orderItemId?: string | null;
  unitIndex?: number | null;
  type?: 'return' | 'exchange' | string;
  refundIncluded?: boolean;
  restockStatus?: 'none' | 'requested' | 'done' | 'skipped' | 'failed' | string;
  conditionStatus?: ReturnItemCondition | null;
  conditionNotes?: string | null;
  damageImageData?: string | null;
  preInspectionNotes?: string | null;
  inspectedBy?: string | null;
  inspectedAt?: string | null;
}

export interface AuditEntry {
  at: string;
  step: string;
  result: 'ok' | 'skipped' | 'failed' | 'unknown' | 'info';
  by?: string;
  details?: Record<string, unknown>;
}

export interface ReturnRequest {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string;
  type: 'return' | 'exchange' | 'mixed' | string;
  status: string;
  stage: ReturnStage;
  reason: string;
  reasonDetails?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  smsaResponse?: { provider?: string; labelUrl?: string | null } | null;
  smsaTrackingNumber?: string | null;
  smsaAwbNumber?: string | null;
  smsaLiveStatus?: SmsaLiveStatus | null;
  smsaLiveStatusUpdatedAt?: string | null;
  returnLabelUrl?: string | null;
  returnLabelNotificationSentAt?: string | null;
  returnLabelNotificationError?: string | null;
  needsManualShipment?: boolean;
  totalRefundAmount?: number | string | null;
  couponAmount?: number | string | null;
  returnFee?: number | string | null;
  shippingAmount?: number | string | null;
  currency?: string | null;
  couponCode?: string | null;
  couponId?: string | null;
  couponAmountOverride?: number | string | null;
  couponAmountOverrideBy?: string | null;
  couponAmountOverrideAt?: string | null;
  couponAmountOverrideNote?: string | null;
  refundStatus?: string;
  refundedAmount?: number | string | null;
  refundedAt?: string | null;
  refundError?: string | null;
  processingStatus?: string;
  processingError?: string | null;
  processingAudit?: AuditEntry[] | null;
  processedBy?: string | null;
  processedAt?: string | null;
  receivedAt?: string | null;
  exchangeMode?: 'coupon' | 'order' | string;
  exchangeCreditAmount?: number | string | null;
  exchangeOrderId?: string | null;
  exchangeOrderNumber?: string | null;
  exchangeOrderTotal?: number | string | null;
  exchangeCreditApplied?: number | string | null;
  exchangeAmountDue?: number | string | null;
  exchangePaymentMethod?: string | null;
  exchangePaymentStatus?: string;
  exchangeCheckoutUrl?: string | null;
  exchangePaymentDueAt?: string | null;
  exchangeOrderHoldActive?: boolean;
  exchangeOrderReleasedAt?: string | null;
  exchangeOrderError?: string | null;
  leftoverCouponCode?: string | null;
  leftoverCouponAmount?: number | string | null;
  exchangeLines?: Array<{
    id: string;
    name: string;
    variantName?: string | null;
    imageUrl?: string | null;
    quantity: number;
    unitPrice: number | string;
  }>;
  adminNotes?: string | null;
  createdAt: string;
  items: ReturnItem[];
  sallaStatus?: { name?: string; slug?: string } | null;
  localShipments?: LocalTrackingShipment[];
}

export interface ProcessPreview {
  requestId: string;
  stage: 'ready' | 'not_ready' | 'closed';
  notReadyReason?: string;
  amounts: {
    requestType: string;
    refundAmount: number;
    couponAmount: number;
    couponSource: 'calculated' | 'override';
    processingFee: number;
    originalShipping: number;
    currency: string;
  };
  refund: {
    amount: number;
    currency: string;
    transactionId?: string;
    transactionTotal?: number;
    paymentMethod?: string;
    unavailableReason?: string;
    existingRefunds: Array<{ amount: number | null; note: string; at?: string; by?: string }>;
  } | null;
  restock: Array<{ itemId: string; productName: string; variantName?: string | null; quantity: number; action: 'restock' | 'skip' | 'done' | 'unknown'; reason?: string }>;
  coupon: { amount: number; existingCode?: string | null } | null;
  exchangeOrder: { orderNumber: string | null; paymentStatus: string; amountDue: number; held: boolean; leftover: number } | null;
  warnings: string[];
}

export const toNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatMoney = (value: number | string | null | undefined, currency?: string | null) => {
  const amount = toNumber(value) ?? 0;
  const normalized = currency?.trim().toUpperCase() || 'SAR';
  return `${amount.toFixed(2)} ${normalized === 'SAR' ? 'ر.س' : normalized}`;
};

const dateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormatter.format(date);
};

export const daysSince = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
};

/** "piece 2 of 3" for v2 rows; legacy rows show their quantity instead. */
export const pieceLabel = (item: ReturnItem, items: ReturnItem[]) => {
  if (item.orderItemId && Number.isInteger(item.unitIndex)) {
    const lineCount = items.filter((other) => other.orderItemId === item.orderItemId).length;
    return lineCount > 1 ? `قطعة ${(item.unitIndex ?? 0) + 1}` : '';
  }
  return item.quantity > 1 ? `× ${item.quantity}` : '';
};

export const REFUND_STATUS_LABELS: Record<string, string> = {
  none: 'لم يُسترجع',
  requested: 'جاري الاسترجاع',
  refunded: 'تم الاسترجاع',
  failed: 'فشل الاسترجاع',
  unknown: 'نتيجة غير معروفة',
  manual: 'استرجاع يدوي مطلوب',
};

export const RESTOCK_LABELS: Record<string, string> = {
  none: '—',
  done: 'أعيدت للمخزون',
  skipped: 'لم تُعد للمخزون',
  failed: 'فشل الإرجاع للمخزون',
  requested: 'غير مؤكد، تحقق في سلة',
};

export const AUDIT_STEP_LABELS: Record<string, string> = {
  restock: 'المخزون',
  refund: 'الاسترجاع المالي',
  coupon: 'كوبون الاستبدال',
  exchange_order: 'طلب الاستبدال',
  salla_status: 'حالة الطلب في سلة',
  salla_history: 'سجل الطلب في سلة',
  complete: 'إغلاق الطلب',
  error: 'خطأ',
};

export const EXCHANGE_PAYMENT_LABELS: Record<string, string> = {
  none: '—',
  pending: 'بانتظار دفع العميل',
  paid: 'تم الدفع',
  not_required: 'مغطى بالرصيد',
  expired: 'انتهت مهلة الدفع',
  cancelled: 'أُلغي',
  failed: 'تعذر الإنشاء',
  creating: 'قيد الإنشاء',
  expiring: 'جاري الإلغاء لانتهاء المهلة',
};
