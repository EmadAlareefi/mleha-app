import { carrierDelivered, deriveStage, type ReturnStage } from './workflow';

/**
 * "إعادة للمراجعة": puts a request back into its live queue — from completed,
 * rejected, ready or needs-attention — keeping every refund, coupon and restock
 * already done. Optionally clears the inspection so the warehouse checks the
 * pieces again. Pure; reopen-service.ts does the writes.
 *
 * The target status matters: a received request goes back as `delivered`, never
 * `pending_review`, because the carrier cron/webhooks would flip it and the
 * Jeddah pickup sync would book another collection for goods already here.
 */

export const REOPEN_STALE_PROCESSING_MS = 5 * 60 * 1000;

export interface ReopenPiece {
  id: string;
  productName: string;
  variantName?: string | null;
  conditionStatus?: string | null;
  restockStatus?: string | null;
  inspectedAt?: Date | string | null;
}

export interface ReopenRequest {
  status: string;
  processingStatus?: string | null;
  processingError?: string | null;
  receivedAt?: Date | string | null;
  smsaLiveStatus?: unknown;
  updatedAt?: Date | string | null;
  items: ReopenPiece[];
}

export type ReopenBlock = 'CANCELLED' | 'PROCESSING' | 'NOT_REOPENABLE' | 'NOTHING_TO_CLEAR';

export const REOPEN_BLOCK_MESSAGES: Record<ReopenBlock, string> = {
  CANCELLED: 'الطلب ملغي وأُلغيت شحنته؛ لا يمكن إعادته للمراجعة. أنشئي طلباً جديداً إن لزم.',
  PROCESSING: 'الطلب قيد المعالجة حالياً، حاولي بعد قليل.',
  NOT_REOPENABLE: 'الطلب ما زال في مرحلة الاستلام أو الفحص؛ لا حاجة لإعادته للمراجعة.',
  NOTHING_TO_CLEAR: 'كل القطع المفحوصة أُعيدت للمخزون؛ لا يوجد فحص يمكن إعادته.',
};

export interface ReopenPlan {
  ok: true;
  fromStage: ReturnStage;
  toStatus: string;
  /** Where the request lands (the queue tab), for the dialog. */
  toStage: ReturnStage;
  receivedAt: Date | null;
  /** Pieces whose inspection is cleared. */
  clearItemIds: string[];
  /** Inspected pieces kept as they are because they were already restocked. */
  keptItems: Array<{ id: string; productName: string; variantName: string | null }>;
  previousError: string | null;
  /** The stage needs a re-inspection to change anything (ready requests). */
  inspectionRequired: boolean;
}

export type ReopenResult = ReopenPlan | { ok: false; code: ReopenBlock; message: string };

const RESTOCKED = new Set(['done', 'requested']);
const REOPENABLE: ReturnStage[] = ['completed', 'closed', 'ready', 'needs_attention'];

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function planReopen(request: ReopenRequest, options: { clearInspection?: boolean; now: Date }): ReopenResult {
  const block = (code: ReopenBlock): ReopenResult => ({ ok: false, code, message: REOPEN_BLOCK_MESSAGES[code] });
  if (request.status === 'cancelled') return block('CANCELLED');

  let fromStage = deriveStage(request as any);
  if (fromStage === 'processing') {
    const touched = toDate(request.updatedAt);
    const stale = touched !== null && options.now.getTime() - touched.getTime() > REOPEN_STALE_PROCESSING_MS;
    if (!stale) return block('PROCESSING');
    fromStage = 'needs_attention';
  }
  if (!REOPENABLE.includes(fromStage)) return block('NOT_REOPENABLE');

  const inspected = request.items.filter((item) => Boolean(item.conditionStatus));
  const clearable = inspected.filter((item) => !RESTOCKED.has(item.restockStatus || 'none'));
  const kept = inspected.filter((item) => RESTOCKED.has(item.restockStatus || 'none'));
  const inspectionRequired = fromStage === 'ready';
  const clear = options.clearInspection === true || inspectionRequired;
  if (clear && clearable.length === 0 && inspectionRequired) return block('NOTHING_TO_CLEAR');

  const closed = request.status === 'completed' || request.status === 'rejected';
  const received =
    Boolean(request.receivedAt) ||
    inspected.length > 0 ||
    request.status === 'delivered' ||
    carrierDelivered(request.smsaLiveStatus);
  const toStatus = closed ? (received ? 'delivered' : 'pending_review') : request.status;

  let receivedAt: Date | null = null;
  if (toStatus === 'delivered' && !request.receivedAt) {
    const earliest = inspected
      .map((item) => toDate(item.inspectedAt))
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    receivedAt = earliest ?? options.now;
  }

  const clearItemIds = clear ? clearable.map((item) => item.id) : [];
  const toStage = deriveStage({
    status: toStatus,
    processingStatus: 'idle',
    receivedAt: receivedAt ?? request.receivedAt ?? null,
    smsaLiveStatus: request.smsaLiveStatus,
    items: request.items.map((item) => ({ conditionStatus: clearItemIds.includes(item.id) ? null : item.conditionStatus })),
  });

  return {
    ok: true,
    fromStage,
    toStatus,
    toStage,
    receivedAt,
    clearItemIds,
    keptItems: clear ? kept.map((item) => ({ id: item.id, productName: item.productName, variantName: item.variantName ?? null })) : [],
    previousError: request.processingError || null,
    inspectionRequired,
  };
}
