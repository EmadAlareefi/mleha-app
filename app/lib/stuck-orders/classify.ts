import { STATUS_IDS } from '@/SALLA_ORDER_STATUSES';
import type {
  ActionTarget,
  Diagnosis,
  JourneyEvent,
  OrderSnapshot,
  ReturnSnapshot,
  Severity,
  StageKey,
  StuckCategory,
} from './types';

/**
 * Where did this order stop? Pure: takes a snapshot of every warehouse table
 * for one order and says which step it is waiting on, since when, and why.
 * The earliest stage that explains the wait wins; an order whose current step
 * is younger than the threshold is simply "in progress", not stuck.
 */

export const STAGES: StageKey[] = ['placed', 'prep', 'packed', 'label', 'printed', 'scanned', 'shipped'];

/** Salla slugs that mean the parcel already left the warehouse. */
const LEFT_SLUGS = new Set(['shipped', 'delivering', 'delivered', 'restoring', 'restored', 'deleted']);

const ID = {
  NEW: String(STATUS_IDS.NEW_ORDER),
  RESERVATION: String(STATUS_IDS.UNDER_REVIEW_RESERVATION),
  IN_PROGRESS: String(STATUS_IDS.IN_PROGRESS),
  IN_PROGRESS_INTL: String(STATUS_IDS.IN_PROGRESS_INTERNATIONAL),
};

const OPEN_TASK_STATES = new Set([
  'queued',
  'creating',
  'awaiting_label',
  'label_ready',
  'needs_agent',
  'manual_international',
  'blocked',
  'failed',
]);

export const TASK_STATE_LABELS: Record<string, string> = {
  queued: 'بانتظار إنشاء الشحنة',
  creating: 'جاري إنشاء الشحنة',
  awaiting_label: 'بانتظار البوليصة من سلة',
  label_ready: 'البوليصة جاهزة ولم تُطبع',
  printed: 'طُبعت البوليصة',
  needs_agent: 'توصيل محلي بانتظار اختيار المندوب',
  manual_international: 'طلب دولي بانتظار شحنه يدوياً',
  blocked: 'موقوف في محطة الشحن',
  failed: 'فشل إنشاء الشحنة',
  cancelled: 'أُغلقت مهمة الشحن',
};

export const ESCALATION_REASON_LABELS: Record<string, string> = {
  missing_items: 'قطع ناقصة',
  coming_soon: 'قطع ستتوفر قريباً',
  manual_review: 'مراجعة يدوية',
  promo_limit: 'حد عرض الريال',
};

export const SLUG_LABELS: Record<string, string> = {
  under_review: 'جديد / تحت المراجعة',
  in_progress: 'جاري التجهيز',
  completed: 'تم التنفيذ',
  shipped: 'تم الشحن',
  delivering: 'جاري التوصيل',
  delivered: 'تم التوصيل',
  canceled: 'ملغي',
  restoring: 'قيد الاسترجاع',
  restored: 'مسترجع',
  payment_pending: 'بانتظار الدفع',
  deleted: 'محذوف',
};

const SYNC_KIND_LABELS: Record<string, string> = {
  packed: 'تم التجهيز → جاري التجهيز',
  exception: 'إيقاف الطلب',
  requeue: 'إعادة للتجهيز',
};

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
};

const latest = (...values: Array<string | null | undefined>): string | null => {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const valueMs = ms(value);
    if (valueMs !== null && valueMs > bestMs) {
      best = value as string;
      bestMs = valueMs;
    }
  }
  return best;
};

const name = (value: string | null | undefined) => value?.trim() || null;

const byNewest = <T extends { createdAt: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0));

const daysAr = (ageMs: number) => {
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 24) return hours <= 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : `${hours} ساعات`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'يوم' : days === 2 ? 'يومين' : days <= 10 ? `${days} أيام` : `${days} يوماً`;
};

/** Which pipeline steps the order has reached. */
export function reachedStages(s: OrderSnapshot): StageKey[] {
  const slug = s.statusSlug ?? '';
  const left = LEFT_SLUGS.has(slug);
  // A shipping task or waybill means it was packed, even by the old (v1) prep flow.
  const pastNew = slug === 'in_progress' || slug === 'completed' || left || Boolean(s.task || s.sallaShipment || s.localShipment);
  const hasLabel = Boolean(s.sallaShipment || s.localShipment || s.task?.labelReadyAt);
  const printed = Boolean(s.task?.printedAt || s.sallaShipment?.labelPrintedAt || s.localShipment);
  const reached = new Set<StageKey>(['placed']);
  if (s.prep || s.escalations.length || pastNew) reached.add('prep');
  if (s.prep?.completedAt || pastNew) reached.add('packed');
  if (hasLabel || printed || s.scan || left) reached.add('label');
  if (printed || s.scan || left) reached.add('printed');
  if (s.scan || left) reached.add('scanned');
  if (left) reached.add('shipped');
  return STAGES.filter((stage) => reached.has(stage));
}

/** Latest moment anything happened to the order inside the app. */
export function lastActivityAt(s: OrderSnapshot): string | null {
  return latest(
    s.placedAt,
    s.prep?.assignedAt,
    s.prep?.startedAt,
    s.prep?.completedAt,
    ...s.escalations.flatMap((e) => [e.createdAt, e.resolvedAt]),
    ...s.syncJobs.flatMap((j) => [j.createdAt, j.syncedAt]),
    s.task?.createdAt,
    s.task?.creatingAt,
    s.task?.labelReadyAt,
    s.task?.printedAt,
    s.sallaShipment?.createdAt,
    s.sallaShipment?.labelPrintedAt,
    s.localShipment?.createdAt,
    s.localShipment?.agentAssignedAt,
    s.localShipment?.pickedUpAt,
    s.scan?.scannedAt,
    s.scan?.handoverScannedAt,
    s.statusEvents.find((e) => e.status === s.statusSlug)?.receivedAt,
  );
}

function heldReason(s: OrderSnapshot): string | null {
  if (s.doNotShip) return `عليه علامة «لا تشحن»${s.doNotShip.notes ? `: ${s.doNotShip.notes}` : ''}`;
  if (s.customerHold) return 'العميل يعدّل الطلب الآن (حجز مؤقت)';
  if (s.statusCustomId === ID.RESERVATION) return 'محجوز (تحت المراجعة — حجز)';
  return null;
}

function lastActor(s: OrderSnapshot): string | null {
  return name(
    s.scan?.scannedBy ??
      s.task?.printedByName ??
      s.sallaShipment?.labelPrintedByName ??
      s.prep?.userName ??
      byNewest(s.escalations)[0]?.createdByName,
  );
}

type Match = { category: StuckCategory; sinceAt: string | null; reason: string; actions?: ActionTarget[]; stage?: StageKey };

/** The rule that explains where an open order is waiting. */
function matchOpenOrder(s: OrderSnapshot): Match {
  const slug = s.statusSlug ?? '';
  const isNew = s.statusCustomId === ID.NEW;
  const isReview = slug === 'under_review' && !isNew;
  const openEscalation = byNewest(s.escalations.filter((e) => !e.resolvedAt))[0];
  const badSync = byNewest(s.syncJobs.filter((j) => j.state === 'failed' || j.state === 'conflict'))[0];
  const claim = s.prep && (s.prep.status === 'assigned' || s.prep.status === 'preparing') ? s.prep : null;
  const statusSince = s.statusEvents.find((e) => e.status === slug)?.receivedAt ?? null;
  const activity = lastActivityAt(s);

  if (badSync) {
    return {
      category: 'sync_failed',
      sinceAt: badSync.createdAt,
      reason: `تعذّر تحديث حالة الطلب في سلة (${SYNC_KIND_LABELS[badSync.kind] ?? badSync.kind})${
        badSync.state === 'conflict' ? ` — تعارض: حالته في سلة «${badSync.liveStatus ?? 'غير معروفة'}»` : ' — فشلت كل المحاولات'
      }`,
      actions: [
        { action: 'retry_sync', targetId: badSync.id },
        { action: 'dismiss_sync', targetId: badSync.id },
      ],
    };
  }

  if (isReview || (openEscalation && slug === 'under_review')) {
    const exceptionJob = byNewest(s.syncJobs.filter((j) => j.kind === 'exception'))[0];
    if (openEscalation) {
      const why = ESCALATION_REASON_LABELS[openEscalation.reason] ?? openEscalation.reason;
      return {
        category: 'prep_stopped',
        stage: 'prep',
        sinceAt: openEscalation.createdAt,
        reason: `أوقفه ${name(openEscalation.createdByName) ?? 'المجهز'} أثناء التجهيز بسبب «${why}» ولم يُحسم بعد`,
        actions: [
          { action: 'requeue_escalation', targetId: openEscalation.id },
          { action: 'resolve_escalation', targetId: openEscalation.id },
        ],
      };
    }
    return {
      category: 'prep_stopped',
      stage: 'prep',
      sinceAt: exceptionJob?.createdAt ?? activity,
      reason: exceptionJob
        ? `أُوقف من ${exceptionJob.createdByName ?? 'محطة الشحن'}${exceptionJob.note ? `: ${exceptionJob.note}` : ''} وبقي في «${s.statusName ?? 'تحت المراجعة'}»`
        : `الطلب في حالة «${s.statusName ?? 'تحت المراجعة'}» ولا يتابعه أحد`,
    };
  }

  if (claim) {
    return {
      category: 'prep_abandoned',
      stage: 'packed',
      sinceAt: claim.startedAt ?? claim.assignedAt,
      reason: `استلمه ${name(claim.userName)} للتجهيز ولم يُكمله`,
    };
  }

  if (isNew) {
    if (s.prep?.completedAt) {
      return {
        category: 'sync_failed',
        sinceAt: s.prep.completedAt,
        reason: `جهّزه ${name(s.prep.userName)} لكن حالته في سلة ما زالت «طلب جديد»`,
      };
    }
    const requeued = byNewest(s.syncJobs.filter((j) => j.kind === 'requeue' && j.syncedAt))[0];
    return {
      category: 'waiting_queue',
      stage: 'prep',
      sinceAt: latest(s.placedAt, requeued?.syncedAt),
      reason: requeued ? 'أُعيد للتجهيز ولم يستلمه أي مجهز' : 'طلب جديد لم يدخل التجهيز بعد',
    };
  }

  // in_progress / completed: packed, should be heading out.
  const task = s.task;
  if (!task && !s.sallaShipment && !s.localShipment) {
    if (s.prep?.completedAt) {
      return {
        category: 'packed_no_shipping',
        sinceAt: s.prep.completedAt,
        reason: `جهّزه ${name(s.prep.userName)} ولم يصل لمحطة الشحن (لا توجد مهمة شحن ولا بوليصة)`,
      };
    }
    if (slug === 'in_progress') {
      return {
        category: 'prep_abandoned',
        stage: 'packed',
        sinceAt: statusSince ?? activity,
        reason: 'حالته «جاري التجهيز» لكن لا يوجد تجهيز مكتمل له — ربما سُحب من الرف ولم يُكمل',
      };
    }
    return {
      category: 'unknown_stuck',
      sinceAt: statusSince ?? activity,
      reason: `حالته «${s.statusName ?? SLUG_LABELS[slug] ?? slug}» ولا يوجد له أي أثر شحن`,
    };
  }

  if (task && OPEN_TASK_STATES.has(task.state)) {
    const detail = task.blockReason || task.lastError;
    return {
      category: 'shipping_stuck',
      stage: task.state === 'label_ready' ? 'printed' : 'label',
      sinceAt: latest(task.createdAt, task.creatingAt, task.labelReadyAt),
      reason: `${TASK_STATE_LABELS[task.state] ?? task.state}${detail ? ` — ${detail}` : ''}`,
      actions: [
        { action: 'retry_task', targetId: task.id },
        { action: 'close_task', targetId: task.id },
      ],
    };
  }

  const local = s.localShipment;
  if (local && local.status !== 'delivered' && local.status !== 'cancelled') {
    const withAgent = local.status === 'picked_up' || local.status === 'in_transit';
    return {
      category: 'label_not_shipped',
      stage: withAgent ? 'shipped' : 'scanned',
      sinceAt: withAgent ? local.pickedUpAt ?? local.createdAt : local.agentAssignedAt ?? local.createdAt,
      reason: withAgent ? 'استلمه المندوب ولم يُسلَّم للعميل' : local.agentAssignedAt ? 'أُسند لمندوب ولم يستلمه' : 'شحنة مندوب لم تُسند لأي مندوب',
    };
  }

  if (s.scan) {
    return {
      category: 'label_not_shipped',
      stage: 'shipped',
      sinceAt: s.scan.handoverScannedAt ?? s.scan.scannedAt,
      reason: s.scan.handoverScannedAt
        ? 'سُلّم لشركة الشحن ولم تتغير حالته في سلة إلى «تم الشحن»'
        : 'مُسح للخروج ولم تستلمه شركة الشحن (لم يُمسح تسليمه)',
    };
  }

  const printedAt = task?.printedAt ?? s.sallaShipment?.labelPrintedAt ?? null;
  return {
    category: 'label_not_shipped',
    stage: printedAt ? 'scanned' : 'printed',
    sinceAt: printedAt ?? task?.labelReadyAt ?? s.sallaShipment?.createdAt ?? activity,
    reason: printedAt
      ? `طُبعت البوليصة${task?.printedByName ? ` بواسطة ${name(task.printedByName)}` : ''} ولم يُمسح الطلب للخروج من المستودع`
      : 'صدرت البوليصة ولم تُطبع ولم يُشحن الطلب',
  };
}

function severityOf(ageMs: number | null, thresholdMs: number): Severity {
  if (ageMs === null || ageMs < thresholdMs) return 'ok';
  return ageMs >= thresholdMs * 3 ? 'critical' : 'warn';
}

export type ClassifyOptions = { nowMs: number; thresholdMs: number };

export function classifyOrder(s: OrderSnapshot, { nowMs, thresholdMs }: ClassifyOptions): Diagnosis {
  const slug = s.statusSlug ?? '';
  const reached = reachedStages(s);
  const firstMissing = STAGES.find((stage) => !reached.includes(stage)) ?? 'shipped';
  const base = { held: heldReason(s), lastActor: lastActor(s) };

  const notStuck = (reason: string, stage: StageKey = firstMissing): Diagnosis => ({
    ...base,
    stuck: false,
    category: null,
    stage,
    sinceAt: null,
    ageMs: null,
    severity: 'ok',
    reason,
    actions: [],
  });

  if (LEFT_SLUGS.has(slug)) {
    const at = s.statusEvents.find((e) => e.status === slug)?.receivedAt ?? s.updatedAtRemote;
    return {
      ...notStuck(`لا مشكلة — غادر المستودع، حالته «${s.statusName ?? SLUG_LABELS[slug] ?? slug}»`, 'shipped'),
      sinceAt: at,
    };
  }

  let match: Match | null = null;
  if (slug === 'canceled') {
    const task = s.task;
    if (task && task.state !== 'cancelled' && !s.scan) {
      match = {
        category: 'cancelled_in_warehouse',
        sinceAt: s.statusEvents.find((e) => e.status === 'canceled')?.receivedAt ?? s.updatedAtRemote ?? lastActivityAt(s),
        reason:
          task.state === 'printed'
            ? 'أُلغي في سلة بعد طباعة البوليصة — تأكد من إرجاع القطع للرف'
            : `أُلغي في سلة ومهمة الشحن ما زالت مفتوحة («${TASK_STATE_LABELS[task.state] ?? task.state}») — أغلقها وأرجع القطع للرف`,
        actions: [{ action: 'close_task', targetId: task.id }],
      };
    } else {
      return notStuck('ملغي في سلة', 'placed');
    }
  } else if (slug === 'under_review' || slug === 'in_progress' || slug === 'completed') {
    match = matchOpenOrder(s);
  } else {
    return notStuck(slug === 'payment_pending' ? 'بانتظار الدفع — لم يصل للمستودع بعد' : 'خارج مسار المستودع', 'placed');
  }

  const sinceMs = ms(match.sinceAt);
  const ageMs = sinceMs === null ? null : Math.max(0, nowMs - sinceMs);
  const severity = severityOf(ageMs, thresholdMs);
  const stuck = severity !== 'ok';
  return {
    ...base,
    stuck,
    category: match.category,
    stage: match.stage ?? firstMissing,
    sinceAt: match.sinceAt,
    ageMs,
    severity,
    reason: stuck && ageMs !== null ? `${match.reason} (منذ ${daysAr(ageMs)})` : match.reason,
    actions: match.actions ?? [],
  };
}

const CLOSED_RETURN = new Set(['completed', 'rejected', 'cancelled']);

export function classifyReturn(r: ReturnSnapshot, { nowMs, thresholdMs }: ClassifyOptions): Diagnosis {
  const needsAttention = r.processingStatus === 'needs_attention';
  const received = Boolean(r.receivedAt) || r.status === 'delivered' || r.status === 'completed';
  const base = { held: null, lastActor: null, actions: [] as ActionTarget[] };
  if (!received || (CLOSED_RETURN.has(r.status) && !needsAttention)) {
    return {
      ...base,
      stuck: false,
      category: null,
      stage: CLOSED_RETURN.has(r.status) ? 'done' : 'requested',
      sinceAt: null,
      ageMs: null,
      severity: 'ok',
      reason: CLOSED_RETURN.has(r.status) ? 'لا مشكلة — المرتجع مكتمل' : 'المرتجع لم يصل للمستودع بعد',
    };
  }
  const sinceAt = needsAttention ? latest(r.processedAt, r.receivedAt) ?? r.updatedAt : r.receivedAt ?? r.updatedAt;
  const sinceMs = ms(sinceAt);
  const ageMs = sinceMs === null ? null : Math.max(0, nowMs - sinceMs);
  const severity = severityOf(ageMs, thresholdMs);
  const reason = needsAttention
    ? 'المرتجع يحتاج تدخل — تعثّرت معالجته (استرداد أو مخزون)'
    : 'وصل المرتجع للمستودع ولم تتم معالجته';
  return {
    ...base,
    stuck: severity !== 'ok',
    category: 'return_unprocessed',
    stage: 'processing',
    sinceAt,
    ageMs,
    severity,
    reason: severity !== 'ok' && ageMs !== null ? `${reason} (منذ ${daysAr(ageMs)})` : reason,
  };
}

/** Every known event for the order, oldest first, for the detail timeline. */
export function buildJourney(s: OrderSnapshot): JourneyEvent[] {
  const events: JourneyEvent[] = [];
  const push = (at: string | null | undefined, event: Omit<JourneyEvent, 'at'>) => {
    if (at && ms(at) !== null) events.push({ at, ...event });
  };

  push(s.placedAt, { title: 'تم الطلب', tone: 'neutral', detail: s.customerCity });
  for (const e of s.statusEvents) {
    push(e.receivedAt, { title: `حالة سلة: ${SLUG_LABELS[e.status] ?? e.status}`, tone: LEFT_SLUGS.has(e.status) ? 'good' : 'neutral' });
  }
  if (s.prep) {
    push(s.prep.assignedAt, { title: 'استُلم للتجهيز', actor: s.prep.userName, tone: 'neutral' });
    if (s.prep.startedAt !== s.prep.assignedAt) push(s.prep.startedAt, { title: 'بدأ التجهيز', actor: s.prep.userName, tone: 'neutral' });
    push(s.prep.completedAt, { title: 'تم التجهيز', actor: s.prep.userName, tone: 'good', detail: s.prep.verifyIssue });
  }
  for (const e of s.escalations) {
    push(e.createdAt, {
      title: `أُوقف: ${ESCALATION_REASON_LABELS[e.reason] ?? e.reason}`,
      detail: e.notes,
      actor: e.createdByName,
      tone: 'bad',
    });
    push(e.resolvedAt, { title: 'حُسم الإيقاف', actor: e.resolvedByName, tone: 'good' });
  }
  for (const j of s.syncJobs) {
    const label = SYNC_KIND_LABELS[j.kind] ?? j.kind;
    const failed = j.state === 'failed' || j.state === 'conflict';
    push(j.createdAt, {
      title: `تحديث سلة: ${label}`,
      detail: failed ? j.lastError ?? (j.state === 'conflict' ? `تعارض (${j.liveStatus ?? '?'})` : 'فشل') : j.note,
      actor: j.createdByName,
      tone: failed ? 'bad' : 'neutral',
    });
    push(j.syncedAt, { title: `تم تحديث سلة: ${label}`, tone: 'good' });
  }
  if (s.task) {
    push(s.task.createdAt, { title: 'دخل محطة الشحن', tone: 'neutral' });
    push(s.task.creatingAt, { title: 'طُلب إنشاء الشحنة', tone: 'neutral' });
    push(s.task.labelReadyAt, { title: 'البوليصة جاهزة', tone: 'neutral' });
    push(s.task.printedAt, { title: 'طُبعت البوليصة', actor: s.task.printedByName, tone: 'good' });
    if (s.task.state !== 'printed' && s.task.state !== 'cancelled' && !s.task.printedAt) {
      push(s.task.updatedAt, {
        title: `آخر حالة شحن: ${TASK_STATE_LABELS[s.task.state] ?? s.task.state}`,
        detail: s.task.blockReason || s.task.lastError,
        tone: s.task.state === 'failed' || s.task.state === 'blocked' ? 'bad' : 'warn',
      });
    }
    if (s.task.state === 'cancelled') push(s.task.updatedAt, { title: 'أُغلقت مهمة الشحن', tone: 'warn' });
  }
  if (s.sallaShipment) {
    push(s.sallaShipment.createdAt, {
      title: `صدرت البوليصة — ${s.sallaShipment.courierName}`,
      detail: s.sallaShipment.trackingNumber,
      tone: 'neutral',
    });
    if (!s.task?.printedAt) {
      push(s.sallaShipment.labelPrintedAt, { title: 'طُبعت البوليصة', actor: s.sallaShipment.labelPrintedByName, tone: 'good' });
    }
  }
  if (s.localShipment) {
    const l = s.localShipment;
    push(l.createdAt, { title: 'أُنشئت شحنة مندوب', detail: l.trackingNumber, tone: 'neutral' });
    push(l.agentAssignedAt, { title: 'أُسندت لمندوب', tone: 'neutral' });
    push(l.pickedUpAt, { title: 'استلمها المندوب', tone: 'good' });
    push(l.deliveredAt, { title: 'سُلّمت للعميل', tone: 'good' });
    push(l.cancelledAt, { title: 'أُلغيت شحنة المندوب', tone: 'warn' });
  }
  if (s.scan) {
    push(s.scan.scannedAt, { title: 'مُسح للخروج من المستودع', actor: s.scan.scannedBy, tone: 'good' });
    push(s.scan.handoverScannedAt, { title: 'سُلّم لشركة الشحن', actor: s.scan.handoverScannedBy, tone: 'good' });
  }
  if (s.doNotShip) push(s.doNotShip.createdAt, { title: 'عُلّم «لا تشحن»', detail: s.doNotShip.notes, actor: s.doNotShip.createdByName, tone: 'warn' });
  if (s.customerHold) push(s.customerHold.createdAt, { title: 'العميل يعدّل الطلب (حجز)', tone: 'warn' });

  return events.sort((a, b) => (ms(a.at) ?? 0) - (ms(b.at) ?? 0));
}
