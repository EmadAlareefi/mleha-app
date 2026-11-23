'use client';

import { useMemo } from 'react';
import { BellRing, CheckCircle2, ListRestart, Globe2, RefreshCwOff, RotateCcw, Truck, TriangleAlert, Bike, X } from 'lucide-react';
import type { BoardData, BoardException, BoardSyncIssue } from '@/app/lib/order-prep/board';
import type { BoardTask, ShippingBoardData } from '@/app/lib/shipping/board';
import { STATE_LABELS } from '@/app/lib/shipping/rules';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';
import { Panel, PanelSkeleton, since } from './primitives';
import { useUrlParam } from './useUrlParam';
import { useLiveMode } from './LiveMode';

const REASON_LABELS: Record<string, string> = {
  missing_items: 'نقص (X4)',
  coming_soon: 'سيتوفر قريباً',
  manual_review: 'مراجعة',
  promo_limit: 'حد عرض الريال',
};
const KIND_LABELS: Record<string, string> = { packed: 'تم التجهيز', exception: 'مشكلة', requeue: 'إعادة للتجهيز' };

export type AlertAction =
  | { type: 'requeue'; item: BoardException }
  | { type: 'refunded'; item: BoardException }
  | { type: 'handled'; item: BoardException }
  | { type: 'retry_sync'; item: BoardSyncIssue }
  | { type: 'dismiss_sync'; item: BoardSyncIssue }
  | { type: 'retry_task'; item: BoardTask }
  | { type: 'close_task'; item: BoardTask };

type Filter = 'all' | 'exceptions' | 'sync' | 'shipping' | 'international' | 'local';

type Row = {
  key: string;
  kind: Exclude<Filter, 'all'>;
  orderNumber: string;
  orderId: string;
  createdAt: string;
  title: string;
  badge: { text: string; className: string };
  detail: string | null;
  meta: string;
  actions: Array<{ label: string; action: AlertAction; primary?: boolean; danger?: boolean; Icon?: typeof RotateCcw }>;
};

const KIND_STYLE: Record<Row['kind'], { Icon: typeof BellRing; chip: string; bar: string }> = {
  exceptions: { Icon: TriangleAlert, chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-400' },
  sync: { Icon: RefreshCwOff, chip: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' },
  shipping: { Icon: Truck, chip: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500' },
  international: { Icon: Globe2, chip: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-400' },
  local: { Icon: Bike, chip: 'bg-teal-100 text-teal-700', bar: 'bg-teal-400' },
};

const FILTER_KEYS: Filter[] = ['all', 'exceptions', 'sync', 'shipping', 'international', 'local'];

/** Every open thing someone has to act on, in one feed. */
export function AlertsPanel({
  board,
  shipping,
  busy,
  onAction,
  onOpenOrder,
  delay,
  freshKeys,
  stale,
  onBulkRetry,
}: {
  board: BoardData | null;
  shipping: ShippingBoardData | null;
  busy: string | null;
  onAction: (action: AlertAction) => void;
  onOpenOrder: (orderId: string) => void;
  delay?: number;
  /** Rows that appeared since the page last refreshed: highlighted for a few seconds. */
  freshKeys: Set<string>;
  stale?: string | null;
  /** Retry every failed Salla sync / every failed shipping task. */
  onBulkRetry: (kind: 'sync' | 'shipping', count: number) => void;
}) {
  const { kiosk, scope } = useLiveMode();
  const [rawFilter, setFilterParam] = useUrlParam('alerts', 'all');
  const known = FILTER_KEYS.includes(rawFilter as Filter) ? (rawFilter as Filter) : 'all';
  // A shared link may name a prep tab that shipping-only users don't have.
  const filter: Filter = scope === 'shipping' && (known === 'exceptions' || known === 'sync') ? 'all' : known;
  const setFilter = (next: Filter) => setFilterParam(next);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    for (const item of board?.exceptions ?? []) {
      list.push({
        key: `ex:${item.id}`,
        kind: 'exceptions',
        orderNumber: item.orderNumber || item.orderId,
        orderId: item.orderId,
        createdAt: item.createdAt,
        title: 'خرج من التجهيز',
        badge: { text: REASON_LABELS[item.reason] ?? item.reason, className: 'bg-amber-100 text-amber-900' },
        detail: [item.notes, item.sync && item.sync.state !== 'synced' ? `سلة: ${item.sync.state}` : null].filter(Boolean).join(' · ') || null,
        meta: item.createdByName ?? '',
        actions: [
          { label: 'إعادة للتجهيز', action: { type: 'requeue', item }, primary: true, Icon: RotateCcw },
          { label: 'تم إرجاع المبلغ', action: { type: 'refunded', item } },
          { label: 'عولج خارج التجهيز', action: { type: 'handled', item } },
        ],
      });
    }
    for (const job of board?.syncIssues ?? []) {
      list.push({
        key: `sync:${job.id}`,
        kind: 'sync',
        orderNumber: job.orderNumber || job.orderId,
        orderId: job.orderId,
        createdAt: job.createdAt,
        title: `تحديث سلة: ${KIND_LABELS[job.kind] ?? job.kind}`,
        badge:
          job.state === 'conflict'
            ? { text: 'تعارض', className: 'bg-amber-100 text-amber-900' }
            : { text: `فشل (${job.attempts})`, className: 'bg-rose-100 text-rose-800' },
        detail: job.lastError,
        meta: job.createdByName ?? '',
        actions: [
          { label: 'إعادة المحاولة', action: { type: 'retry_sync', item: job }, primary: true, Icon: RotateCcw },
          { label: 'إخفاء', action: { type: 'dismiss_sync', item: job }, danger: true },
        ],
      });
    }
    const taskRow = (task: BoardTask, kind: Row['kind'], withActions: boolean): Row => ({
      key: `${kind}:${task.id}`,
      kind,
      orderNumber: task.orderNumber ?? task.orderId,
      orderId: task.orderId,
      createdAt: task.createdAt,
      title: kind === 'shipping' ? 'عطل في الشحن' : kind === 'international' ? 'بانتظار شحنة DHL' : 'بانتظار المندوب',
      badge: { text: STATE_LABELS[task.state] ?? task.state, className: 'bg-stone-100 text-stone-700' },
      detail: task.blockReason || task.lastError,
      meta: task.attempts > 0 ? `${task.attempts} محاولة` : '',
      actions: withActions
        ? [
            { label: 'إعادة المحاولة', action: { type: 'retry_task', item: task }, primary: true, Icon: RotateCcw },
            { label: 'تمت المعالجة', action: { type: 'close_task', item: task }, danger: true, Icon: X },
          ]
        : [],
    });
    for (const task of shipping?.problems ?? []) list.push(taskRow(task, 'shipping', true));
    for (const task of shipping?.international ?? []) list.push(taskRow(task, 'international', false));
    for (const task of shipping?.local ?? []) list.push(taskRow(task, 'local', false));
    // Oldest first: they have waited longest.
    return list.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }, [board, shipping]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: 0, exceptions: 0, sync: 0, shipping: 0, international: 0, local: 0 };
    for (const row of rows) {
      result[row.kind] += 1;
      if (row.kind !== 'international' && row.kind !== 'local') result.all += 1;
    }
    return result;
  }, [rows]);

  // "All" = things that need a person; the waiting lists are their own tabs.
  const visible = filter === 'all' ? rows.filter((row) => row.kind !== 'international' && row.kind !== 'local') : rows.filter((row) => row.kind === filter);

  const ALL_FILTERS: Array<[Filter, string]> = [
    ['all', 'تحتاج تدخلاً'],
    ['exceptions', 'استثناءات التجهيز'],
    ['sync', 'مزامنة سلة'],
    ['shipping', 'أعطال الشحن'],
    ['international', 'دولي'],
    ['local', 'مندوب'],
  ];
  // Shipping-only users get no prep data, so no prep tabs.
  const FILTERS = scope === 'shipping' ? ALL_FILTERS.filter(([key]) => key !== 'exceptions' && key !== 'sync') : ALL_FILTERS;

  // Bulk retries only touch plain failures; conflicts and blocked tasks need a person each.
  const failedSync = (board?.syncIssues ?? []).filter((job) => job.state === 'failed').length;
  const failedTasks = (shipping?.problems ?? []).filter((task) => task.state === 'failed').length;
  const bulk = kiosk
    ? []
    : [
        ...(failedSync > 1 && (filter === 'all' || filter === 'sync')
          ? [{ kind: 'sync' as const, count: failedSync, label: `أعد كل تحديثات سلة الفاشلة (${failedSync})` }]
          : []),
        ...(failedTasks > 1 && (filter === 'all' || filter === 'shipping')
          ? [{ kind: 'shipping' as const, count: failedTasks, label: `أعد كل مهام الشحن الفاشلة (${failedTasks})` }]
          : []),
      ];

  return (
    <Panel title="مركز التنبيهات" Icon={BellRing} count={counts.all} tone="danger" delay={delay} stale={stale}>
      <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-[var(--lv-line2)] bg-[var(--lv-panel-solid)] px-3 py-2 backdrop-blur">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition',
              filter === key ? 'border-[var(--lv-strong)] bg-[var(--lv-strong)] text-[var(--lv-strong-ink)]' : 'border-[var(--lv-line)] text-[var(--lv-muted)] hover:border-[#8b6f47] hover:text-[var(--lv-ink)]',
            )}
          >
            {label}
            <span className={cn('rounded-full px-1.5 tabular-nums', filter === key ? 'bg-white/20' : 'bg-[var(--lv-chip)]')}>{counts[key]}</span>
          </button>
        ))}
      </div>
      {bulk.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--lv-line2)] bg-[var(--lv-hover)] px-3 py-1.5">
          {bulk.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              disabled={busy !== null}
              onClick={() => onBulkRetry(entry.kind, entry.count)}
              className={cn(
                'flex items-center gap-1 rounded-md border border-[var(--lv-line)] bg-[var(--lv-card)] px-2 py-1 text-[11px] font-bold text-[var(--lv-ink2)] transition hover:border-[#8b6f47] hover:text-[var(--lv-ink)] disabled:opacity-50',
                busy === `bulk:${entry.kind}` && 'animate-pulse',
              )}
            >
              <ListRestart className="h-3.5 w-3.5" /> {entry.label}
            </button>
          ))}
        </div>
      )}
      {!board && !shipping ? (
        <PanelSkeleton rows={5} />
      ) : visible.length === 0 ? (
        <div className="flex h-[calc(100%-44px)] items-center justify-center">
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-2 text-sm font-bold text-[var(--lv-ink)]">لا شيء يحتاج تدخلاً</p>
            <p className="text-xs text-[var(--lv-muted)]">كل شيء يسير كما يجب</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--lv-track)]">
          {visible.map((row, index) => {
            const style = KIND_STYLE[row.kind];
            const old = Date.now() - Date.parse(row.createdAt) > 24 * 3_600_000;
            const isFresh = freshKeys.has(row.key);
            return (
              <li
                key={row.key}
                style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
                className={cn(styles.enter, 'relative px-3 py-2.5 transition hover:bg-[var(--lv-hover)]')}
              >
                {isFresh && <span aria-hidden className={cn('pointer-events-none absolute inset-0', styles.fresh)} />}
                <span aria-hidden className={cn('absolute inset-y-2 right-0 w-1 rounded-l-full', style.bar)} />
                <div className="relative flex items-start gap-2.5 pr-1.5">
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', style.chip)}>
                    <style.Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <button
                        type="button"
                        onClick={() => onOpenOrder(row.orderId)}
                        // The order journey needs the prep-admin permission.
                        disabled={scope === 'shipping'}
                        dir="ltr"
                        className="font-mono text-sm font-extrabold text-[var(--lv-ink)] underline-offset-2 hover:text-[#8b6f47] hover:underline disabled:pointer-events-none"
                      >
                        #{row.orderNumber}
                      </button>
                      {isFresh && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-black text-white">جديد</span>}
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', row.badge.className)}>{row.badge.text}</span>
                      <span className="text-[11px] text-[var(--lv-muted)]">{row.title}</span>
                      <span className={cn('mr-auto text-[10px] tabular-nums', old ? 'font-bold text-rose-600' : 'text-[var(--lv-faint)]')}>
                        منذ {since(row.createdAt)}
                      </span>
                    </div>
                    {row.detail && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--lv-ink2)]">{row.detail}</p>}
                    {((!kiosk && row.actions.length > 0) || row.meta) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {(kiosk ? [] : row.actions).map((entry) => {
                          const key = `${entry.action.type}:${entry.action.item.id}`;
                          return (
                            <button
                              key={entry.label}
                              type="button"
                              disabled={busy !== null}
                              onClick={() => onAction(entry.action)}
                              className={cn(
                                'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition disabled:opacity-50',
                                entry.primary
                                  ? 'bg-[#8b6f47] text-white shadow-sm hover:bg-[#765d3a]'
                                  : entry.danger
                                    ? 'border border-[var(--lv-line2)] text-rose-700 hover:bg-rose-50'
                                    : 'border border-[var(--lv-line2)] text-[var(--lv-ink2)] hover:bg-[var(--lv-chip)]',
                                busy === key && 'animate-pulse',
                              )}
                            >
                              {entry.Icon && <entry.Icon className="h-3 w-3" />}
                              {entry.label}
                            </button>
                          );
                        })}
                        {row.meta && <span className="mr-auto text-[10px] text-[var(--lv-faint)]">{row.meta}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
