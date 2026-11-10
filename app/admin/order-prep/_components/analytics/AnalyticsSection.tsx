'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Loader2, RefreshCcw } from 'lucide-react';
import { formatDuration } from '@/app/lib/analytics/stats';
import type { AnalyticsKind, AnalyticsSummary, DrillFilter } from '@/app/lib/analytics/types';
import { cn } from '@/lib/utils';
import { OrdersDrawer, type DrillRequest } from './OrdersDrawer';

const PRESETS: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'اليوم' },
  { key: 'yesterday', label: 'أمس' },
  { key: '7d', label: 'آخر 7 أيام' },
  { key: 'custom', label: 'فترة محددة' },
];

const todayRiyadh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

/**
 * Analytics for a board: time per order and friends. Every number opens the
 * orders behind it; each order expands to its step-by-step timeline.
 */
export function AnalyticsSection({ kind }: { kind: AnalyticsKind }) {
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState(todayRiyadh);
  const [to, setTo] = useState(todayRiyadh);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillRequest, setDrillRequest] = useState<DrillRequest | null>(null);

  const periodQuery = useMemo(() => {
    const params = new URLSearchParams({ preset });
    if (preset === 'custom') {
      params.set('from', from);
      params.set('to', to);
    }
    return params.toString();
  }, [from, preset, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/order-prep/v2/analytics?kind=${kind}&view=summary&${periodQuery}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'تعذر تحميل التحليلات');
      setSummary(body.summary);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل التحليلات');
    } finally {
      setLoading(false);
    }
  }, [kind, periodQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (title: string, filter: DrillFilter) => setDrillRequest({ title, filter });
  const personLabel = kind === 'prep' ? 'المجهِّز' : 'الشاحن';
  const bucketTotal = summary?.buckets.reduce((sum, bucket) => sum + bucket.count, 0) ?? 0;

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <BarChart3 className="h-4 w-4" /> التحليلات
        </h2>
        <div className="mr-auto flex flex-wrap items-center gap-1.5">
          {PRESETS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setPreset(entry.key)}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold', preset === entry.key && 'bg-foreground text-background')}
            >
              {entry.label}
            </button>
          ))}
          {preset === 'custom' && (
            <span className="flex items-center gap-1 text-xs">
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-md border bg-background px-2 py-1" />
              →
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-md border bg-background px-2 py-1" />
            </span>
          )}
          <button type="button" onClick={() => void load()} className="rounded-full border p-1.5" aria-label="تحديث">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {!summary ? (
        <Loader2 className="mx-auto my-8 h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <div className={cn('space-y-4', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {summary.tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={() => open(tile.label, tile.filter)}
                className={cn(
                  'rounded-xl border p-3 text-right transition hover:border-foreground/40 hover:shadow-sm',
                  tile.tone === 'warn' && 'border-amber-300 bg-amber-50',
                  tile.tone === 'danger' && 'border-red-300 bg-red-50',
                )}
              >
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                <p className="text-2xl font-black">{tile.value}</p>
                {tile.sub && <p className="text-[11px] text-muted-foreground">{tile.sub}</p>}
              </button>
            ))}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">توزيع {summary.mainMetricLabel}</p>
            <div className="flex h-9 overflow-hidden rounded-lg border">
              {summary.buckets.map((bucket, index) => {
                const share = bucketTotal ? bucket.count / bucketTotal : 0;
                if (bucket.count === 0) return null;
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    title={`${bucket.label}: ${bucket.count}`}
                    onClick={() => open(`${summary.mainMetricLabel}: ${bucket.label}`, bucket.filter)}
                    style={{ width: `${Math.max(share * 100, 4)}%` }}
                    className={cn('flex items-center justify-center border-l text-[11px] font-bold text-white last:border-l-0', bucketColor(bucket.key, index))}
                  >
                    {bucket.count}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
              {summary.buckets.map((bucket, index) => (
                <button
                  key={bucket.key}
                  type="button"
                  onClick={() => open(`${summary.mainMetricLabel}: ${bucket.label}`, bucket.filter)}
                  className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-right text-[11px] hover:bg-muted"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', bucketColor(bucket.key, index))} />
                  <bdi className="min-w-0 flex-1 truncate text-muted-foreground">{bucket.label}</bdi>
                  <b className="text-foreground">{bucket.count}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-right">
                  <th className="py-1.5">{personLabel}</th>
                  <th>الطلبات</th>
                  <th>المتوسط</th>
                  <th>الوسيط</th>
                  <th>90%</th>
                  <th>طلب/ساعة</th>
                  {kind === 'prep' && <th>المسح</th>}
                  <th>الأبطأ</th>
                  <th>توقف</th>
                </tr>
              </thead>
              <tbody>
                {summary.people.map((person) => {
                  const cell = (label: string, filter: Omit<DrillFilter, 'metric' | 'person'>) => () =>
                    open(`${person.name} — ${label}`, { metric: summary.mainMetric, person: person.name, ...filter });
                  return (
                    <tr key={person.name} className="border-t">
                      <td className="py-2 font-semibold">{person.name}</td>
                      <Cell onClick={cell('كل الطلبات', { subset: 'all' })}>{person.count}</Cell>
                      <Cell onClick={cell(summary.mainMetricLabel, { subset: 'measured' })}>{formatDuration(person.avgSec)}</Cell>
                      <Cell onClick={cell(summary.mainMetricLabel, { subset: 'measured' })}>{formatDuration(person.medianSec)}</Cell>
                      <Cell onClick={cell(summary.mainMetricLabel, { subset: 'measured' })}>{formatDuration(person.p90Sec)}</Cell>
                      <Cell onClick={cell(summary.mainMetricLabel, { subset: 'measured' })}>{person.perHour ?? '—'}</Cell>
                      {kind === 'prep' && (
                        <Cell onClick={cell('طلبات بالمسح', { subset: 'scanned' })}>{person.scanPct !== null ? `${person.scanPct}%` : '—'}</Cell>
                      )}
                      <Cell onClick={cell('الأبطأ', { subset: 'measured' })}>{formatDuration(person.maxSec)}</Cell>
                      <Cell onClick={cell('فترات التوقف', { subset: 'breaks' })}>{person.breaks}</Cell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {summary.people.length === 0 && <p className="py-3 text-sm text-muted-foreground">لا توجد بيانات في هذه الفترة.</p>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {kind === 'prep'
              ? 'وقت التجهيز: من ظهور الطلب على الشاشة حتى "تم". أكثر من 30 دقيقة يُعد توقفاً ولا يدخل في المتوسط.'
              : 'وقت الشاحن: الفرق بين بوليصتين متتاليتين لنفس الشاحن. أكثر من 10 دقائق يُعد توقفاً ولا يدخل في المتوسط.'}
          </p>
        </div>
      )}

      <OrdersDrawer kind={kind} periodQuery={periodQuery} request={drillRequest} onClose={() => setDrillRequest(null)} />
    </section>
  );
}

const BUCKET_COLORS = ['bg-emerald-600', 'bg-emerald-500', 'bg-lime-500', 'bg-amber-500', 'bg-orange-500', 'bg-red-500'];
/** Same colour for a bucket's bar segment and its legend chip. */
function bucketColor(key: string, index: number) {
  return key === 'break' ? 'bg-slate-400' : BUCKET_COLORS[index] ?? 'bg-red-600';
}

function Cell({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <td>
      <button type="button" onClick={onClick} className="rounded px-1 font-semibold underline-offset-4 hover:underline">
        {children}
      </button>
    </td>
  );
}
