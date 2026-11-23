'use client';

import { useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { HourlyThroughput } from '@/app/lib/order-prep/hourly';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';
import { compareSoFar } from '../_lib/metrics';

const sumTo = (values: number[], hour: number) => values.slice(0, hour + 1).reduce((total, value) => total + value, 0);

const hourLabel = (hour: number) => (hour === 0 ? '12ص' : hour < 12 ? `${hour}ص` : hour === 12 ? '12م' : `${hour - 12}م`);

/**
 * Today hour by hour, inside the dark hero band: orders placed (ghost bar),
 * packed (bronze), waybills printed (green), and yesterday's packed at the
 * same hour (tick). Hour 0 sits on the right, matching the page's RTL flow.
 */
export function HourlyChart({ hourly, error }: { hourly: HourlyThroughput | null; error: string | null }) {
  const [hover, setHover] = useState<number | null>(null);

  if (!hourly) {
    return (
      <div className="flex h-[104px] items-center justify-center rounded-2xl bg-white/[0.04] text-xs text-white/40 ring-1 ring-white/10">
        {error ?? 'جارٍ تحميل الإنتاجية بالساعة…'}
      </div>
    );
  }

  const { today, yesterday, currentHour } = hourly;
  const max = Math.max(1, ...today.placed, ...today.packed, ...today.printed, ...yesterday.packed);
  const packedCmp = compareSoFar(today.packed, yesterday.packed, currentHour);
  const printedCmp = compareSoFar(today.printed, yesterday.printed, currentHour);
  const shown = hover ?? currentHour;
  const BAR_H = 64;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10 lg:flex-row lg:items-stretch">
      <div className="flex shrink-0 flex-row gap-4 lg:w-52 lg:flex-col lg:justify-center lg:gap-2">
        <Delta label="التجهيز" total={sumTo(today.packed, currentHour)} cmp={packedCmp} />
        <Delta label="البوالص" total={sumTo(today.printed, currentHour)} cmp={printedCmp} />
        <p className="hidden text-[10px] text-white/40 lg:block">مقارنة بأمس حتى نفس الساعة</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/60">
          <Legend className="bg-white/20" label="طلبات واردة" />
          <Legend className="bg-[#e8c896]" label="مجهّزة" />
          <Legend className="bg-emerald-400" label="بوالص مطبوعة" />
          <Legend className="h-0.5 bg-sky-300" label="مجهّزة أمس" />
          <span className="mr-auto tabular-nums text-white/80">
            <b className="text-white">{hourLabel(shown)}</b>
            {shown === currentHour && hover === null ? ' (الساعة الحالية)' : ''} · واردة {today.placed[shown]} · مجهّزة {today.packed[shown]} ·
            مطبوعة {today.printed[shown]} · أمس {yesterday.packed[shown]}
          </span>
        </div>
        <div className="flex items-end gap-[3px]" style={{ height: BAR_H }} onMouseLeave={() => setHover(null)}>
          {today.placed.map((placed, hour) => {
            const future = hour > currentHour;
            const now = hour === currentHour;
            const h = (value: number) => `${Math.max(value > 0 ? 3 : 0, (value / max) * BAR_H)}px`;
            return (
              <div
                key={hour}
                onMouseEnter={() => setHover(hour)}
                className={cn('relative flex h-full flex-1 items-end justify-center rounded-sm', hover === hour && 'bg-white/[0.06]', future && 'opacity-25')}
              >
                {/* placed: wide ghost bar behind */}
                <span className="absolute inset-x-0 bottom-0 rounded-t-sm bg-white/[0.12]" style={{ height: h(placed), transition: 'height 900ms cubic-bezier(0.22,1,0.36,1)' }} />
                {/* packed + printed side by side */}
                <span className="relative flex h-full w-full items-end justify-center gap-px px-[15%]">
                  <span
                    className={cn('w-1/2 rounded-t-sm bg-[#e8c896]', now && styles.breathe)}
                    style={{ height: h(today.packed[hour]), transition: 'height 900ms cubic-bezier(0.22,1,0.36,1)' }}
                  />
                  <span
                    className="w-1/2 rounded-t-sm bg-emerald-400"
                    style={{ height: h(today.printed[hour]), transition: 'height 900ms cubic-bezier(0.22,1,0.36,1)' }}
                  />
                </span>
                {/* yesterday's packed at this hour */}
                {yesterday.packed[hour] > 0 && (
                  <span className="absolute inset-x-[8%] h-0.5 rounded-full bg-sky-300/80" style={{ bottom: `${(yesterday.packed[hour] / max) * BAR_H}px` }} />
                )}
                {now && <span className="absolute -top-1 h-1.5 w-1.5 rounded-full bg-[#e8c896]" />}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-[3px] text-[9px] text-white/40">
          {today.placed.map((_, hour) => (
            <span key={hour} className={cn('flex-1 text-center tabular-nums', hour === currentHour && 'font-bold text-[#e8c896]')}>
              {hour % 3 === 0 ? hourLabel(hour) : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Today's total so far, with the change vs yesterday over the same finished hours. */
function Delta({ label, total, cmp }: { label: string; total: number; cmp: ReturnType<typeof compareSoFar> }) {
  const delta = cmp?.deltaPct ?? null;
  const up = delta !== null && delta >= 0;
  return (
    <div className="leading-tight">
      <p className="text-[11px] text-white/60">{label} اليوم</p>
      <p className="flex items-baseline gap-1.5">
        <span className="text-lg font-black tabular-nums">{total}</span>
        {delta !== null && (
          <span className={cn('flex items-center gap-0.5 text-[11px] font-bold', up ? 'text-emerald-300' : 'text-rose-300')}>
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {up ? '+' : ''}
            {delta}%
          </span>
        )}
        {cmp && (
          <span className="text-[10px] text-white/40" title="حتى نهاية الساعة السابقة">
            {cmp.today} مقابل {cmp.yesterday} أمس
          </span>
        )}
      </p>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('inline-block h-2 w-2.5 rounded-sm', className)} />
      {label}
    </span>
  );
}
