'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  CalendarRange,
  CircleCheck,
  Clock4,
  Flame,
  Info,
  Lightbulb,
  Loader2,
  PackageX,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  Truck,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { OrdersDrawer } from '@/app/admin/order-prep/_components/analytics/OrdersDrawer';
import type { DrillRef, Insight, WarehouseReport } from '@/app/lib/analytics/report';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import { cn } from '@/lib/utils';
import styles from '../../live.module.css';
import { Panel, PanelSkeleton } from '../primitives';
import { useUrlParam } from '../useUrlParam';
import { AgeHistogram, FlowChart, Heatmap, StageBreakdown } from './charts';
import { HeroKpis } from './HeroKpis';
import { Carriers, Exceptions, PackingErrors, Shortages } from './QualityPanels';
import { TeamTable } from './TeamTable';

const PRESETS: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: '7d', label: '7 أيام' },
  { key: '30d', label: '30 يوماً' },
  { key: 'month', label: 'هذا الشهر' },
  { key: 'custom', label: 'فترة محددة' },
];

const todayRiyadh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const stampFormat = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit' });

/**
 * «التحليلات»: the warehouse report. Is the 24h promise kept, is the warehouse
 * keeping up, where the time goes, who and when, and what goes wrong, each
 * compared with the period before and each opening the orders behind it.
 */
export function ReportView({ shipping }: { shipping: ShippingBoardData | null }) {
  const [preset, setPreset] = useUrlParam('p', 'today');
  const [fromParam, setFrom] = useUrlParam('from');
  const [toParam, setTo] = useUrlParam('to');
  const [fallbackDay] = useState(todayRiyadh);
  const from = fromParam ?? fallbackDay;
  const to = toParam ?? from;
  const [report, setReport] = useState<WarehouseReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillRef | null>(null);

  const periodQuery = useMemo(() => {
    const params = new URLSearchParams({ preset: preset ?? 'today' });
    if (preset === 'custom') {
      params.set('from', from);
      params.set('to', to);
    }
    return params.toString();
  }, [from, preset, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/order-prep/v2/analytics?view=report&${periodQuery}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'تعذر تحميل التقرير');
      setReport(body.report);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل التقرير');
    } finally {
      setLoading(false);
    }
  }, [periodQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  // What is left to ship right now (the live board), for "days to clear". Orders
  // under review are left out: they are waiting on someone else, not on us.
  const backlog = shipping ? shipping.companies.reduce((total, row) => total + row.inPrep + row.awaitingLabel + row.labelReady + row.problem, 0) : null;

  const scrollTo = (id: string) => document.getElementById(`report-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className={cn('min-h-0 flex-1 space-y-4 overflow-y-auto pb-6', styles.scroll)}>
      {/* Toolbar */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-panel-solid)] px-3 py-2 shadow-sm backdrop-blur">
        <CalendarRange className="h-4 w-4 text-[#8b6f47]" />
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setPreset(entry.key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-bold transition',
                preset === entry.key ? 'bg-[var(--lv-strong)] text-[var(--lv-strong-ink)] shadow' : 'text-[var(--lv-muted)] hover:bg-[var(--lv-chip)]',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <span className="flex flex-wrap items-center gap-1 text-xs">
            <input
              type="date"
              value={from}
              max={todayRiyadh()}
              onChange={(event) => setFrom(event.target.value || null)}
              className="rounded-lg border border-[var(--lv-line)] bg-[var(--lv-card)] px-2 py-1 text-[var(--lv-ink)]"
            />
            ←
            <input
              type="date"
              value={to}
              max={todayRiyadh()}
              onChange={(event) => setTo(event.target.value || null)}
              className="rounded-lg border border-[var(--lv-line)] bg-[var(--lv-card)] px-2 py-1 text-[var(--lv-ink)]"
            />
          </span>
        )}
        <div className="mr-auto flex items-center gap-2 text-[11px] text-[var(--lv-muted)]">
          {report && (
            <span className="hidden sm:inline">
              مقارنة بـ <b className="text-[var(--lv-ink2)]">{report.previous.label}</b> · حُدّث {stampFormat.format(new Date(report.generatedAt))}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            aria-label="تحديث التقرير"
            title="تحديث التقرير"
            className="rounded-lg p-1.5 text-[var(--lv-muted)] transition hover:bg-[var(--lv-chip)] hover:text-[var(--lv-ink)]"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
          {error}
        </p>
      )}

      {!report ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="h-56 animate-pulse rounded-3xl bg-[#3b2f22]/80 xl:col-span-2" />
          <PanelSkeleton rows={5} />
          <PanelSkeleton rows={5} />
        </div>
      ) : (
        <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
          <HeroKpis report={report} backlog={backlog} onDrill={setDrill} />

          <Insights insights={report.insights} onDrill={setDrill} onTarget={scrollTo} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Section id="flow" className="xl:col-span-3">
              <Panel title="التوازن بين الوارد والصادر" Icon={TrendingUp} delay={80}>
                <div className="p-3">
                  <FlowChart flow={report.flow} granularity={report.granularity} />
                </div>
              </Panel>
            </Section>
            <Section id="stages" className="xl:col-span-2">
              <Panel title="أين يذهب وقت الطلب؟" Icon={Workflow} delay={140}>
                <div className="p-3">
                  <StageBreakdown report={report} onDrill={setDrill} />
                </div>
              </Panel>
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Section id="age" className="xl:col-span-2">
              <Panel title="عمر الطلب عند الشحن" Icon={Clock4} delay={180}>
                <div className="p-3">
                  <AgeHistogram report={report} onDrill={setDrill} />
                </div>
              </Panel>
            </Section>
            <Section id="heatmap" className="xl:col-span-3">
              <Panel title="متى تأتي الطلبات ومتى نعمل؟" Icon={Flame} delay={220}>
                <div className="p-3">
                  <Heatmap heatmap={report.heatmap} days={report.period.days} />
                </div>
              </Panel>
            </Section>
          </div>

          <Section id="team">
            <Panel title="أداء الفريق" Icon={Users} delay={260}>
              <div className="p-3">
                <TeamTable report={report} onDrill={setDrill} />
              </div>
            </Panel>
          </Section>

          <Section id="quality">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
              <Panel title="أخطاء التجهيز (من المرتجعات)" Icon={ShieldCheck} count={report.quality.wrongItem + report.quality.defective} delay={300}>
                <PackingErrors report={report} onDrill={setDrill} />
              </Panel>
              <Panel title="النقص" Icon={PackageX} count={report.shortages.count} delay={340}>
                <Shortages report={report} onDrill={setDrill} />
              </Panel>
              <Panel
                title="الاستثناءات والأعطال"
                Icon={AlertOctagon}
                tone={report.failures.shipping > 0 ? 'danger' : undefined}
                count={report.failures.shipping + report.failures.syncFailed + report.failures.syncConflict}
                delay={380}
              >
                <Exceptions report={report} onDrill={setDrill} />
              </Panel>
              <Panel title="شركات الشحن" Icon={Truck} count={report.carriers.length} delay={420}>
                <Carriers report={report} />
              </Panel>
            </div>
          </Section>
        </div>
      )}

      <OrdersDrawer
        kind={drill?.kind ?? 'prep'}
        periodQuery={periodQuery}
        request={drill ? { title: drill.title, filter: drill.filter } : null}
        onClose={() => setDrill(null)}
      />
    </div>
  );
}

function Section({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  return (
    <div id={`report-${id}`} className={cn('min-w-0 scroll-mt-16', className)}>
      {children}
    </div>
  );
}

const TONES: Record<Insight['tone'], { Icon: LucideIcon; box: string; icon: string; label: string }> = {
  danger: { Icon: AlertOctagon, box: 'border-rose-200 bg-rose-50', icon: 'bg-rose-600 text-white', label: 'عاجل' },
  warn: { Icon: Lightbulb, box: 'border-amber-200 bg-amber-50', icon: 'bg-amber-500 text-white', label: 'يحتاج انتباه' },
  info: { Icon: Info, box: 'border-sky-200 bg-sky-50', icon: 'bg-sky-600 text-white', label: 'ملاحظة' },
  good: { Icon: CircleCheck, box: 'border-emerald-200 bg-emerald-50', icon: 'bg-emerald-600 text-white', label: 'جيد' },
};

/** «ماذا نفعل الآن؟»: the few things worth acting on, worst first. */
function Insights({ insights, onDrill, onTarget }: { insights: Insight[]; onDrill: (drill: DrillRef) => void; onTarget: (id: string) => void }) {
  if (insights.length === 0) return null;
  return (
    <section aria-label="ماذا نفعل الآن؟" className={cn(styles.enter, 'space-y-2')} style={{ animationDelay: '60ms' }}>
      <h2 className="flex items-center gap-2 px-1 text-sm font-black text-[var(--lv-ink)]">
        <Lightbulb className="h-4 w-4 text-[#8b6f47]" /> ماذا نفعل الآن؟
      </h2>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {insights.map((insight) => {
          const tone = TONES[insight.tone];
          const clickable = Boolean(insight.drill || insight.target);
          return (
            <button
              key={insight.key}
              type="button"
              disabled={!clickable}
              onClick={() => (insight.drill ? onDrill(insight.drill) : insight.target ? onTarget(insight.target) : undefined)}
              className={cn('flex items-start gap-3 rounded-2xl border p-3 text-right transition', tone.box, clickable && 'hover:shadow-md hover:-translate-y-px')}
            >
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', tone.icon)}>
                <tone.Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-[10px] font-bold uppercase text-[var(--lv-muted)]">{tone.label}</span>
                <span className="block text-sm font-extrabold leading-snug text-[var(--lv-ink)]">{insight.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--lv-ink2)]">{insight.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
