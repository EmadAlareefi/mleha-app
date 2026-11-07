/**
 * One derived stage per return request, shared by the management UI, the
 * auto-progress cron and the processing endpoint so they never disagree.
 *
 * The stored `status` string stays for compatibility (customer pages, reports);
 * the stage is computed from status + carrier + inspection + processing state.
 */

export type ReturnStage =
  | 'awaiting_pickup'
  | 'in_transit'
  | 'received'
  | 'ready'
  | 'processing'
  | 'needs_attention'
  | 'completed'
  | 'closed';

export const STAGE_LABELS: Record<ReturnStage, string> = {
  awaiting_pickup: 'بانتظار الاستلام من العميل',
  in_transit: 'في الطريق',
  received: 'بانتظار الفحص',
  ready: 'جاهز للمعالجة',
  processing: 'قيد المعالجة',
  needs_attention: 'يحتاج تدخل',
  completed: 'مكتمل',
  closed: 'ملغي / مرفوض',
};

export const STAGE_ORDER: ReturnStage[] = [
  'ready',
  'needs_attention',
  'received',
  'in_transit',
  'awaiting_pickup',
  'processing',
  'completed',
  'closed',
];

export interface CarrierLiveStatus {
  code?: string | null;
  description?: string | null;
  delivered?: boolean | null;
}

export interface StageInput {
  status: string;
  processingStatus?: string | null;
  receivedAt?: Date | string | null;
  smsaLiveStatus?: CarrierLiveStatus | null | unknown;
  items?: Array<{ conditionStatus?: string | null }> | null;
}

const IN_TRANSIT_CODES = new Set(['IT', 'IN', 'AR', 'MA', 'TR', 'DP', 'DE', 'OD', 'WC', 'CC', 'PU']);

export function carrierDelivered(live: unknown): boolean {
  if (!live || typeof live !== 'object') return false;
  const status = live as CarrierLiveStatus;
  if (status.delivered === true) return true;
  if (String(status.code || '').trim().toUpperCase() === 'DL') return true;
  const description = String(status.description || '').toLowerCase();
  return description.includes('delivered') || description.includes('تم التسليم');
}

export function carrierMoving(live: unknown): boolean {
  if (!live || typeof live !== 'object') return false;
  const status = live as CarrierLiveStatus;
  return IN_TRANSIT_CODES.has(String(status.code || '').trim().toUpperCase()) || Boolean(status.description);
}

export function allItemsInspected(items: StageInput['items']): boolean {
  return Array.isArray(items) && items.length > 0 && items.every((item) => Boolean(item.conditionStatus));
}

export function deriveStage(input: StageInput): ReturnStage {
  if (input.status === 'cancelled' || input.status === 'rejected') return 'closed';
  if (input.status === 'completed') return 'completed';
  if (input.processingStatus === 'processing') return 'processing';
  if (input.processingStatus === 'needs_attention') return 'needs_attention';
  if (allItemsInspected(input.items)) return 'ready';
  const anyInspected = (input.items ?? []).some((item) => Boolean(item.conditionStatus));
  if (input.status === 'delivered' || input.receivedAt || anyInspected || carrierDelivered(input.smsaLiveStatus)) {
    return 'received';
  }
  if (input.status === 'shipped' || carrierMoving(input.smsaLiveStatus)) return 'in_transit';
  return 'awaiting_pickup';
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending_review: ['approved', 'rejected', 'cancelled', 'shipped', 'delivered', 'completed'],
  approved: ['pending_review', 'rejected', 'cancelled', 'shipped', 'delivered', 'completed'],
  shipped: ['pending_review', 'delivered', 'completed', 'cancelled'],
  delivered: ['pending_review', 'completed'],
  // Re-opening a closed request is an explicit staff action ("back to review").
  completed: ['pending_review'],
  rejected: ['pending_review'],
  cancelled: [],
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/** Statuses the carrier/Salla can move a request out of when it reaches the warehouse. */
export const RECEIVABLE_STATUSES = ['pending_review', 'approved', 'shipped'];
