'use client';

import { CircleCheckBig, Copy, Hand, MapPin, User } from 'lucide-react';
import type { ActionTarget, StuckItem } from '@/app/lib/stuck-orders/types';
import { cn } from '@/lib/utils';
import { ACTION_META, CATEGORY_META, formatAge } from './labels';
import { StageStepper } from './StageStepper';

type Props = {
  item: StuckItem;
  busy: boolean;
  onOpen: (item: StuckItem) => void;
  onAction: (item: StuckItem, target: ActionTarget) => void;
  onCopy: (text: string) => void;
};

export function StuckOrderCard({ item, busy, onOpen, onAction, onCopy }: Props) {
  const { diagnosis } = item;
  const meta = diagnosis.category ? CATEGORY_META[diagnosis.category] : null;
  const critical = diagnosis.severity === 'critical';
  const primary = diagnosis.actions[0];

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item);
        }
      }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#8b6f47] focus-visible:outline-none',
        critical && 'border-rose-200',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 right-0 w-1.5',
          !diagnosis.stuck ? 'bg-emerald-500' : critical ? 'bg-rose-500' : 'bg-amber-400',
        )}
      />
      <div className="flex flex-wrap items-start gap-3">
        {meta ? (
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', meta.chip)}>
            <meta.Icon className="h-5 w-5" />
          </span>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <CircleCheckBig className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-lg font-extrabold tabular-nums" dir="ltr">
              #{item.orderNumber ?? item.orderId}
            </span>
            <button
              type="button"
              aria-label="نسخ رقم الطلب"
              onClick={(event) => {
                event.stopPropagation();
                onCopy(item.orderNumber ?? item.orderId);
              }}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {meta && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', meta.chip)}>{meta.label}</span>}
            {item.kind === 'return' && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">مرتجع</span>}
            {diagnosis.held && (
              <span className="flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                <Hand className="h-3 w-3" /> معلّق عمداً
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {item.customerName && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" /> {item.customerName}
              </span>
            )}
            {item.customerCity && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {item.customerCity}
              </span>
            )}
            {item.statusName && <span>سلة: {item.statusName}</span>}
          </div>
        </div>
        {diagnosis.stuck ? (
          <span
            className={cn(
              'shrink-0 rounded-xl px-2.5 py-1 text-center text-xs font-bold',
              critical ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-900',
            )}
          >
            <span className="block text-[10px] font-medium opacity-80">عالق منذ</span>
            {formatAge(diagnosis.ageMs)}
          </span>
        ) : (
          <span className="shrink-0 rounded-xl bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">لا مشكلة</span>
        )}
      </div>

      <p className={cn('mt-3 text-sm leading-relaxed', diagnosis.stuck ? 'text-foreground' : 'text-emerald-800')}>{diagnosis.reason}</p>

      <div className="mt-3">
        <StageStepper kind={item.kind} reached={item.reached} current={diagnosis.stage} stuck={diagnosis.stuck} compact />
      </div>

      {(diagnosis.lastActor || primary) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">{diagnosis.lastActor ? `آخر من تعامل معه: ${diagnosis.lastActor}` : ''}</span>
          {primary && (
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onAction(item, primary);
              }}
              className="rounded-lg bg-[#8b6f47] px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#765d3a] disabled:opacity-50"
            >
              {ACTION_META[primary.action].label}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
