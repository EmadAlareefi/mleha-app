'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ShipmentTrackingSummary from '@/components/local-shipping/ShipmentTrackingSummary';
import { STATUS_LABELS } from '@/app/lib/returns/status';
import { summarizeRequestMoney } from '@/lib/returns/money-summary';
import { RETURN_REASON_LABELS } from '@/lib/returns/reasons';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import { buildTrackingUrl } from '@/lib/tracking-url';
import { detectShipmentCompany, SHIPMENT_COMPANIES } from '@/lib/shipment-detector';
import type { ReturnStage } from '@/lib/returns/workflow';
import { cn } from '@/lib/utils';
import type { RequestActions } from './use-request-actions';
import {
  AUDIT_STEP_LABELS,
  formatDateTime,
  formatMoney,
  OVERRIDE_SCOPE_LABELS,
  REFUND_STATUS_LABELS,
  type ReturnRequest,
} from './types';

// ---------------------------------------------------------------------------
// Where the request stands
// ---------------------------------------------------------------------------
const STEPS: Array<{ key: string; label: string }> = [
  { key: 'pickup', label: 'الاستلام' },
  { key: 'transit', label: 'الطريق' },
  { key: 'inspect', label: 'الفحص' },
  { key: 'process', label: 'المعالجة' },
  { key: 'done', label: 'مكتمل' },
];

const STEP_INDEX: Record<ReturnStage, number> = {
  awaiting_pickup: 0,
  in_transit: 1,
  received: 2,
  ready: 3,
  processing: 3,
  needs_attention: 3,
  completed: 4,
  closed: -1,
};

export function StageProgress({ stage }: { stage: ReturnStage }) {
  if (stage === 'closed') {
    return <p className="rounded-lg bg-muted p-2 text-center text-sm text-muted-foreground">الطلب ملغي / مرفوض</p>;
  }
  const current = STEP_INDEX[stage];
  return (
    <ol className="flex items-start" aria-label="مراحل الطلب">
      {STEPS.map((step, index) => {
        const done = index < current || stage === 'completed';
        const active = index === current && stage !== 'completed';
        const alert = active && stage === 'needs_attention';
        return (
          <li key={step.key} className="relative flex flex-1 flex-col items-center gap-1 text-center">
            {index > 0 && (
              // From the previous step's centre to this one's (inline-start is the right in RTL).
              <span
                className={cn('absolute -start-1/2 top-2 h-0.5 w-full', done || active ? 'bg-emerald-500' : 'bg-border')}
                aria-hidden
              />
            )}
            <span
              className={cn(
                'relative z-10 size-5 rounded-full border-2',
                done && 'border-emerald-500 bg-emerald-500',
                active && !alert && 'border-amber-500 bg-amber-100',
                alert && 'border-red-500 bg-red-100',
                !done && !active && 'border-border bg-card',
              )}
              aria-current={active ? 'step' : undefined}
            />
            <span className={cn('text-[11px] leading-tight sm:text-xs', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Money: refund only for returned pieces, credit only for exchanged ones
// ---------------------------------------------------------------------------
export function MoneySummary({ request }: { request: ReturnRequest }) {
  const money = summarizeRequestMoney(request);
  const currency = money.currency;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-sm">
      {money.refund && (
        <>
          <dt className="flex items-center gap-2">
            الاسترجاع المالي
            <Badge variant="outline" className={cn('font-normal', money.refund.refunded && 'border-emerald-300 text-emerald-700')}>
              {REFUND_STATUS_LABELS[money.refund.status] || money.refund.status}
            </Badge>
          </dt>
          <dd className="text-left font-bold tabular-nums text-blue-700">{formatMoney(money.refund.amount, currency)}</dd>
        </>
      )}
      {money.credit && (
        <>
          <dt className="flex items-center gap-2">
            رصيد الاستبدال
            <Badge variant="outline" className="font-normal">
              {money.credit.via === 'replacement' ? 'في الطلب البديل' : money.credit.via === 'coupon' ? 'كوبون' : 'لم يُسلَّم'}
            </Badge>
          </dt>
          <dd className="text-left font-bold tabular-nums text-emerald-700">{formatMoney(money.credit.amount, currency)}</dd>
        </>
      )}
      {money.shipping > 0 && (
        <>
          <dt className="text-muted-foreground">شحن الطلب الأصلي</dt>
          <dd className="text-left tabular-nums text-muted-foreground">{formatMoney(money.shipping, currency)}</dd>
        </>
      )}
      <dt className="text-muted-foreground">رسوم الشحن والمعالجة</dt>
      <dd className="text-left tabular-nums text-muted-foreground">-{formatMoney(money.fee, currency)}</dd>
      {request.refundError && request.refundStatus !== 'refunded' && (
        <dd className="col-span-2 text-xs text-red-700">{request.refundError}</dd>
      )}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Needs attention: the reason and the ways out
// ---------------------------------------------------------------------------
export function AttentionPanel({ request, actions }: { request: ReturnRequest; actions: RequestActions }) {
  const [manualAmount, setManualAmount] = useState('');
  const money = summarizeRequestMoney(request);
  if (request.stage !== 'needs_attention') return null;
  const busy = actions.busy !== null;

  return (
    <section className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-3 sm:p-4" aria-label="يحتاج تدخل">
      <p className="flex gap-2 whitespace-pre-line text-sm text-red-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        {request.processingError || 'يحتاج تدخل'}
      </p>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Button className="h-11 sm:h-8" size="sm" onClick={() => actions.open('process')} disabled={busy}>
          <RotateCcw /> إعادة محاولة المعالجة
        </Button>
        {money.hasReturn && request.refundStatus !== 'refunded' && (
          <Button
            size="sm"
            variant="outline"
            className="h-11 bg-card sm:h-8"
            disabled={busy}
            onClick={() =>
              actions.run('salla-refund', '/api/returns/refund-manual', { returnRequestId: request.id, mode: 'salla' }, () =>
                'تم العثور على الاسترجاع في سلة وتسجيله. أعيدي محاولة المعالجة لإكمال باقي الخطوات.',
              )
            }
          >
            {actions.busy === 'salla-refund' ? <Loader2 className="animate-spin" /> : null}
            تم الاسترجاع من لوحة سلة
          </Button>
        )}
      </div>
      {money.hasReturn && request.refundStatus === 'manual' && (
        <div className="flex flex-col gap-2 border-t border-red-200 pt-3 sm:flex-row sm:items-center">
          <span className="text-sm text-red-900">تحويل بنكي / يدوي:</span>
          <div className="flex gap-2">
            <Input
              value={manualAmount}
              onChange={(event) => setManualAmount(event.target.value)}
              placeholder={money.refund ? money.refund.amount.toFixed(2) : 'المبلغ'}
              inputMode="decimal"
              className="h-11 w-32 bg-card sm:h-8"
              dir="ltr"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-11 bg-card sm:h-8"
              disabled={busy}
              onClick={() =>
                actions.run(
                  'manual-refund',
                  '/api/returns/refund-manual',
                  { returnRequestId: request.id, mode: 'manual', amount: manualAmount || money.refund?.amount },
                  () => 'تم تسجيل الاسترجاع اليدوي. أعيدي محاولة المعالجة لإكمال باقي الخطوات.',
                )
              }
            >
              تأكيد التحويل
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Return shipment
// ---------------------------------------------------------------------------
const LABEL_ACTIONS = { sync: 'تحديث من سلة', reissue: 'إعادة إصدار البوليصة', resend: 'إعادة إرسال الواتساب' } as const;
const LABEL_SYNC_MESSAGES: Record<string, string> = {
  notified: 'تم العثور على البوليصة وإرسالها للعميل.',
  already_notified: 'البوليصة موجودة وسبق إرسالها للعميل.',
  tracking_only: 'تم تحديث رقم التتبع، لكن سلة لم تصدر البوليصة بعد.',
  pending: 'سلة ما زالت تُنشئ شحنة المرتجع. حاولي بعد قليل.',
  stuck: 'لم تتوفر شحنة المرتجع بعد. افتحي الطلب في سلة وتحققي من الشحنة.',
  error: 'تعذر الاتصال بسلة.',
};

export function ShipmentSection({ request, actions }: { request: ReturnRequest; actions: RequestActions }) {
  const trackingNumber = request.smsaTrackingNumber?.trim() || request.smsaAwbNumber?.trim() || '';
  const provider = request.smsaResponse?.provider?.trim().toLowerCase();
  const detected = detectShipmentCompany(trackingNumber);
  const company = SHIPMENT_COMPANIES[provider || ''] || (detected.id !== 'unknown' ? detected : SHIPMENT_COMPANIES.smsa);
  const trackingLink = trackingNumber
    ? buildTrackingUrl(request.smsaAwbNumber || trackingNumber, company.id, request.smsaResponse?.labelUrl || request.returnLabelUrl)
    : null;
  const live = request.smsaLiveStatus;

  const labelAction = (action: keyof typeof LABEL_ACTIONS) => {
    const run = () =>
      actions.run(`label:${action}`, '/api/returns/label-actions', { returnRequestId: request.id, action }, (data) =>
        action === 'resend'
          ? data.notification?.status === 'sent'
            ? 'تم إرسال البوليصة على الواتساب.'
            : `لم يتم الإرسال: ${data.notification?.reason || data.notification?.error || 'سبب غير معروف'}`
          : LABEL_SYNC_MESSAGES[data.sync?.status] || 'تم تنفيذ الإجراء.',
      );
    if (action === 'reissue') {
      actions.askConfirm({ title: 'إعادة إصدار البوليصة', message: 'سيُطلب بوليصة إرجاع جديدة لهذا الطلب.', action: run });
    } else {
      void run();
    }
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {request.returnLabelNotificationSentAt ? (
          <Badge className="bg-emerald-100 text-emerald-800">أُرسلت البوليصة للعميل</Badge>
        ) : request.returnLabelUrl ? (
          <Badge className="bg-amber-100 text-amber-800">لم تُرسل البوليصة</Badge>
        ) : (
          <Badge className="bg-red-100 text-red-800">لا توجد بوليصة</Badge>
        )}
        {request.receivedAt && <Badge className="bg-emerald-50 text-emerald-800">وصلت المستودع {formatDateTime(request.receivedAt)}</Badge>}
      </div>
      {request.needsManualShipment && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          لم يصل رقم تتبع أو بوليصة. أنشئي شحنة المرتجع في سلة ثم اضغطي «تحديث من سلة».
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-2">
        <span className="text-muted-foreground">رقم التتبع:</span>
        <span dir="ltr" className="font-medium">
          {trackingNumber || '—'}
        </span>
        {trackingLink && (
          <a href={trackingLink.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            تتبع {company.nameAr}
          </a>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {live
          ? `${resolveMajorSmsaStatus(live) || live.description || live.code || ''}${live.city ? ` • ${live.city}` : ''}${live.timestamp ? ` • ${formatDateTime(live.timestamp)}` : ''}`
          : 'لا يوجد تحديث من شركة الشحن حتى الآن'}
      </p>
      {request.localShipments?.map((shipment) => <ShipmentTrackingSummary key={shipment.id} shipment={shipment} />)}
      {request.returnLabelNotificationError && (
        <p className="text-xs text-red-600">خطأ الإرسال: {request.returnLabelNotificationError}</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {request.returnLabelUrl && (
          <Button size="sm" variant="outline" className="h-11 sm:h-8" asChild>
            <a href={request.returnLabelUrl} target="_blank" rel="noopener noreferrer">
              فتح البوليصة
            </a>
          </Button>
        )}
        {(Object.keys(LABEL_ACTIONS) as Array<keyof typeof LABEL_ACTIONS>).map((action) => (
          <Button
            key={action}
            size="sm"
            variant="outline"
            className="h-11 sm:h-8"
            disabled={actions.busy !== null || (action === 'resend' && !request.returnLabelUrl)}
            onClick={() => labelAction(action)}
          >
            {actions.busy === `label:${action}` ? <Loader2 className="animate-spin" /> : LABEL_ACTIONS[action]}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request facts and the audit trail
// ---------------------------------------------------------------------------
export function InfoSection({ request, onOpenOverride }: { request: ReturnRequest; onOpenOverride: () => void }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">السبب</dt>
      <dd>{RETURN_REASON_LABELS[request.reason] || request.reason}</dd>
      {request.reasonDetails && (
        <>
          <dt className="text-muted-foreground">التفاصيل</dt>
          <dd className="whitespace-pre-wrap">{request.reasonDetails}</dd>
        </>
      )}
      <dt className="text-muted-foreground">الحالة</dt>
      <dd>{STATUS_LABELS[request.status] || request.status}</dd>
      {request.sallaStatus?.name && (
        <>
          <dt className="text-muted-foreground">حالة سلة</dt>
          <dd>{request.sallaStatus.name}</dd>
        </>
      )}
      <dt className="text-muted-foreground">استثناء المدة</dt>
      <dd>
        {request.windowOverride ? (
          <span>
            {OVERRIDE_SCOPE_LABELS[request.windowOverride.scope]} — {request.windowOverride.createdBy}
            {request.windowOverride.note ? ` (${request.windowOverride.note})` : ''}
          </span>
        ) : (
          <span className="text-muted-foreground">لا يوجد</span>
        )}
        <button type="button" onClick={onOpenOverride} className="mr-2 text-primary hover:underline">
          {request.windowOverride ? 'تعديل' : 'إضافة'}
        </button>
      </dd>
      {request.reviewedBy && (
        <>
          <dt className="text-muted-foreground">آخر مراجعة</dt>
          <dd>
            {request.reviewedBy}
            {request.reviewedAt ? ` • ${formatDateTime(request.reviewedAt)}` : ''}
          </dd>
        </>
      )}
      {request.adminNotes && <dd className="col-span-2 rounded-md bg-blue-50 p-2 text-blue-900">{request.adminNotes}</dd>}
    </dl>
  );
}

export function TimelineSection({ request }: { request: ReturnRequest }) {
  const audit = Array.isArray(request.processingAudit) ? [...request.processingAudit].reverse() : [];
  if (audit.length === 0) return <p className="text-sm text-muted-foreground">لا توجد خطوات مسجلة بعد.</p>;
  return (
    <ol className="space-y-2 border-r-2 border-border pr-3 text-xs">
      {audit.map((entry, index) => {
        const details = entry.details || {};
        return (
          <li key={`${entry.at}-${index}`} className="space-y-0.5">
            <p className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground">{formatDateTime(entry.at)}</span>
              <span className="font-medium">{AUDIT_STEP_LABELS[entry.step] || entry.step}</span>
              <span
                className={
                  entry.result === 'ok'
                    ? 'text-emerald-700'
                    : entry.result === 'failed' || entry.result === 'unknown'
                      ? 'text-red-700'
                      : 'text-muted-foreground'
                }
              >
                {{ ok: 'تم', skipped: 'تخطي', failed: 'فشل', unknown: 'غير معروف', info: '' }[entry.result]}
              </span>
              {entry.by && <span className="text-muted-foreground">— {entry.by}</span>}
            </p>
            {typeof details.reason === 'string' && <p className="text-muted-foreground">{details.reason}</p>}
            {typeof details.error === 'string' && <p className="text-red-600">{details.error}</p>}
            {typeof details.note === 'string' && <p className="text-muted-foreground">ملاحظة: {details.note}</p>}
            {typeof details.amount === 'number' && <p className="text-muted-foreground">{formatMoney(details.amount, request.currency)}</p>}
            {typeof details.order === 'string' && <p className="text-muted-foreground">الطلب #{details.order}</p>}
            {Array.isArray(details.changes) && (
              <p className="text-muted-foreground">
                {(details.changes as Array<{ product?: string; from?: string; to?: string }>)
                  .map((change) => `${change.product}: ${change.from === 'exchange' ? 'استبدال' : 'استرجاع'} ← ${change.to === 'exchange' ? 'استبدال' : 'استرجاع'}`)
                  .join('، ')}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
