import { STATUS_IDS } from '@/SALLA_ORDER_STATUSES';

/**
 * Pure rules for shipping v2 — routing, the pre-create compare-and-set, label
 * extraction and the station's print policy. No I/O, so they're unit tested.
 */

export type ShippingMethod = 'salla' | 'international' | 'local';

export type ShippingState =
  | 'queued'
  | 'creating'
  | 'awaiting_label'
  | 'label_ready'
  | 'printed'
  | 'needs_agent'
  | 'manual_international'
  | 'blocked'
  | 'failed'
  | 'cancelled';

/** States that still need the background worker. */
export const WORKER_STATES: ShippingState[] = ['queued', 'creating'];
/** States a label can still arrive for (webhook / reconcile). */
export const LABEL_PENDING_STATES: ShippingState[] = ['queued', 'creating', 'awaiting_label', 'manual_international', 'failed'];

const LOCAL_COMPANY_PATTERN = /مندوب/;

/**
 * How an order ships: international orders through DHL (made by hand in
 * Salla), our own agents for the "مندوب توصيل" shipping option, everything
 * else through Salla's courier integration (AJEX, SMSA, Aramex).
 */
export function routeMethod(input: { isInternational: boolean; shippingCompany: string | null }): ShippingMethod {
  if (input.isInternational) return 'international';
  if (input.shippingCompany && LOCAL_COMPANY_PATTERN.test(input.shippingCompany)) return 'local';
  return 'salla';
}

/** First state of a new task for each method. */
export function initialState(method: ShippingMethod): ShippingState {
  if (method === 'international') return 'manual_international';
  if (method === 'local') return 'needs_agent';
  return 'queued';
}

const IN_PROGRESS_IDS = [String(STATUS_IDS.IN_PROGRESS), String(STATUS_IDS.IN_PROGRESS_INTERNATIONAL)];
const SHIPPED_IDS = [
  String(STATUS_IDS.COMPLETED),
  String(STATUS_IDS.SHIPPED),
  String(STATUS_IDS.DELIVERING),
  String(STATUS_IDS.DELIVERED),
];

export type CreateDecision =
  | { action: 'create' }
  | { action: 'adopt' }
  | { action: 'wait_label' }
  | { action: 'block'; reason: string };

/**
 * Compare-and-set before asking Salla for a shipment. A label already on the
 * order is adopted, never duplicated. An order Salla already moved past
 * "in progress" but without a label yet is left for the label to arrive.
 * Anything else (cancelled, back in review, restored) needs a person.
 */
export function decideCreate(input: {
  liveStatusId: string | null;
  liveStatusName?: string | null;
  hasLabel: boolean;
  /** A shipper asked for it at the station (order may not have gone through prep). */
  manual: boolean;
}): CreateDecision {
  if (input.hasLabel) return { action: 'adopt' };
  const status = input.liveStatusId;
  if (status && IN_PROGRESS_IDS.includes(status)) return { action: 'create' };
  if (status && input.manual && status === String(STATUS_IDS.NEW_ORDER)) return { action: 'create' };
  if (status && SHIPPED_IDS.includes(status)) return { action: 'wait_label' };
  return { action: 'block', reason: `حالة الطلب في سلة: ${input.liveStatusName || status || 'غير معروفة'}` };
}

/** Label URL from a Salla order payload (webhook or live detail), if any. */
export function extractLabelUrl(order: unknown): string | null {
  if (!order || typeof order !== 'object') return null;
  const record = order as Record<string, any>;
  const fromShipment = (shipment: any): string | null => {
    if (!shipment || typeof shipment !== 'object') return null;
    const url = shipment.label?.url || shipment.label_url || shipment.labelUrl || (typeof shipment.label === 'string' ? shipment.label : null);
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  };
  const direct = fromShipment(record.shipping?.shipment);
  if (direct) return direct;
  const shipments = Array.isArray(record.shipments) ? record.shipments : [];
  for (const shipment of shipments) {
    const url = fromShipment(shipment);
    if (url) return url;
  }
  return null;
}

export type OutgoingShipment = {
  id: string | null;
  labelUrl: string;
  trackingNumber: string | null;
  courierName: string | null;
  status: string | null;
  trackingLink: string | null;
  raw: Record<string, any>;
};

/**
 * The order's outgoing waybill from Salla's `/orders/{id}/shipments` list
 * (the order detail itself carries no shipping block): not a return, not
 * cancelled, and with a label.
 */
export function pickOutgoingShipment(shipments: unknown): OutgoingShipment | null {
  if (!Array.isArray(shipments)) return null;
  for (const entry of shipments) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, any>;
    if (String(record.type ?? 'shipment').toLowerCase() === 'return') continue;
    const status = typeof record.status === 'string' ? record.status : record.status?.slug ?? null;
    if (status && /cancel/i.test(String(status))) continue;
    const labelUrl = extractLabelUrl({ shipping: { shipment: record } });
    if (!labelUrl) continue;
    const tracking = record.tracking_number ?? record.shipping_number ?? null;
    return {
      id: record.id != null ? String(record.id) : null,
      labelUrl,
      trackingNumber: tracking != null && String(tracking).trim() ? String(tracking).trim() : null,
      courierName: typeof record.courier_name === 'string' ? record.courier_name : null,
      status: status ? String(status) : null,
      trackingLink: typeof record.tracking_link === 'string' ? record.tracking_link : null,
      raw: record,
    };
  }
  return null;
}

/**
 * Normalises a scanned or typed code: Arabic-Indic digits to ASCII, spaces and
 * a leading "#" removed. Returns null when nothing usable is left.
 */
export function normalizeCode(raw: string): string | null {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const converted = raw
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/^#/, '')
    .replace(/\s+/g, '');
  return converted.length >= 3 && converted.length <= 64 ? converted : null;
}

export type PrintDecision = { ok: true; reprint: boolean } | { ok: false; code: string; message: string };

/**
 * Who may print. The first print is open to any shipper; a reprint after a
 * successful one needs a supervisor (as before), unless it's the same request
 * repeated (a retried tap), which is answered without printing again.
 */
export function decidePrint(input: {
  state: ShippingState;
  hasLabel: boolean;
  printCount: number;
  doNotShip: boolean;
  isSupervisor: boolean;
}): PrintDecision {
  if (input.doNotShip) return { ok: false, code: 'do_not_ship', message: 'هذا الطلب موقوف عن الشحن — لا تطبع البوليصة' };
  if (input.state === 'blocked') return { ok: false, code: 'blocked', message: 'الطلب موقوف — راجع المشرف' };
  if (input.state === 'cancelled') return { ok: false, code: 'cancelled', message: 'أُلغيت مهمة شحن هذا الطلب' };
  if (!input.hasLabel) return { ok: false, code: 'no_label', message: 'البوليصة لم تصل من سلة بعد' };
  if (input.printCount > 0 && !input.isSupervisor) {
    return { ok: false, code: 'reprint_needs_supervisor', message: 'طُبعت هذه البوليصة سابقاً — إعادة الطباعة من المشرف' };
  }
  return { ok: true, reprint: input.printCount > 0 };
}

const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
export const MAX_CREATE_ATTEMPTS = 6;

export function nextBackoffMs(attempts: number, retryAfterMs?: number | null): number {
  const base = BACKOFF_MS[Math.max(0, attempts - 1)] ?? 60 * 60_000;
  return Math.max(base, retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 0);
}

/** A label still missing this long after the create call is checked live. */
export const LABEL_RECONCILE_AFTER_MS = 3 * 60_000;
/** …and after this long it's handed to a person. */
export const LABEL_GIVE_UP_AFTER_MS = 10 * 60_000;

/**
 * May the shipper ask again from the station? A failed create, or a label
 * that hasn't come a few minutes after Salla accepted the request (the retry
 * checks Salla's shipments first, so it never makes a second waybill).
 */
export function canRetryAtStation(input: { state: string; creatingAt: Date | null; nowMs?: number }): boolean {
  if (input.state === 'failed') return true;
  if (input.state !== 'awaiting_label' || !input.creatingAt) return false;
  return (input.nowMs ?? Date.now()) - input.creatingAt.getTime() >= LABEL_RECONCILE_AFTER_MS;
}

export const STATE_LABELS: Record<ShippingState, string> = {
  queued: 'بانتظار إنشاء الشحنة',
  creating: 'جاري إنشاء الشحنة',
  awaiting_label: 'بانتظار البوليصة من سلة',
  label_ready: 'البوليصة جاهزة',
  printed: 'طُبعت البوليصة',
  needs_agent: 'توصيل محلي — اختر المندوب',
  manual_international: 'طلب دولي — DHL',
  blocked: 'موقوف',
  failed: 'فشل إنشاء الشحنة',
  cancelled: 'ملغى',
};
