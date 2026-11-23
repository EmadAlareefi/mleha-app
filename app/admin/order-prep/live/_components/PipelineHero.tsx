'use client';

import type { CSSProperties } from 'react';
import { ChartColumn, ChevronUp, ClipboardList, PackageCheck, Printer, ScanLine, Ticket, type LucideIcon } from 'lucide-react';
import type { BoardData } from '@/app/lib/order-prep/board';
import type { HourlyThroughput } from '@/app/lib/order-prep/hourly';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import { formatAgeAr, orderAgeMs } from '@/app/lib/order-prep/riyadh-time';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';
import { AnimatedNumber, Ring, Sparkline } from './primitives';
import { clearTime } from '../_lib/metrics';
import { HourlyChart } from './HourlyChart';
import { useUrlParam } from './useUrlParam';
import { useLiveMode } from './LiveMode';

type Stage = {
  key: string;
  label: string;
  value: number | null;
  sub: string;
  Icon: LucideIcon;
  tone?: 'warn' | 'danger' | 'good';
  trend?: number[];
};

/**
 * The warehouse as one flow: queue → packing → waiting for a waybill →
 * waybill ready → printed today. Dashes flow between stages that have work.
 */
export function PipelineHero({
  board,
  shipping,
  history,
  stale,
  hourly,
  hourlyError,
}: {
  board: BoardData | null;
  shipping: ShippingBoardData | null;
  history: { waiting: number[]; awaitingLabel: number[]; packed: number[] };
  stale?: string | null;
  hourly: HourlyThroughput | null;
  hourlyError: string | null;
}) {
  const { scope } = useLiveMode();
  const shippingOnly = scope === 'shipping';
  const [hourlyParam, setHourlyParam] = useUrlParam('hourly', '1');
  const showHourly = hourlyParam !== '0';
  const s = shipping?.byState ?? {};
  const awaitingLabel = shipping ? (s.queued ?? 0) + (s.creating ?? 0) + (s.awaiting_label ?? 0) : null;
  const oldestAge = board ? orderAgeMs(board.stats.oldestPlacedAt) : null;
  const activePackers = board ? board.packers.filter((packer) => packer.current).length : null;
  const slowLabels = shipping ? shipping.waitingByAge.h4to24 + shipping.waitingByAge.over24h : 0;

  const allStages: Stage[] = [
    {
      key: 'queue',
      label: 'بانتظار التجهيز',
      value: board?.stats.waiting ?? null,
      sub: oldestAge !== null ? `أقدمها منذ ${formatAgeAr(oldestAge)}` : 'لا طلبات بالانتظار',
      Icon: ClipboardList,
      tone: oldestAge !== null && oldestAge > 48 * 3_600_000 ? 'danger' : oldestAge !== null && oldestAge > 24 * 3_600_000 ? 'warn' : undefined,
      trend: history.waiting,
    },
    {
      key: 'packing',
      label: 'قيد التجهيز الآن',
      value: activePackers,
      sub: board ? `${board.packedLastHour} طلب في آخر ساعة` : '—',
      Icon: ScanLine,
      tone: activePackers === 0 && (board?.stats.waiting ?? 0) > 0 ? 'warn' : 'good',
    },
    {
      key: 'awaiting',
      label: 'مجهّزة بانتظار البوليصة',
      value: awaitingLabel,
      sub: slowLabels > 0 ? `${slowLabels} تنتظر أكثر من 4 ساعات` : 'كلها حديثة',
      Icon: PackageCheck,
      tone: slowLabels > 0 ? 'warn' : undefined,
      trend: history.awaitingLabel,
    },
    {
      key: 'ready',
      label: 'البوليصة جاهزة للطباعة',
      value: shipping ? (s.label_ready ?? 0) : null,
      sub: shipping ? `دولي ${s.manual_international ?? 0} · مندوب ${s.needs_agent ?? 0}` : '—',
      Icon: Ticket,
    },
    {
      key: 'printed',
      label: 'طُبعت اليوم',
      value: shipping?.printedToday ?? null,
      sub: shipping ? `${shipping.printedLastHour} في آخر ساعة` : '—',
      Icon: Printer,
      tone: 'good',
    },
  ];
  const stages = shippingOnly ? allStages.filter((stage) => stage.key !== 'queue' && stage.key !== 'packing') : allStages;

  // Share of the prep queue that is still under a day old.
  const fresh = board ? board.stats.buckets.lt24h : 0;
  const health = board && board.stats.waiting > 0 ? Math.round((fresh / board.stats.waiting) * 100) : 100;
  const healthColor = health >= 75 ? '#34d399' : health >= 45 ? '#fbbf24' : '#fb7185';

  const prepClear = board ? clearTime(board.stats.waiting, board.packedLastHour) : null;
  const shipBacklog = shipping ? (awaitingLabel ?? 0) + (s.label_ready ?? 0) : 0;
  const shipClear = shipping ? clearTime(shipBacklog, shipping.printedLastHour) : null;
  const etasAll = [
    { key: 'prep', label: 'طابور التجهيز', ready: Boolean(board), eta: prepClear, pace: board ? `${board.packedLastHour}/س` : '' },
    { key: 'ship', label: 'الطباعة والشحن', ready: Boolean(shipping), eta: shipClear, pace: shipping ? `${shipping.printedLastHour}/س` : '' },
  ];
  // Shipping-only users have no prep data: drop the prep stages and the prep clear time.
  const etas = shippingOnly ? etasAll.filter((entry) => entry.key !== 'prep') : etasAll;

  return (
    <section className={cn(styles.hero, styles.enter, 'relative overflow-hidden rounded-3xl p-4 text-white shadow-[0_20px_50px_-20px_rgba(36,28,20,0.7)] xl:p-5')}>
      {stale && (
        <p role="status" className="mb-3 flex items-center gap-1.5 rounded-xl bg-amber-400/15 px-3 py-1.5 text-[11px] font-semibold text-amber-100 ring-1 ring-amber-300/30">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> {stale}
        </p>
      )}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
        {!shippingOnly && (
        <div className="flex shrink-0 items-center gap-4 rounded-2xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10 xl:w-64">
          <Ring percent={health} size={78} stroke={8} color={healthColor}>
            <span className="text-lg font-black tabular-nums">{health}%</span>
          </Ring>
          <div className="min-w-0">
            <p className="text-xs font-medium text-white/60">صحة الطابور</p>
            <p className="text-sm leading-snug font-bold">
              {health >= 75 ? 'المستودع يتحرك جيداً' : health >= 45 ? 'الطابور يتقادم' : 'تأخر كبير في الطابور'}
            </p>
            <p className="mt-0.5 text-[11px] text-white/50">نسبة الطلبات بالانتظار أقل من يوم</p>
          </div>
        </div>
        )}

        <div className="flex shrink-0 flex-col justify-center gap-2 rounded-2xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10 xl:w-56">
          <p className="text-xs font-medium text-white/60">يُنجز بالوتيرة الحالية خلال</p>
          {etas.map((entry) => (
            <div key={entry.key} className="flex items-baseline gap-2">
              <span className="w-24 shrink-0 text-[11px] text-white/60">{entry.label}</span>
              <span
                className={cn(
                  'text-base font-black tabular-nums',
                  !entry.ready
                    ? 'text-white/30'
                    : entry.eta === null
                      ? 'text-rose-300'
                      : entry.eta.hours > 12
                        ? 'text-amber-200'
                        : 'text-emerald-200',
                )}
                title={entry.ready ? `الوتيرة في آخر ساعة: ${entry.pace}` : undefined}
              >
                {!entry.ready ? '—' : entry.eta === null ? 'متوقف' : entry.eta.label}
              </span>
            </div>
          ))}
          <p className="text-[10px] text-white/40">المتبقي ÷ ما أُنجز في آخر ساعة</p>
        </div>

        <ol className={cn('grid flex-1 grid-cols-2 gap-3 md:gap-0', shippingOnly ? 'md:grid-cols-3' : 'md:grid-cols-5')}>
          {stages.map((stage, index) => {
            const next = stages[index + 1];
            const flowing = (stage.value ?? 0) > 0;
            return (
              <li
                key={stage.key}
                style={{ animationDelay: `${120 + index * 70}ms` } as CSSProperties}
                className={cn(styles.enter, 'relative flex items-stretch')}
              >
                <div
                  className={cn(
                    'group relative flex-1 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10 transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.11]',
                    stage.tone === 'danger' && 'ring-rose-400/60',
                    stage.tone === 'warn' && 'ring-amber-300/50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-xl',
                        stage.tone === 'danger'
                          ? 'bg-rose-500/25 text-rose-200'
                          : stage.tone === 'warn'
                            ? 'bg-amber-400/20 text-amber-200'
                            : stage.tone === 'good'
                              ? 'bg-emerald-400/20 text-emerald-200'
                              : 'bg-[#e8c896]/20 text-[#f3dcb4]',
                      )}
                    >
                      <stage.Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] font-bold text-white/50 tabular-nums">{index + 1}</span>
                    {stage.trend && <span className="mr-auto hidden opacity-80 2xl:inline"><Sparkline values={stage.trend} /></span>}
                  </div>
                  <div className="mt-2 text-3xl leading-none font-black xl:text-4xl">
                    {stage.value === null ? <span className="text-white/30">—</span> : <AnimatedNumber value={stage.value} />}
                  </div>
                  <p className="mt-1.5 text-xs font-bold text-white/85">{stage.label}</p>
                  <p
                    className={cn(
                      'mt-0.5 truncate text-[11px]',
                      stage.tone === 'danger' ? 'text-rose-200' : stage.tone === 'warn' ? 'text-amber-200' : 'text-white/50',
                    )}
                  >
                    {stage.sub}
                  </p>
                </div>
                {next && (
                  <span aria-hidden className="hidden w-5 shrink-0 items-center md:flex">
                    <span className={cn('h-0.5 w-full', flowing ? styles.flow : styles.flowIdle)} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {showHourly ? (
        <div className={cn(styles.enter, 'relative mt-4')} style={{ animationDelay: '480ms' }}>
          <button
            type="button"
            onClick={() => setHourlyParam('0')}
            aria-label="إخفاء الإنتاجية بالساعة"
            title="إخفاء الإنتاجية بالساعة"
            className="absolute top-2 left-2 z-10 rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <HourlyChart hourly={hourly} error={hourlyError} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setHourlyParam(null)}
          className="mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-bold text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          <ChartColumn className="h-3.5 w-3.5" /> اليوم ساعة بساعة
        </button>
      )}
    </section>
  );
}
