'use client';

import type { ReportKpi, WarehouseReport } from '@/app/lib/analytics/report';
import { cn } from '@/lib/utils';
import styles from '../../live.module.css';
import { Ring, Sparkline } from '../primitives';
import { delta, formatValue, type OpenDrill } from './format';

/**
 * The headline band: the 24h promise as a gauge, then the numbers that say
 * whether the warehouse keeps up. Each tile compares with the previous period
 * and opens the orders behind it.
 */
export function HeroKpis({ report, backlog, onDrill }: { report: WarehouseReport; backlog: number | null; onDrill: OpenDrill }) {
  const byKey = Object.fromEntries(report.kpis.map((kpi) => [kpi.key, kpi])) as Record<string, ReportKpi>;
  const onTime = byKey.onTime;
  const promise = onTime.value ?? 0;
  const promiseColor = promise >= 90 ? '#34d399' : promise >= 75 ? '#fbbf24' : '#fb7185';
  const daysToClear = backlog !== null && report.printedPerDay > 0 ? backlog / report.printedPerDay : null;
  const onTimeDelta = delta(onTime.value, onTime.previous, 'pct', 'up');

  return (
    <section className={cn(styles.hero, styles.enter, 'overflow-hidden rounded-3xl p-4 text-white shadow-xl ring-1 ring-black/10 sm:p-5')}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* The promise */}
        <button
          type="button"
          onClick={() => onTime.drill && onDrill(onTime.drill)}
          title={onTime.hint}
          className="group flex items-center gap-4 rounded-2xl bg-white/[0.06] p-4 text-right ring-1 ring-white/10 transition hover:bg-white/[0.1]"
        >
          <Ring percent={promise} size={112} stroke={11} color={promiseColor}>
            <div className="text-center leading-none">
              <p className="text-2xl font-black tabular-nums">{formatValue(onTime.value, 'pct')}</p>
              <p className="mt-1 text-[10px] text-white/55">خلال 24 ساعة</p>
            </div>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-[#e8c896]">وعد الشحن</p>
            <p className="mt-0.5 text-sm font-extrabold leading-snug">{onTime.label}</p>
            {onTime.sub && <p className="mt-1 text-[11px] text-white/60">{onTime.sub}</p>}
            {onTimeDelta && <DeltaChip d={onTimeDelta} label={report.previous.label} />}
            <p className="mt-2 text-[10px] text-white/40 group-hover:text-white/70">اضغط لرؤية الطلبات المتأخرة ←</p>
          </div>
        </button>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {(['lead', 'printed', 'placed', 'net'] as const).map((key) => (
            <Tile key={key} kpi={byKey[key]} previousLabel={report.previous.label} onDrill={onDrill} />
          ))}
          <div
            title="المتبقي الآن (لم يُجهز + بانتظار البوليصة + جاهزة للطباعة + أعطال) مقسوماً على ما نشحنه يومياً في هذه الفترة."
            className="rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10"
          >
            <p className="text-[11px] font-semibold text-white/60">أيام لتصفية المتراكم</p>
            <p className={cn('mt-1 text-2xl font-black tabular-nums', daysToClear !== null && daysToClear > 1.5 ? 'text-amber-300' : 'text-white')}>
              {daysToClear === null ? '—' : daysToClear < 0.1 ? '< 0.1' : daysToClear.toFixed(1)}
            </p>
            <p className="mt-0.5 text-[10px] text-white/50">
              {backlog === null ? 'بانتظار بيانات المتراكم' : `${backlog} متبقٍ الآن ÷ ${report.printedPerDay} يومياً`}
            </p>
          </div>
          {(['packRate', 'shipRate'] as const).map((key) => (
            <Tile key={key} kpi={byKey[key]} previousLabel={report.previous.label} onDrill={onDrill} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Tile({ kpi, previousLabel, onDrill }: { kpi: ReportKpi; previousLabel: string; onDrill: OpenDrill }) {
  if (!kpi) return null;
  const d = delta(kpi.value, kpi.previous, kpi.format, kpi.better);
  const Tag = kpi.drill ? 'button' : 'div';
  return (
    <Tag
      {...(kpi.drill ? { type: 'button' as const, onClick: () => onDrill(kpi.drill!) } : {})}
      title={kpi.hint}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl bg-white/[0.06] p-3 text-right ring-1 ring-white/10',
        kpi.drill && 'transition hover:bg-white/[0.11] focus-visible:ring-2 focus-visible:ring-[#e8c896] focus-visible:outline-none',
      )}
    >
      <p className="truncate text-[11px] font-semibold text-white/60">{kpi.label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-2xl font-black tabular-nums">{formatValue(kpi.value, kpi.format)}</p>
        <Sparkline values={kpi.series} width={64} height={22} color="#e8c896" />
      </div>
      {kpi.sub && <p className="mt-0.5 truncate text-[10px] text-white/50">{kpi.sub}</p>}
      {d && <DeltaChip d={d} label={previousLabel} />}
    </Tag>
  );
}

export function DeltaChip({ d, label, light }: { d: NonNullable<ReturnType<typeof delta>>; label: string; light?: boolean }) {
  return (
    <span
      title={`مقارنة بـ ${label}`}
      className={cn(
        'mt-1.5 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums',
        light
          ? d.tone === 'good'
            ? 'bg-emerald-100 text-emerald-800'
            : d.tone === 'bad'
              ? 'bg-rose-100 text-rose-800'
              : 'bg-[var(--lv-chip)] text-[var(--lv-muted)]'
          : d.tone === 'good'
            ? 'bg-emerald-400/15 text-emerald-200'
            : d.tone === 'bad'
              ? 'bg-rose-400/20 text-rose-200'
              : 'bg-white/10 text-white/60',
      )}
    >
      {d.arrow} {d.text}
    </span>
  );
}
