'use client';

import { useMemo, useState } from 'react';
import { Hand, SearchX } from 'lucide-react';
import { THRESHOLD_OPTIONS } from '@/app/lib/stuck-orders/threshold';
import type { ActionTarget, StuckCategory, StuckItem, StuckOrdersResult } from '@/app/lib/stuck-orders/types';
import { cn } from '@/lib/utils';
import { ACTION_META, CATEGORY_META, CATEGORY_ORDER, THRESHOLD_LABELS, formatAge } from '@/app/admin/order-prep/stuck/_components/labels';
import { StageStepper } from '@/app/admin/order-prep/stuck/_components/StageStepper';
import styles from '../live.module.css';
import { EmptyNote, Panel, PanelSkeleton } from './primitives';
import { useUrlParam } from './useUrlParam';
import { useLiveMode } from './LiveMode';

const PAGE = 30;

/** Orders that stopped moving: tap a category to filter, a card to open its journey. */
export function StuckPanel({
  result,
  threshold,
  onThreshold,
  busy,
  onOpen,
  onAction,
  delay,
  stale,
}: {
  result: StuckOrdersResult | null;
  threshold: number;
  onThreshold: (hours: number) => void;
  busy: boolean;
  onOpen: (orderId: string) => void;
  onAction: (item: StuckItem, target: ActionTarget) => void;
  delay?: number;
  stale?: string | null;
}) {
  const [rawCategory, setCategoryParam] = useUrlParam('cat');
  const [heldParam, setHeldParam] = useUrlParam('held');
  const category = rawCategory && rawCategory in CATEGORY_META ? (rawCategory as StuckCategory) : null;
  const showHeld = heldParam === '1';
  const setCategory = (next: StuckCategory | null) => setCategoryParam(next);
  const setShowHeld = (next: boolean | ((value: boolean) => boolean)) =>
    setHeldParam((typeof next === 'function' ? next(showHeld) : next) ? '1' : null);
  const [limit, setLimit] = useState(PAGE);

  const visible = useMemo(() => {
    if (!result) return [];
    return result.items.filter((item) => Boolean(item.diagnosis.held) === showHeld && (!category || item.diagnosis.category === category));
  }, [category, result, showHeld]);

  const total = result ? result.items.length - result.heldCount : 0;
  const critical = result ? Object.values(result.counts).reduce((sum, summary) => sum + (summary?.critical ?? 0), 0) : 0;
  const maxCount = result ? Math.max(1, ...Object.values(result.counts).map((summary) => summary?.count ?? 0)) : 1;

  return (
    <Panel
      title="الطلبات العالقة"
      Icon={SearchX}
      count={total}
      tone="danger"
      delay={delay}
      stale={stale}
      actions={
        <div className="flex rounded-lg bg-[var(--lv-chip)] p-0.5 text-[11px] font-bold" role="radiogroup" aria-label="مدة التعليق">
          {THRESHOLD_OPTIONS.map((hours) => (
            <button
              key={hours}
              type="button"
              role="radio"
              aria-checked={threshold === hours}
              onClick={() => {
                onThreshold(hours);
                setLimit(PAGE);
              }}
              className={cn('rounded-md px-2 py-1 transition', threshold === hours ? 'bg-[var(--lv-card)] text-[var(--lv-ink)] shadow-sm' : 'text-[var(--lv-muted)] hover:text-[var(--lv-ink)]')}
            >
              {THRESHOLD_LABELS[hours]}
            </button>
          ))}
        </div>
      }
    >
      {!result ? (
        <PanelSkeleton rows={6} />
      ) : (
        <>
          <div className="space-y-1 border-b border-[var(--lv-line2)] p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px]">
              {critical > 0 && (
                <span className={cn('rounded-full bg-rose-600 px-2 py-0.5 font-bold text-white', styles.breathe)}>{critical} حرجة</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setCategory(null);
                  setShowHeld(false);
                }}
                className={cn('rounded-full px-2 py-0.5 font-bold', !category && !showHeld ? 'bg-[var(--lv-strong)] text-[var(--lv-strong-ink)]' : 'text-[var(--lv-muted)] hover:bg-[var(--lv-chip)]')}
              >
                الكل {total}
              </button>
              {result.heldCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowHeld((value) => !value);
                    setCategory(null);
                  }}
                  className={cn(
                    'mr-auto flex items-center gap-1 rounded-full px-2 py-0.5 font-bold',
                    showHeld ? 'bg-sky-100 text-sky-800' : 'text-[var(--lv-muted)] hover:bg-[var(--lv-chip)]',
                  )}
                >
                  <Hand className="h-3 w-3" /> معلّقة عمداً {result.heldCount}
                </button>
              )}
            </div>
            {!showHeld &&
              CATEGORY_ORDER.map((key) => {
                const summary = result.counts[key];
                const count = summary?.count ?? 0;
                if (count === 0) return null;
                const meta = CATEGORY_META[key];
                const active = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setCategory(active ? null : key);
                      setLimit(PAGE);
                    }}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-right transition',
                      active ? 'bg-[var(--lv-chip)]' : 'hover:bg-[var(--lv-hover)]',
                    )}
                  >
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', meta.chip)}>
                      <meta.Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="w-28 shrink-0 truncate text-[11px] font-bold text-[var(--lv-ink)] 2xl:w-36">{meta.label}</span>
                    <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--lv-track)]">
                      <span
                        className={cn('absolute inset-y-0 right-0 rounded-full', (summary?.critical ?? 0) > 0 ? 'bg-rose-500' : 'bg-[#c9a97a]')}
                        style={{ width: `${(count / maxCount) * 100}%`, transition: 'width 900ms cubic-bezier(0.22,1,0.36,1)' }}
                      />
                    </span>
                    <span className="w-7 shrink-0 text-left text-xs font-black tabular-nums text-[var(--lv-ink)]">{count}</span>
                  </button>
                );
              })}
          </div>

          {visible.length === 0 ? (
            <EmptyNote icon="🎉" title={showHeld ? 'لا توجد طلبات معلّقة' : 'لا توجد طلبات عالقة'} hint="كل الطلبات تتحرك في المستودع" />
          ) : (
            <ul className="space-y-2 p-3">
              {visible.slice(0, limit).map((item, index) => (
                <StuckRow key={item.key} item={item} index={index} busy={busy} onOpen={onOpen} onAction={onAction} />
              ))}
              {visible.length > limit && (
                <li>
                  <button
                    type="button"
                    onClick={() => setLimit((value) => value + PAGE)}
                    className="w-full rounded-xl border border-dashed border-[var(--lv-line)] py-2 text-xs font-bold text-[var(--lv-muted)] hover:bg-[var(--lv-hover)]"
                  >
                    عرض المزيد ({visible.length - limit})
                  </button>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function StuckRow({
  item,
  index,
  busy,
  onOpen,
  onAction,
}: {
  item: StuckItem;
  index: number;
  busy: boolean;
  onOpen: (orderId: string) => void;
  onAction: (item: StuckItem, target: ActionTarget) => void;
}) {
  const { diagnosis } = item;
  const meta = diagnosis.category ? CATEGORY_META[diagnosis.category] : null;
  const critical = diagnosis.severity === 'critical';
  const { kiosk } = useLiveMode();
  const primary = kiosk ? undefined : diagnosis.actions[0];
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item.orderId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item.orderId);
        }
      }}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
      className={cn(
        styles.enter,
        'relative cursor-pointer overflow-hidden rounded-xl border bg-[var(--lv-card)] p-2.5 transition hover:-translate-y-px hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#8b6f47] focus-visible:outline-none',
        critical ? 'border-rose-200' : 'border-[var(--lv-line2)]',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 right-0 w-1', critical ? 'bg-rose-500' : 'bg-amber-400')} />
      <div className="flex items-center gap-2 pr-1">
        {meta && (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', meta.chip)}>
            <meta.Icon className="h-3.5 w-3.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span dir="ltr" className="font-mono text-sm font-extrabold text-[var(--lv-ink)]">
              #{item.orderNumber ?? item.orderId}
            </span>
            {item.kind === 'return' && <span className="rounded-full bg-fuchsia-100 px-1.5 text-[10px] font-bold text-fuchsia-700">مرتجع</span>}
            {item.customerCity && <span className="truncate text-[10px] text-[var(--lv-faint)]">{item.customerCity}</span>}
          </div>
          <p className="truncate text-[11px] text-[var(--lv-ink2)]">{diagnosis.reason}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-black tabular-nums',
            critical ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-900',
          )}
        >
          {formatAge(diagnosis.ageMs)}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-2 pr-1">
        <div className="flex-1 opacity-90">
          <StageStepper kind={item.kind} reached={item.reached} current={diagnosis.stage} stuck={diagnosis.stuck} compact />
        </div>
        {primary && (
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onAction(item, primary);
            }}
            className="shrink-0 rounded-md bg-[#8b6f47] px-2 py-1 text-[10px] font-bold text-white shadow-sm hover:bg-[#765d3a] disabled:opacity-50"
          >
            {ACTION_META[primary.action].label}
          </button>
        )}
      </div>
    </li>
  );
}
