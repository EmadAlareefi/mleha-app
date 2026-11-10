'use client';

import { AlertTriangle, ChevronLeft, Loader2, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CONDITION_LABELS } from '@/app/lib/returns/inspection';
import { TYPE_COLORS, typeLabel } from '@/app/lib/returns/status';
import { summarizeRequestMoney } from '@/lib/returns/money-summary';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import { STAGE_LABELS, type ReturnStage } from '@/lib/returns/workflow';
import { cn } from '@/lib/utils';
import { daysSince, EXCHANGE_PAYMENT_LABELS, formatDate, formatMoney, OVERRIDE_SCOPE_LABELS, type ReturnRequest } from './types';

export const STAGE_BADGE: Record<ReturnStage, string> = {
  awaiting_pickup: 'bg-slate-100 text-slate-700 border-slate-200',
  in_transit: 'bg-sky-100 text-sky-800 border-sky-200',
  received: 'bg-amber-100 text-amber-800 border-amber-200',
  ready: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  processing: 'bg-violet-100 text-violet-800 border-violet-200',
  needs_attention: 'bg-red-100 text-red-800 border-red-200',
  completed: 'bg-gray-100 text-gray-700 border-gray-200',
  closed: 'bg-gray-100 text-gray-500 border-gray-200',
};

export const CONDITION_CHIP: Record<string, string> = {
  good: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  worn: 'border-amber-300 bg-amber-50 text-amber-800',
  missing_parts: 'border-amber-300 bg-amber-50 text-amber-800',
  damaged: 'border-red-300 bg-red-50 text-red-800',
  policy_violation: 'border-red-300 bg-red-50 text-red-800',
};

const MAX_CHIPS = 4;

interface RequestCardProps {
  request: ReturnRequest;
  selected: boolean;
  selectable: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onProcess: () => void;
}

export function RequestCard({ request, selected, selectable, busy, onToggleSelect, onOpen, onProcess }: RequestCardProps) {
  const money = summarizeRequestMoney(request);
  const carrierLabel = resolveMajorSmsaStatus(request.smsaLiveStatus) || request.smsaLiveStatus?.description;
  const age = daysSince(request.receivedAt || request.createdAt);
  const inspected = request.items.filter((item) => item.conditionStatus).length;
  const stage = request.stage;
  const primary =
    stage === 'ready'
      ? { label: 'اعتماد ومعالجة', onClick: onProcess, className: 'bg-emerald-600 text-white hover:bg-emerald-700' }
      : stage === 'needs_attention'
        ? { label: 'مراجعة المشكلة', onClick: onOpen, className: '' }
        : null;

  return (
    <article
      className={cn(
        '@container relative rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md',
        stage === 'needs_attention' && 'border-red-200',
        request.needsManualShipment && stage !== 'needs_attention' && 'border-amber-300',
        selected && 'ring-2 ring-emerald-500',
      )}
    >
      {/* The whole card opens the request; controls sit above this layer. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`فتح طلب ${request.orderNumber}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative grid gap-3 p-3 @3xl:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)_minmax(11rem,15rem)_auto] @3xl:items-center @3xl:gap-4 @3xl:p-4">
        {/* Who and what */}
        <div className="flex min-w-0 items-start gap-3">
          {selectable && (
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              aria-label={`تحديد طلب ${request.orderNumber}`}
              className="pointer-events-auto relative mt-1 size-5"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold tracking-wide text-foreground" dir="ltr">
                #{request.orderNumber}
              </span>
              <Badge className={cn('px-1.5', TYPE_COLORS[money.derivedType] || TYPE_COLORS.return)}>{typeLabel(money.derivedType)}</Badge>
              <Badge className={cn('px-1.5 @3xl:hidden', STAGE_BADGE[stage])}>{STAGE_LABELS[stage]}</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">{request.customerName}</p>
            <p className="text-xs text-muted-foreground/80">
              {formatDate(request.createdAt)}
              {age !== null && age > 0 ? ` • منذ ${age} يوم` : ''}
            </p>
          </div>
        </div>

        {/* Pieces */}
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="القطع">
          {request.items.slice(0, MAX_CHIPS).map((item) => (
            <li
              key={item.id}
              title={item.conditionStatus ? CONDITION_LABELS[item.conditionStatus] : 'لم تُفحص'}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs @3xl:max-w-[14rem]',
                item.conditionStatus ? CONDITION_CHIP[item.conditionStatus] : 'border-dashed text-muted-foreground',
              )}
            >
              <span
                className={cn('size-2 shrink-0 rounded-full', item.type === 'exchange' ? 'bg-emerald-500' : 'bg-blue-500')}
                aria-label={item.type === 'exchange' ? 'استبدال' : 'استرجاع'}
              />
              <span className="truncate">
                {item.productName}
                {item.variantName ? ` · ${item.variantName}` : ''}
                {item.quantity > 1 ? ` ×${item.quantity}` : ''}
              </span>
            </li>
          ))}
          {request.items.length > MAX_CHIPS && (
            <li className="self-center text-xs text-muted-foreground">+{request.items.length - MAX_CHIPS}</li>
          )}
        </ul>

        {/* Money and where it stands */}
        <div className="flex min-w-0 flex-col gap-1.5 @3xl:items-end">
          <div className="flex flex-wrap gap-1.5 text-xs font-medium @3xl:justify-end">
            {money.typeMismatch && (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-900">تحقق من نوع القطع</span>
            )}
            {money.refund && money.refund.amount > 0 && (
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-800">
                استرجاع {formatMoney(money.refund.amount, money.currency)}
              </span>
            )}
            {money.credit &&
              (money.credit.via === 'replacement' ? (
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5',
                    request.exchangePaymentStatus === 'pending' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800',
                  )}
                >
                  طلب بديل #{money.credit.orderNumber} · {EXCHANGE_PAYMENT_LABELS[request.exchangePaymentStatus || 'none']}
                </span>
              ) : money.credit.amount > 0 ? (
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-800">
                  {money.credit.via === 'coupon' ? 'كوبون' : 'رصيد'} {formatMoney(money.credit.amount, money.currency)}
                </span>
              ) : null)}
            {request.windowOverride && (
              <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-violet-800">
                <ShieldCheck className="size-3" /> استثناء: {OVERRIDE_SCOPE_LABELS[request.windowOverride.scope] || ''}
              </span>
            )}
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {stage === 'in_transit' || stage === 'awaiting_pickup' ? (
              <>
                <Truck className="size-3.5 shrink-0" />
                <span className="truncate">{carrierLabel || 'لا يوجد تحديث من شركة الشحن'}</span>
              </>
            ) : stage === 'received' ? (
              <>
                <PackageCheck className="size-3.5 shrink-0" />
                تم فحص {inspected} من {request.items.length}
              </>
            ) : stage === 'needs_attention' ? (
              <span className="flex min-w-0 items-start gap-1 text-red-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="line-clamp-2">{request.processingError || 'يحتاج تدخل'}</span>
              </span>
            ) : request.exchangeMode === 'order' && request.exchangeOrderHoldActive ? (
              <span className="text-amber-800">الطلب البديل محجوز حتى فحص المرتجع</span>
            ) : null}
          </p>
        </div>

        {/* Stage and the next step */}
        <div className="flex items-center gap-2 @3xl:justify-end">
          <Badge className={cn('hidden @3xl:inline-flex', STAGE_BADGE[stage])}>{STAGE_LABELS[stage]}</Badge>
          {primary ? (
            <Button
              onClick={primary.onClick}
              disabled={busy}
              className={cn('pointer-events-auto relative h-11 w-full @3xl:h-9 @3xl:w-auto', primary.className)}
              variant={stage === 'needs_attention' ? 'outline' : 'default'}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {primary.label}
            </Button>
          ) : (
            <ChevronLeft className="hidden size-5 text-muted-foreground @3xl:block" aria-hidden />
          )}
        </div>
      </div>
    </article>
  );
}
