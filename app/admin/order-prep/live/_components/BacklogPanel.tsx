'use client';

import { Building2, Hourglass } from 'lucide-react';
import type { BoardData } from '@/app/lib/order-prep/board';
import type { CompanyBacklogRow, ShippingBoardData } from '@/app/lib/shipping/board';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';
import { AnimatedNumber, EmptyNote, Panel, PanelSkeleton, StackBar, since } from './primitives';

const SEGMENTS: Array<{ key: keyof CompanyBacklogRow; label: string; color: string; dot: string }> = [
  { key: 'inPrep', label: 'لم تُجهَّز', color: 'bg-[#c9a97a]', dot: 'bg-[#c9a97a]' },
  { key: 'onHold', label: 'تحت المراجعة', color: 'bg-sky-400', dot: 'bg-sky-400' },
  { key: 'awaitingLabel', label: 'بانتظار البوليصة', color: 'bg-amber-400', dot: 'bg-amber-400' },
  { key: 'labelReady', label: 'البوليصة جاهزة', color: 'bg-emerald-500', dot: 'bg-emerald-500' },
  { key: 'problem', label: 'فشل / موقوف', color: 'bg-rose-500', dot: 'bg-rose-500' },
];

/** What is left to ship per carrier, plus how old the waiting orders are. */
export function BacklogPanel({
  board,
  shipping,
  delay,
  stale,
}: {
  board: BoardData | null;
  shipping: ShippingBoardData | null;
  delay?: number;
  stale?: string | null;
}) {
  const rows = shipping?.companies ?? [];
  const totals = SEGMENTS.map((segment) => ({
    ...segment,
    value: rows.reduce((sum, row) => sum + (row[segment.key] as number), 0),
  }));
  const grand = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <Panel title="المتبقي للشحن حسب الشركة" Icon={Building2} count={grand} delay={delay} stale={stale}>
      {!shipping ? (
        <PanelSkeleton />
      ) : (
        <div className="space-y-4 p-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {totals.map((segment) => (
              <span key={segment.key} className="flex items-center gap-1 text-[10px] text-[#6b5d4f]">
                <span className={cn('h-2 w-2 rounded-full', segment.dot)} />
                {segment.label}
                <b className="tabular-nums text-[#2c2416]">{segment.value}</b>
              </span>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyNote icon="✅" title="لا توجد طلبات متبقية" />
          ) : (
            <ul className="space-y-2.5">
              {rows.map((row, index) => (
                <li key={row.company} style={{ animationDelay: `${index * 50}ms` }} className={styles.enter}>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="truncate text-xs font-bold text-[#2c2416]">{row.company}</span>
                    {row.problem > 0 && <span className="rounded bg-rose-100 px-1 text-[10px] font-bold text-rose-700">{row.problem} عطل</span>}
                    <span className="mr-auto text-[10px] text-[#9a8b7a]">{row.oldestAt ? `الأقدم منذ ${since(row.oldestAt)}` : ''}</span>
                    <span className="text-sm font-black tabular-nums text-[#2c2416]">
                      <AnimatedNumber value={row.total} />
                    </span>
                  </div>
                  <StackBar
                    className="h-3"
                    segments={SEGMENTS.map((segment) => ({
                      key: segment.key,
                      label: segment.label,
                      color: segment.color,
                      value: row[segment.key] as number,
                    }))}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 gap-3 border-t border-[#efe4d6] pt-3 2xl:grid-cols-2">
            <AgeStrip
              title="عمر طلبات طابور التجهيز"
              buckets={
                board
                  ? [
                      { label: '< يوم', value: board.stats.buckets.lt24h, tone: 'ok' },
                      { label: '1–2 يوم', value: board.stats.buckets.d1to2, tone: 'warn' },
                      { label: '2–4 أيام', value: board.stats.buckets.d2to4, tone: 'danger' },
                      { label: '> 4 أيام', value: board.stats.buckets.gt4d, tone: 'danger' },
                    ]
                  : null
              }
            />
            <AgeStrip
              title="مجهّزة ولم تُطبع بوليصتها"
              buckets={[
                { label: '< ساعة', value: shipping.waitingByAge.under1h, tone: 'ok' },
                { label: '1–4 س', value: shipping.waitingByAge.h1to4, tone: 'warn' },
                { label: '4–24 س', value: shipping.waitingByAge.h4to24, tone: 'danger' },
                { label: '> يوم', value: shipping.waitingByAge.over24h, tone: 'danger' },
              ]}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

function AgeStrip({ title, buckets }: { title: string; buckets: Array<{ label: string; value: number; tone: 'ok' | 'warn' | 'danger' }> | null }) {
  const max = buckets ? Math.max(1, ...buckets.map((bucket) => bucket.value)) : 1;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1 text-[11px] font-bold text-[#6b5d4f]">
        <Hourglass className="h-3 w-3" /> {title}
      </p>
      <div className="grid h-24 grid-cols-4 items-end gap-1.5">
        {(buckets ?? []).map((bucket) => {
          const color =
            bucket.value === 0 ? 'bg-[#efe4d6]' : bucket.tone === 'ok' ? 'bg-emerald-400' : bucket.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-500';
          return (
            <div key={bucket.label} className="flex h-full flex-col items-center justify-end gap-1">
              <span className={cn('text-xs font-black tabular-nums', bucket.value > 0 && bucket.tone === 'danger' ? 'text-rose-600' : 'text-[#2c2416]')}>
                {bucket.value}
              </span>
              <span
                className={cn('w-full rounded-t-md', color)}
                style={{ height: `${Math.max(6, (bucket.value / max) * 56)}px`, transition: 'height 900ms cubic-bezier(0.22,1,0.36,1)' }}
              />
              <span className="text-[10px] whitespace-nowrap text-[#9a8b7a]">{bucket.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
