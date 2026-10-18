import type { AjexLiveStatus } from '@/types/ajex';
import type { SmsaLiveStatus } from '@/types/smsa';
import { resolveAjexStatusLabel } from '@/lib/ajex-status';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import { getStatusName } from '@/app/lib/salla-statuses';

/**
 * Stable, machine-readable statuses for the Hermes API, each with an Arabic
 * label. Order statuses come from Salla's slugs (see SALLA_ORDER_STATUSES.ts);
 * carrier statuses reuse the SMSA/AJEX classifications the warehouse uses.
 */

type Labelled<T extends string> = { code: T; label_ar: string };

// ---------------------------------------------------------------- order stage

export type OrderStage =
  | 'awaiting_payment'
  | 'new'
  | 'processing'
  | 'ready_to_ship'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'return_in_progress'
  | 'returned'
  | 'deleted'
  | 'other';

const STAGE_BY_SLUG: Record<string, OrderStage> = {
  payment_pending: 'awaiting_payment',
  under_review: 'new',
  in_progress: 'processing',
  processing: 'processing',
  completed: 'ready_to_ship',
  ready_for_pickup: 'ready_to_ship',
  shipped: 'shipped',
  delivering: 'out_for_delivery',
  delivered: 'delivered',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  restoring: 'return_in_progress',
  restored: 'returned',
  deleted: 'deleted',
  'محذوف': 'deleted',
};

const STAGE_LABELS: Record<OrderStage, string> = {
  awaiting_payment: 'بانتظار الدفع',
  new: 'طلب جديد',
  processing: 'قيد التنفيذ',
  ready_to_ship: 'تم التنفيذ - جاهز للشحن',
  shipped: 'تم الشحن',
  out_for_delivery: 'جاري التوصيل',
  delivered: 'تم التوصيل',
  cancelled: 'ملغي',
  return_in_progress: 'قيد الاسترجاع',
  returned: 'مسترجع',
  deleted: 'محذوف',
  other: 'أخرى',
};

export function orderStage(statusSlug: string | null | undefined): OrderStage {
  const slug = statusSlug?.trim().toLowerCase() ?? '';
  return STAGE_BY_SLUG[slug] ?? 'other';
}

export function orderStageLabel(stage: OrderStage): string {
  return STAGE_LABELS[stage];
}

/** Order status as shown to staff: Salla's own (possibly customised) Arabic name. */
export function presentOrderStatus(statusSlug: string | null, statusName: string | null) {
  const stage = orderStage(statusSlug);
  return {
    code: stage,
    label_ar: STAGE_LABELS[stage],
    salla_status: statusSlug,
    salla_label: statusName?.trim() || (statusSlug ? getStatusName([], statusSlug) : null),
  };
}

/** Stages in which nothing has left the warehouse yet. */
export const OPEN_STAGES: readonly OrderStage[] = ['new', 'processing', 'ready_to_ship'];
/** Stages that are not sales (excluded from revenue and order counts). */
export const NON_SALE_STAGES: readonly OrderStage[] = ['awaiting_payment', 'cancelled', 'deleted'];
export const IN_TRANSIT_STAGES: readonly OrderStage[] = ['shipped', 'out_for_delivery'];
export const RETURN_STAGES: readonly OrderStage[] = ['return_in_progress', 'returned'];

// -------------------------------------------------------------- payment state

export type PaymentState = 'paid' | 'awaiting_payment' | 'cod_due' | 'refunded' | 'free' | 'void';

const PAYMENT_LABELS: Record<PaymentState, string> = {
  paid: 'مدفوع',
  awaiting_payment: 'بانتظار الدفع',
  cod_due: 'الدفع عند الاستلام - لم يُحصّل بعد',
  refunded: 'مسترد',
  free: 'مجاني',
  void: 'لا ينطبق (طلب ملغي)',
};

/**
 * Salla does not populate a payment status on the stored orders
 * (`SallaOrder.paymentStatus` is always null), so it is derived from the
 * order status, payment method and Salla's `is_pending_payment` flag.
 */
export function derivePaymentState(input: {
  statusSlug: string | null;
  paymentMethod: string | null;
  isPendingPayment?: boolean | null;
}): Labelled<PaymentState> {
  const stage = orderStage(input.statusSlug);
  const method = input.paymentMethod?.trim().toLowerCase() ?? '';
  let code: PaymentState;
  if (stage === 'cancelled' || stage === 'deleted') code = 'void';
  else if (stage === 'awaiting_payment' || input.isPendingPayment === true || method === 'waiting') code = 'awaiting_payment';
  else if (stage === 'returned') code = 'refunded';
  else if (method === 'free') code = 'free';
  else if (method === 'cod' && stage !== 'delivered' && stage !== 'return_in_progress') code = 'cod_due';
  else code = 'paid';
  return { code, label_ar: PAYMENT_LABELS[code] };
}

export function paymentStateLabel(state: string): string {
  return PAYMENT_LABELS[state as PaymentState] ?? state;
}

export function isPaidState(state: PaymentState): boolean {
  return state === 'paid' || state === 'refunded' || state === 'free';
}

// ----------------------------------------------------------- fulfillment state

export type FulfillmentState = 'unfulfilled' | 'ready_to_ship' | 'fulfilled' | 'cancelled';

const FULFILLMENT_LABELS: Record<FulfillmentState, string> = {
  unfulfilled: 'لم يُجهّز',
  ready_to_ship: 'جاهز للشحن',
  fulfilled: 'تم الشحن',
  cancelled: 'ملغي',
};

export function fulfillmentStateLabel(state: string): string {
  return FULFILLMENT_LABELS[state as FulfillmentState] ?? state;
}

export function deriveFulfillmentState(statusSlug: string | null): Labelled<FulfillmentState> {
  const stage = orderStage(statusSlug);
  let code: FulfillmentState;
  if (stage === 'cancelled' || stage === 'deleted') code = 'cancelled';
  else if (stage === 'ready_to_ship') code = 'ready_to_ship';
  else if (stage === 'awaiting_payment' || stage === 'new' || stage === 'processing' || stage === 'other') code = 'unfulfilled';
  else code = 'fulfilled';
  return { code, label_ar: FULFILLMENT_LABELS[code] };
}

// --------------------------------------------------------------------- carrier

export type CarrierCode = 'smsa' | 'ajex' | 'dhl' | 'aramex' | 'redbox' | 'fedex' | 'ups' | 'local_courier' | 'other';

const CARRIER_LABELS: Record<CarrierCode, string> = {
  smsa: 'سمسا',
  ajex: 'ايجكس',
  dhl: 'DHL',
  aramex: 'أرامكس',
  redbox: 'ريدبوكس',
  fedex: 'فيدكس',
  ups: 'UPS',
  local_courier: 'مندوب توصيل',
  other: 'أخرى',
};

const CARRIER_PATTERNS: [CarrierCode, RegExp][] = [
  ['ajex', /ajex|aj-ex|[أإا]يجكس/i],
  ['smsa', /smsa|سمسا/i],
  ['dhl', /dhl/i],
  ['aramex', /aramex|[أا]رامكس/i],
  ['redbox', /redbox|ريدبوكس/i],
  ['fedex', /fedex|فيدكس/i],
  ['ups', /\bups\b/i],
  ['local_courier', /مندوب|messenger|local/i],
];

/** Normalises the many spellings stored in courier/company fields. */
export function normalizeCarrier(...candidates: (string | null | undefined)[]): CarrierCode | null {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value || value === '0' || value.toLowerCase() === 'unknown') continue;
    for (const [code, pattern] of CARRIER_PATTERNS) {
      if (pattern.test(value)) return code;
    }
    return 'other';
  }
  return null;
}

export function carrierLabel(code: CarrierCode | null): string | null {
  return code ? CARRIER_LABELS[code] : null;
}

// ------------------------------------------------------------- shipment status

export type ShipmentStatus =
  | 'label_created'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'returning'
  | 'returned_to_sender'
  | 'returned'
  | 'cancelled'
  | 'unknown';

const SHIPMENT_LABELS: Record<ShipmentStatus, string> = {
  label_created: 'تم إنشاء البوليصة',
  in_transit: 'قيد النقل',
  out_for_delivery: 'خارج للتسليم',
  delivered: 'تم التسليم',
  exception: 'تعذر التسليم / مشكلة في الشحنة',
  returning: 'جاري الإرجاع للمرسل',
  returned_to_sender: 'تم الإرجاع للمرسل',
  returned: 'مسترجع (حسب حالة الطلب)',
  cancelled: 'ملغية',
  unknown: 'غير معروف',
};

export function shipmentStatusLabel(status: ShipmentStatus): string {
  return SHIPMENT_LABELS[status];
}

/** AJEX callback codes (API v1.7 §9); labels come from `lib/ajex-status.ts`. */
const AJEX_STATUS_BY_CODE: Record<number, ShipmentStatus> = {
  100: 'label_created',
  200: 'label_created',
  102: 'cancelled',
  112: 'in_transit',
  114: 'in_transit',
  201: 'in_transit',
  210: 'in_transit',
  300: 'in_transit',
  301: 'in_transit',
  302: 'in_transit',
  304: 'in_transit',
  113: 'exception',
  204: 'exception',
  606: 'exception',
  802: 'exception',
  305: 'returning',
  608: 'returning',
  602: 'out_for_delivery',
  604: 'delivered',
  609: 'returned_to_sender',
};

export const EXCEPTION_STATUSES: readonly ShipmentStatus[] = ['exception'];

export interface CarrierStatusView {
  status: ShipmentStatus;
  carrier_status_code: string | null;
  carrier_status_text: string | null;
  exception_reason: string | null;
  location_city: string | null;
  event_at: string | null;
}

export function ajexStatusView(live: AjexLiveStatus | null | undefined): CarrierStatusView | null {
  if (!live) return null;
  const code = Number.parseInt(live.code ?? '', 10);
  const status: ShipmentStatus = Number.isNaN(code)
    ? live.delivered
      ? 'delivered'
      : 'unknown'
    : AJEX_STATUS_BY_CODE[code] ?? (live.delivered ? 'delivered' : 'unknown');
  return {
    status,
    carrier_status_code: live.code ?? null,
    carrier_status_text: resolveAjexStatusLabel(Number.isNaN(code) ? null : code) ?? live.description?.trim() ?? null,
    exception_reason: status === 'exception' || status === 'returning' ? live.failureReason?.trim() || null : null,
    location_city: live.city?.trim() || null,
    event_at: live.timestamp ?? null,
  };
}

/** SMSA codes are classified by `lib/smsa-status.ts`; this maps its labels to codes. */
const SMSA_STATUS_BY_LABEL: Record<string, ShipmentStatus> = {
  'تم التسليم': 'delivered',
  'خارج للتسليم': 'out_for_delivery',
  'قيد النقل': 'in_transit',
  'بانتظار الاستلام': 'label_created',
  'مرتجع للمرسل': 'returned_to_sender',
  'ملغي': 'cancelled',
};

export function smsaStatusView(live: SmsaLiveStatus | null | undefined): CarrierStatusView | null {
  if (!live) return null;
  const label = resolveMajorSmsaStatus(live);
  const status = (label && SMSA_STATUS_BY_LABEL[label]) || (live.delivered ? 'delivered' : 'unknown');
  return {
    status,
    carrier_status_code: live.code ?? null,
    carrier_status_text: live.description?.trim() || label || null,
    exception_reason: null,
    location_city: live.city?.trim() || null,
    event_at: live.timestamp ?? null,
  };
}

const LOCAL_STATUS: Record<string, ShipmentStatus> = {
  pending: 'label_created',
  assigned: 'label_created',
  picked_up: 'in_transit',
  in_transit: 'in_transit',
  delivered: 'delivered',
  failed: 'exception',
  cancelled: 'cancelled',
};

export function localShipmentStatus(status: string | null | undefined): ShipmentStatus {
  return LOCAL_STATUS[status?.trim().toLowerCase() ?? ''] ?? 'unknown';
}

/**
 * Fallback when no carrier feed exists: Salla mirrors the order status onto
 * its shipment. A returned order says nothing about whether the parcel was
 * delivered first, so it maps to the order-level `returned` status.
 */
export function shipmentStatusFromOrderStatus(statusSlug: string | null | undefined): ShipmentStatus {
  switch (orderStage(statusSlug)) {
    case 'new':
    case 'processing':
    case 'ready_to_ship':
    case 'awaiting_payment':
      return 'label_created';
    case 'shipped':
      return 'in_transit';
    case 'out_for_delivery':
      return 'out_for_delivery';
    case 'delivered':
      return 'delivered';
    case 'cancelled':
    case 'deleted':
      return 'cancelled';
    case 'return_in_progress':
    case 'returned':
      return 'returned';
    default:
      return 'unknown';
  }
}

// -------------------------------------------------------------------- returns

const RETURN_STATUS_LABELS: Record<string, string> = {
  pending_review: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
  shipped: 'تم شحن المرتجع',
  delivered: 'وصل المرتجع للمستودع',
  completed: 'مكتمل',
  cancelled: 'ملغي',
};

export function returnStatusLabel(status: string): string {
  return RETURN_STATUS_LABELS[status] ?? status;
}

export function returnTypeLabel(type: string): string {
  return type === 'exchange' ? 'استبدال' : type === 'return' ? 'استرجاع' : type;
}
