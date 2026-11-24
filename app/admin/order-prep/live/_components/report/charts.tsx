'use client';

import { useState } from 'react';
import { formatDuration } from '@/app/lib/analytics/stats';
import { hourLabel, WEEKDAYS, type WarehouseReport } from '@/app/lib/analytics/report';
import { cn } from '@/lib/utils';
import { formatCount, type OpenDrill } from './format';

const SERIES = [
  { key: 'placed', label: 'واردة', color: 'var(--rp-placed)' },
  { key: 'packed', label: 'مجهّزة', color: 'var(--rp-packed)' },
  { key: 'printed', label: 'شُحنت', color: 'var(--rp-printed)' },
] as const;

export function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--lv-muted)]">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            className={cn('inline-block h-2.5 w-2.5 rounded-[3px]', item.dashed && 'h-0 w-3 rounded-none border-t-2 border-dashed')}
            style={item.dashed ? { borderColor: item.color } : { background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * In vs out per hour / day: orders placed, packed and shipped side by side,
 * then (on its own axis, below) how the backlog grew or shrank over the period.
 * Bucket 0 sits on the right, the page's reading direction.
 */
export function FlowChart({ flow, granularity }: { flow: WarehouseReport['flow']; granularity: 'hour' | 'day' }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = flow.labels.length;
  const max = Math.max(1, ...flow.placed, ...flow.packed, ...flow.printed);
  const H = 150;
  const labelEvery = n <= 12 ? 1 : n <= 31 ? (granularity === 'hour' ? 3 : 2) : Math.ceil(n / 12);
  const shown = hover ?? n - 1;
  const totals = { placed: sum(flow.placed), packed: sum(flow.packed), printed: sum(flow.printed) };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Legend items={SERIES.map((series) => ({ label: `${series.label} (${formatCount(totals[series.key])})`, color: series.color }))} />
        <p className="mr-auto rounded-lg bg-[var(--lv-chip)] px-2 py-1 text-[11px] tabular-nums text-[var(--lv-ink2)]">
          <b className="text-[var(--lv-ink)]">{flow.labels[shown]}</b> · واردة {flow.placed[shown]} · مجهّزة {flow.packed[shown]} · شُحنت{' '}
          {flow.printed[shown]}
        </p>
      </div>

      <div className="relative" onMouseLeave={() => setHover(null)}>
        <GridLines max={max} height={H} />
        <div className="relative flex items-end gap-[2px]" style={{ height: H }}>
          {flow.labels.map((label, index) => (
            <div
              key={label + index}
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              tabIndex={0}
              aria-label={`${label}: واردة ${flow.placed[index]}، مجهّزة ${flow.packed[index]}، شُحنت ${flow.printed[index]}`}
              className={cn('flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-md px-[8%] outline-none', hover === index && 'bg-[var(--lv-chip)]')}
            >
              {SERIES.map((series) => {
                const value = flow[series.key][index];
                return (
                  <span
                    key={series.key}
                    className="w-full max-w-3 rounded-t-[4px]"
                    style={{
                      height: value > 0 ? Math.max(2, (value / max) * H) : 0,
                      background: series.color,
                      transition: 'height 700ms cubic-bezier(0.22,1,0.36,1)',
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-[2px]">
          {flow.labels.map((label, index) => (
            <span key={label + index} className="min-w-0 flex-1 truncate text-center text-[10px] tabular-nums text-[var(--lv-faint)]">
              {index % labelEvery === 0 ? label : ''}
            </span>
          ))}
        </div>
      </div>

      <BacklogLine values={flow.backlog} hover={hover} onHover={setHover} labels={flow.labels} />
    </div>
  );
}

function GridLines({ max, height }: { max: number; height: number }) {
  const step = niceStep(max);
  const lines = [];
  for (let value = step; value <= max; value += step) lines.push(value);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height }}>
      {lines.map((value) => (
        <div key={value} className="absolute inset-x-0 border-t border-dashed border-[var(--lv-line2)]" style={{ bottom: (value / max) * height }}>
          <span className="absolute -top-2 left-0 bg-[var(--lv-panel-solid)] px-1 text-[9px] tabular-nums text-[var(--lv-faint)]">{value}</span>
        </div>
      ))}
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 3;
  const power = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** Running backlog change (placed − shipped, cumulative), its own small chart. */
function BacklogLine({ values, labels, hover, onHover }: { values: number[]; labels: string[]; hover: number | null; onHover: (index: number | null) => void }) {
  const W = 1000;
  const H = 56;
  const n = values.length;
  const max = Math.max(1, ...values.map(Math.abs));
  const step = W / n;
  // RTL: bucket 0 on the right.
  const x = (index: number) => W - (index + 0.5) * step;
  const y = (value: number) => H / 2 - (value / max) * (H / 2 - 4);
  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const last = values[n - 1] ?? 0;
  const shown = hover ?? n - 1;
  const color = last > 0 ? '#e11d48' : '#059669';
  return (
    <div className="rounded-xl bg-[var(--lv-chip)]/60 p-2.5">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-bold text-[var(--lv-ink2)]">تغيّر المتراكم منذ بداية الفترة</span>
        <span className="tabular-nums text-[var(--lv-muted)]">
          {labels[shown]}: <b className="text-[var(--lv-ink)]">{values[shown] > 0 ? `+${values[shown]}` : values[shown]}</b>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" onMouseLeave={() => onHover(null)}>
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="var(--lv-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 4" />
        <path d={`${line} L${x(n - 1)},${H / 2} L${x(0)},${H / 2} Z`} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {values.map((_, index) => (
          <rect key={index} x={x(index) - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => onHover(index)} />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--lv-faint)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      <p className="mt-0.5 text-[10px] text-[var(--lv-faint)]">فوق الخط: وارد أكثر من المشحون (المتراكم يكبر) · تحته: نلحق بالمتراكم</p>
    </div>
  );
}

/** Where an order's time goes: each stage's median, the slowest one called out. */
export function StageBreakdown({ report, onDrill }: { report: WarehouseReport; onDrill: OpenDrill }) {
  const total = sum(report.stages.map((stage) => stage.medianSec ?? 0));
  const slowest = [...report.stages].sort((a, b) => (b.medianSec ?? 0) - (a.medianSec ?? 0))[0]?.key;
  const share = (value: number | null) => (total > 0 && value ? (value / total) * 100 : 0);

  return (
    <div className="space-y-3">
      <div className="flex h-9 w-full overflow-hidden rounded-xl bg-[var(--lv-track)]">
        {report.stages.map((stage) => (
          <button
            key={stage.key}
            type="button"
            onClick={() => onDrill(stage.drill)}
            title={`${stage.label}: ${formatDuration(stage.medianSec)}`}
            className={cn(
              'flex items-center justify-center overflow-hidden border-l-2 border-[var(--lv-panel-solid)] text-[11px] font-black text-white transition last:border-l-0 hover:brightness-110',
            )}
            style={{
              width: `${Math.max(share(stage.medianSec), 4)}%`,
              background: stage.key === slowest ? 'var(--rp-packed)' : '#a08560',
            }}
          >
            {share(stage.medianSec) >= 14 ? `${Math.round(share(stage.medianSec))}%` : ''}
          </button>
        ))}
      </div>

      <ol className="space-y-1.5">
        {report.stages.map((stage, index) => (
          <li key={stage.key}>
            <button
              type="button"
              onClick={() => onDrill(stage.drill)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-right transition hover:bg-[var(--lv-hover)]',
                stage.key === slowest ? 'border-orange-300 bg-orange-50/60' : 'border-[var(--lv-line2)]',
              )}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                style={{ background: stage.key === slowest ? 'var(--rp-packed)' : '#a08560' }}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-extrabold text-[var(--lv-ink)]">
                  {stage.label}
                  {stage.key === slowest && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800">عنق الزجاجة</span>}
                </span>
                <span className="block truncate text-[11px] text-[var(--lv-muted)]">{stage.hint}</span>
              </span>
              <span className="shrink-0 text-left">
                <span className="block text-base font-black tabular-nums text-[var(--lv-ink)]">{formatDuration(stage.medianSec)}</span>
                <span className="block text-[10px] tabular-nums text-[var(--lv-faint)]">90% ≤ {formatDuration(stage.p90Sec)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-[var(--lv-muted)]">
        الأرقام وسيط كل مرحلة للطلبات المجهّزة في الفترة. عمر الطلب كاملاً حتى الشحن: الوسيط <b>{formatDuration(report.lifeMedianSec)}</b> · 90%{' '}
        <b>{formatDuration(report.lifeP90Sec)}</b>. اضغط مرحلة لترى أبطأ طلباتها.
      </p>
    </div>
  );
}

/** Age of each order when its label printed, split at the 24h promise. */
export function AgeHistogram({ report, onDrill }: { report: WarehouseReport; onDrill: OpenDrill }) {
  const buckets = report.ageBuckets;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const total = sum(buckets.map((bucket) => bucket.count));
  const H = 140;
  const firstLate = buckets.findIndex((bucket) => bucket.late);
  return (
    <div className="space-y-2">
      <Legend
        items={[
          { label: 'ضمن الوعد', color: 'var(--rp-printed)' },
          { label: 'متأخرة', color: 'var(--rp-packed)' },
        ]}
      />
      <div className="flex items-end gap-2 pt-5" style={{ height: H + 20 }}>
        {buckets.map((bucket, index) => (
          <div key={bucket.key} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            {index === firstLate && (
              <span className="pointer-events-none absolute -right-[5px] top-0 bottom-0 border-r-2 border-dashed border-[var(--lv-faint)]">
                <span className="absolute -top-5 right-1 whitespace-nowrap rounded bg-[var(--lv-chip)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--lv-ink2)]">
                  وعد 24 ساعة
                </span>
              </span>
            )}
            <span className="mb-1 text-[11px] font-black tabular-nums text-[var(--lv-ink)]">{bucket.count}</span>
            <button
              type="button"
              onClick={() => onDrill(bucket.drill)}
              title={`${bucket.label}: ${bucket.count} (${total ? Math.round((bucket.count / total) * 100) : 0}%)`}
              className="w-full max-w-14 rounded-t-[4px] transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--lv-ink)] focus-visible:outline-none"
              style={{
                height: bucket.count > 0 ? Math.max(3, (bucket.count / max) * H) : 0,
                background: bucket.late ? 'var(--rp-packed)' : 'var(--rp-printed)',
                transition: 'height 700ms cubic-bezier(0.22,1,0.36,1)',
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {buckets.map((bucket) => (
          <span key={bucket.key} className="min-w-0 flex-1 text-center text-[10px] leading-tight text-[var(--lv-muted)]">
            {bucket.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const HEAT_MODES = [
  { key: 'placed', label: 'الوارد' },
  { key: 'packed', label: 'التجهيز' },
  { key: 'printed', label: 'الشحن' },
] as const;

/** Day-of-week × hour: when orders arrive vs when the warehouse works. */
export function Heatmap({ heatmap, days }: { heatmap: WarehouseReport['heatmap']; days: number }) {
  const [mode, setMode] = useState<(typeof HEAT_MODES)[number]['key']>('placed');
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);
  const grid = heatmap[mode];
  const max = Math.max(1, ...grid.flat());
  let peak = { day: 0, hour: 0, value: -1 };
  grid.forEach((row, day) => row.forEach((value, hour) => value > peak.value && (peak = { day, hour, value })));
  // Saturday first: the working week as the warehouse sees it.
  const order = [6, 0, 1, 2, 3, 4, 5];
  const weeks = Math.max(1, days / 7);
  const readout = hover ?? (peak.value > 0 ? peak : null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-[var(--lv-chip)] p-0.5">
          {HEAT_MODES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setMode(entry.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-bold transition',
                mode === entry.key ? 'bg-[var(--lv-card)] text-[var(--lv-ink)] shadow-sm' : 'text-[var(--lv-muted)]',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="mr-auto text-[11px] tabular-nums text-[var(--lv-ink2)]">
          {readout ? (
            <>
              {hover ? '' : 'الذروة: '}
              <b>
                {WEEKDAYS[readout.day]} {hourLabel(readout.hour)}
              </b>{' '}
              · {grid[readout.day][readout.hour]} طلب{days >= 14 ? ` (≈ ${(grid[readout.day][readout.hour] / weeks).toFixed(1)} أسبوعياً)` : ''}
            </>
          ) : (
            'لا توجد بيانات'
          )}
        </p>
      </div>
      {days < 7 && <p className="text-[11px] text-amber-700">الخريطة أوضح مع فترة 7 أيام أو أكثر.</p>}
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[560px]" onMouseLeave={() => setHover(null)}>
          {order.map((day) => (
            <div key={day} className="flex items-center gap-[2px] py-[1px]">
              <span className="w-14 shrink-0 text-[10px] font-semibold text-[var(--lv-muted)]">{WEEKDAYS[day]}</span>
              {grid[day].map((value, hour) => {
                const isPeak = day === peak.day && hour === peak.hour && peak.value > 0;
                return (
                  <span
                    key={hour}
                    onMouseEnter={() => setHover({ day, hour })}
                    title={`${WEEKDAYS[day]} ${hourLabel(hour)}: ${value}`}
                    className={cn('h-5 min-w-0 flex-1 rounded-[3px]', isPeak && 'ring-2 ring-[var(--lv-ink)] ring-offset-1 ring-offset-[var(--lv-panel-solid)]')}
                    style={{ background: value > 0 ? `rgba(var(--rp-heat), ${0.1 + 0.9 * (value / max)})` : 'var(--lv-track)' }}
                  />
                );
              })}
            </div>
          ))}
          <div className="flex gap-[2px] pt-1">
            <span className="w-14 shrink-0" />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="min-w-0 flex-1 text-center text-[9px] tabular-nums text-[var(--lv-faint)]">
                {hour % 3 === 0 ? hourLabel(hour) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-[var(--lv-faint)]">
        أقل
        <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(to left, rgba(var(--rp-heat),0.1), rgba(var(--rp-heat),1))' }} />
        أكثر
        <span className="mr-auto">بتوقيت الرياض</span>
      </div>
    </div>
  );
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
