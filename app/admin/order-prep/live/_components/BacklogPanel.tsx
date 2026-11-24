'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Building2, CheckCircle2, Hourglass, PackageCheck, PhoneCall, Printer, Truck } from 'lucide-react';
import type { BoardData } from '@/app/lib/order-prep/board';
import type { CompanyBacklogRow, ShippingBoardData } from '@/app/lib/shipping/board';
import { BIG_PICKUP_THRESHOLD_RANGE, expectedPickup } from '@/app/lib/shipping/pickup';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';
import { AnimatedNumber, EmptyNote, Panel, PanelSkeleton, StackBar, since } from './primitives';

type SegmentKey = 'inPrep' | 'onHold' | 'awaitingLabel' | 'labelReady' | 'problem';

const SEGMENTS: Array<{ key: SegmentKey; label: string; color: string; dot: string }> = [
  { key: 'inPrep', label: 'لم تُجهَّز', color: 'bg-[#c9a97a] text-[#3b2f22]', dot: 'bg-[#c9a97a]' },
  { key: 'onHold', label: 'تحت المراجعة', color: 'bg-sky-400 text-sky-950', dot: 'bg-sky-400' },
  { key: 'awaitingLabel', label: 'بانتظار البوليصة', color: 'bg-amber-400 text-amber-950', dot: 'bg-amber-400' },
  { key: 'labelReady', label: 'البوليصة جاهزة', color: 'bg-emerald-500 text-white', dot: 'bg-emerald-500' },
  { key: 'problem', label: 'فشل / موقوف', color: 'bg-rose-500 text-white', dot: 'bg-rose-500' },
];

const HOUR = 3_600_000;


const ageTone = (oldestAt: string | null) => {
  if (!oldestAt) return 'text-[var(--lv-faint)]';
  const hours = (Date.now() - new Date(oldestAt).getTime()) / HOUR;
  if (hours >= 48) return 'font-bold text-rose-600';
  if (hours >= 24) return 'font-bold text-amber-700';
  return 'text-emerald-700';
};

/** What is left to ship per carrier, how far each is through the day, and when to call for a big truck. */
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
  const threshold = shipping?.settings.bigPickupThreshold ?? BIG_PICKUP_THRESHOLD_RANGE.default;
  const sum = (pick: (row: CompanyBacklogRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const totals = SEGMENTS.map((segment) => ({ ...segment, value: sum((row) => row[segment.key]) }));
  const grand = sum((row) => row.total);
  const bigBatches = rows.filter((row) => expectedPickup(row) >= threshold);

  return (
    <Panel title="المتبقي للشحن حسب الشركة" Icon={Building2} count={grand} delay={delay} stale={stale}>
      {!shipping ? (
        <PanelSkeleton />
      ) : (
        <div className="@container space-y-3 p-3">
          {bigBatches.length > 0 && <BigBatchBanner rows={bigBatches} threshold={threshold} />}

          <div className="grid grid-cols-2 gap-2 @md:grid-cols-4">
            <Kpi Icon={Building2} label="المتبقي" value={grand} />
            <Kpi Icon={PackageCheck} label="جاهزة للتسليم" value={sum((row) => row.labelReady)} tone="ok" />
            <Kpi Icon={Printer} label="طُبعت اليوم" value={sum((row) => row.printedToday)} />
            <Kpi Icon={AlertTriangle} label="متأخرة +24 س" value={sum((row) => row.late24h)} tone="danger" />
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-[var(--lv-track)] px-2.5 py-1.5">
            {totals.map((segment) => (
              <span key={segment.key} className="flex items-center gap-1 text-[10px] text-[var(--lv-muted)]">
                <span className={cn('h-2 w-2 rounded-full', segment.dot)} />
                {segment.label}
                <b className="tabular-nums text-[var(--lv-ink)]">{segment.value}</b>
              </span>
            ))}
          </div>

          {rows.length === 0 ? (
            <EmptyNote icon="✅" title="لا توجد طلبات متبقية" />
          ) : (
            <ul className="grid grid-cols-1 gap-2 @3xl:grid-cols-2 @6xl:grid-cols-3">
              {rows.map((row, index) => (
                <CarrierCard key={row.company} row={row} index={index} big={expectedPickup(row) >= threshold} />
              ))}
            </ul>
          )}

          <div className="grid grid-cols-1 gap-3 border-t border-[var(--lv-line2)] pt-3 @xl:grid-cols-2">
            {board && (
              <AgeStrip
                title="عمر طلبات طابور التجهيز"
                buckets={[
                  { label: '< يوم', value: board.stats.buckets.lt24h, tone: 'ok' },
                  { label: '1–2 يوم', value: board.stats.buckets.d1to2, tone: 'warn' },
                  { label: '2–4 أيام', value: board.stats.buckets.d2to4, tone: 'danger' },
                  { label: '> 4 أيام', value: board.stats.buckets.gt4d, tone: 'danger' },
                ]}
              />
            )}
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

function BigBatchBanner({ rows, threshold }: { rows: CompanyBacklogRow[]; threshold: number }) {
  return (
    <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-2.5">
      <p className="flex items-center gap-2 text-xs font-extrabold text-amber-900">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className={cn('absolute inline-flex h-full w-full rounded-full bg-amber-500', styles.ping)} />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
        </span>
        <Truck className="h-4 w-4 shrink-0" />
        دفعة كبيرة: اتصل بشركة الشحن واطلب شاحنة كبيرة
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <li
            key={row.company}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-[var(--lv-card)] px-2 py-1 text-[11px] text-amber-900"
          >
            <PhoneCall className="h-3.5 w-3.5 shrink-0" />
            <b>{row.company}</b>
            <span className="tabular-nums">~{expectedPickup(row)} شحنة</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] text-amber-800/80">يظهر التنبيه عندما تتوقع شركة {threshold} شحنة أو أكثر (جاهزة + بانتظار البوليصة + لم تُجهَّز).</p>
    </div>
  );
}

function CarrierCard({ row, index, big }: { row: CompanyBacklogRow; index: number; big: boolean }) {
  const done = row.total === 0;
  const dayTotal = row.printedToday + row.total;
  const progress = dayTotal > 0 ? Math.round((row.printedToday / dayTotal) * 100) : 0;
  const expected = expectedPickup(row);

  return (
    <li
      style={{ animationDelay: `${index * 50}ms` }}
      className={cn(
        styles.enter,
        'rounded-xl border bg-[var(--lv-card)] p-2.5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(59,47,34,0.45)]',
        big ? 'border-amber-300 ring-1 ring-amber-300/60' : 'border-[var(--lv-line2)]',
        done && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--lv-chip)] text-sm font-black text-[#8b6f47]">
          {row.company.trim().charAt(0) || '؟'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-extrabold text-[var(--lv-ink)]">{row.company}</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {row.problem > 0 && <Chip className="bg-rose-100 text-rose-700">{row.problem} عطل</Chip>}
            {row.late48h > 0 ? (
              <Chip className="bg-rose-100 text-rose-700">{row.late24h} متأخر · {row.late48h} +48س</Chip>
            ) : row.late24h > 0 ? (
              <Chip className="bg-amber-100 text-amber-800">{row.late24h} متأخر +24س</Chip>
            ) : null}
            {row.labelReady > 0 && <Chip className="bg-emerald-100 text-emerald-700">{row.labelReady} جاهزة للتسليم</Chip>}
          </div>
        </div>
        <div className="shrink-0 text-left leading-none">
          {done ? (
            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> انتهى اليوم
            </span>
          ) : (
            <>
              <AnimatedNumber value={row.total} className="block text-xl font-black tabular-nums text-[var(--lv-ink)]" />
              <span className="text-[10px] text-[var(--lv-faint)]">متبقٍ</span>
            </>
          )}
        </div>
      </div>

      {!done && (
        <StackBar
          className="mt-2 h-4"
          showValues
          segments={SEGMENTS.map((segment) => ({ key: segment.key, label: segment.label, color: segment.color, value: row[segment.key] }))}
        />
      )}

      <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--lv-muted)]">
        {row.oldestAt && <span className={ageTone(row.oldestAt)}>الأقدم منذ {since(row.oldestAt)}</span>}
        <div className="mr-auto flex min-w-0 items-center gap-1.5" title={`طُبعت ${row.printedToday} من ${dayTotal} اليوم`}>
          <Printer className="h-3 w-3 shrink-0" />
          <span className="whitespace-nowrap">
            طُبع اليوم <b className="tabular-nums text-[var(--lv-ink)]">{row.printedToday}</b>
          </span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--lv-track)]">
            <span
              className="block h-full rounded-full bg-emerald-500"
              style={{ width: `${progress}%`, transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          </span>
          <span className="tabular-nums">{progress}%</span>
        </div>
      </div>

      {big && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          <PhoneCall className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            <b>دفعة كبيرة: ~{expected} شحنة.</b> اتصل بـ {row.company} وأبلغهم بإحضار شاحنة كبيرة.
            <span className="block text-[10px] text-amber-800/80">
              جاهزة {row.labelReady} · بانتظار البوليصة {row.awaitingLabel} · لم تُجهَّز {row.inPrep}
            </span>
          </p>
        </div>
      )}
    </li>
  );
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn('rounded px-1.5 py-px text-[10px] font-bold whitespace-nowrap', className)}>{children}</span>;
}

function Kpi({ Icon, label, value, tone }: { Icon: LucideIcon; label: string; value: number; tone?: 'ok' | 'danger' }) {
  const hot = tone === 'danger' && value > 0;
  return (
    <div
      className={cn(
        'rounded-xl border px-2.5 py-2',
        hot ? 'border-rose-200 bg-rose-50' : tone === 'ok' && value > 0 ? 'border-[var(--lv-line2)] bg-emerald-100/40' : 'border-[var(--lv-line2)] bg-[var(--lv-card)]',
      )}
    >
      <p className="flex items-center gap-1 text-[10px] font-bold text-[var(--lv-muted)]">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <AnimatedNumber
        value={value}
        className={cn(
          'mt-0.5 block text-lg leading-tight font-black tabular-nums',
          hot ? 'text-rose-600' : tone === 'ok' && value > 0 ? 'text-emerald-700' : 'text-[var(--lv-ink)]',
        )}
      />
    </div>
  );
}

function AgeStrip({ title, buckets }: { title: string; buckets: Array<{ label: string; value: number; tone: 'ok' | 'warn' | 'danger' }> }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.value));
  return (
    <div>
      <p className="mb-2 flex items-center gap-1 text-[11px] font-bold text-[var(--lv-muted)]">
        <Hourglass className="h-3 w-3" /> {title}
      </p>
      <div className="grid h-24 grid-cols-4 items-end gap-1.5">
        {buckets.map((bucket) => {
          const color =
            bucket.value === 0 ? 'bg-[var(--lv-line2)]' : bucket.tone === 'ok' ? 'bg-emerald-400' : bucket.tone === 'warn' ? 'bg-amber-400' : 'bg-rose-500';
          return (
            <div key={bucket.label} className="flex h-full flex-col items-center justify-end gap-1">
              <span className={cn('text-xs font-black tabular-nums', bucket.value > 0 && bucket.tone === 'danger' ? 'text-rose-600' : 'text-[var(--lv-ink)]')}>
                {bucket.value}
              </span>
              <span
                className={cn('w-full rounded-t-md', color)}
                style={{ height: `${Math.max(6, (bucket.value / max) * 56)}px`, transition: 'height 900ms cubic-bezier(0.22,1,0.36,1)' }}
              />
              <span className="text-[10px] whitespace-nowrap text-[var(--lv-faint)]">{bucket.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
