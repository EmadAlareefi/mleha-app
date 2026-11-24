'use client';

import type { ReactNode } from 'react';
import { formatDuration } from '@/app/lib/analytics/stats';
import type { WarehouseReport } from '@/app/lib/analytics/report';
import { cn } from '@/lib/utils';
import type { OpenDrill } from './format';

function Stat({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'danger' | 'warn' | 'good';
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border p-2.5 text-right',
        tone === 'danger' ? 'border-rose-200 bg-rose-50' : tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-[var(--lv-line2)] bg-[var(--lv-card)]',
        onClick && 'transition hover:border-[var(--lv-faint)] hover:shadow-sm',
      )}
    >
      <span className="truncate text-[11px] text-[var(--lv-muted)]">{label}</span>
      <span className="text-xl font-black tabular-nums text-[var(--lv-ink)]">{value}</span>
      {sub && <span className="truncate text-[10px] text-[var(--lv-faint)]">{sub}</span>}
    </Tag>
  );
}

function ShareRow({ label, sub, count, share, onClick }: { label: string; sub?: string; count: number; share: number; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full rounded-lg px-2 py-1.5 text-right transition hover:bg-[var(--lv-hover)]">
      <span className="flex items-center gap-2 text-xs">
        <bdi className="min-w-0 flex-1 truncate font-semibold text-[var(--lv-ink)]">{label}</bdi>
        <b className="tabular-nums text-[var(--lv-ink)]">{count}</b>
        <span className="w-10 text-left text-[10px] tabular-nums text-[var(--lv-faint)]">{share}%</span>
      </span>
      {sub && <span className="block truncate text-[10px] text-[var(--lv-faint)]">{sub}</span>}
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--lv-track)]">
        <span className="block h-full rounded-full bg-[var(--rp-packed)]" style={{ width: `${Math.min(100, share)}%`, transition: 'width 700ms' }} />
      </span>
    </button>
  );
}

/** Packing mistakes the customers found, traced back to who packed. */
export function PackingErrors({ report, onDrill }: { report: WarehouseReport; onDrill: OpenDrill }) {
  const q = report.quality;
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="منتج خاطئ / 1000"
          value={q.wrongPer1000 ?? '—'}
          sub={`${q.wrongItem} مرتجع`}
          tone={(q.wrongPer1000 ?? 0) >= 5 ? 'danger' : (q.wrongPer1000 ?? 0) >= 2 ? 'warn' : undefined}
          onClick={() => onDrill({ kind: 'prep', title: 'مرتجع: منتج خاطئ', filter: { metric: 'returns_wrong_item' } })}
        />
        <Stat
          label="معيب / 1000"
          value={q.defectivePer1000 ?? '—'}
          sub={`${q.defective} مرتجع`}
          onClick={() => onDrill({ kind: 'prep', title: 'مرتجع: معيب / تالف', filter: { metric: 'returns_defective' } })}
        />
        <Stat
          label="نسبة المرتجع"
          value={q.returnPct === null ? '—' : `${q.returnPct}%`}
          sub={`${q.returns} من ${q.packed}`}
          onClick={() => onDrill({ kind: 'prep', title: 'مرتجعات الطلبات المجهزة', filter: { metric: 'returns' } })}
        />
      </div>
      {q.byPacker.length > 0 ? (
        <ul className="space-y-1">
          {q.byPacker.map((row) => (
            <li key={row.name}>
              <button
                type="button"
                onClick={() => onDrill({ kind: 'prep', title: `${row.name} — مرتجع: منتج خاطئ`, filter: { metric: 'returns_wrong_item', person: row.name } })}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition hover:bg-[var(--lv-hover)]"
              >
                <span className="min-w-0 flex-1 truncate text-right font-semibold text-[var(--lv-ink)]">{row.name}</span>
                <span className="tabular-nums text-[var(--lv-muted)]">
                  خاطئ <b className="text-[var(--lv-ink)]">{row.wrong}</b> · معيب <b className="text-[var(--lv-ink)]">{row.defective}</b> من {row.packed}
                </span>
                <span className="w-16 text-left font-black tabular-nums text-[var(--lv-ink)]">{row.per1000 ?? '—'}‰</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">لا مرتجعات بسبب خطأ أو عيب على طلبات هذه الفترة حتى الآن.</p>
      )}
      <p className="text-[10px] text-[var(--lv-faint)]">
        يُقاس على الطلبات المجهّزة في الفترة. يتأخر أياماً: المرتجعات تصل بعد استلام العميل، فأرقام الأيام الأخيرة ستزيد.
      </p>
    </div>
  );
}

/** Missing items: how often, why, and which SKUs to fix first. */
export function Shortages({ report, onDrill }: { report: WarehouseReport; onDrill: OpenDrill }) {
  const s = report.shortages;
  const all = () => onDrill({ kind: 'prep', title: 'النقص المُبلغ عنه', filter: { metric: 'shortages' } });
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="قطع ناقصة" value={s.count} sub={`في ${s.orders} طلب`} onClick={all} />
        <Stat label="لكل 100 طلب" value={s.per100 ?? '—'} sub="طلبات فيها نقص" tone={(s.per100 ?? 0) >= 5 ? 'warn' : undefined} onClick={all} />
        <Stat label="لم تُغلق" value={s.open} sub="بانتظار قرار" tone={s.open > 0 ? 'warn' : undefined} onClick={all} />
      </div>
      {s.byReason.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {s.byReason.map((reason) => (
            <span key={reason.key} className="rounded-full bg-[var(--lv-chip)] px-2.5 py-1 text-[11px] font-semibold text-[var(--lv-ink2)]">
              {reason.label} <b className="tabular-nums text-[var(--lv-ink)]">{reason.count}</b>
            </span>
          ))}
        </div>
      )}
      {s.topSkus.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-bold text-[var(--lv-ink2)]">الأصناف الأكثر نقصاً — ابدؤوا بها</p>
          {s.topSkus.map((sku) => (
            <ShareRow
              key={sku.sku}
              label={sku.name || sku.sku}
              sub={sku.name ? sku.sku : undefined}
              count={sku.count}
              share={sku.share}
              onClick={() => onDrill({ kind: 'prep', title: `نقص: ${sku.name || sku.sku}`, filter: { metric: 'shortages', sku: sku.sku } })}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">لا نقص مُبلغ عنه في هذه الفترة.</p>
      )}
    </div>
  );
}

/** Exceptions raised and the integrations that failed. */
export function Exceptions({ report, onDrill }: { report: WarehouseReport; onDrill: OpenDrill }) {
  const { exceptions, failures } = report;
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="استثناءات التجهيز"
          value={exceptions.count}
          sub="طلبات أُخرجت من التجهيز"
          onClick={() => onDrill({ kind: 'prep', title: 'المشاكل المسجلة', filter: { metric: 'problems' } })}
        />
        <Stat
          label="شحن فاشل أو موقوف"
          value={failures.shipping}
          tone={failures.shipping > 0 ? 'danger' : 'good'}
          onClick={() => onDrill({ kind: 'shipping', title: 'فشل أو موقوف', filter: { metric: 'failed' } })}
        />
        <Stat label="تحديث سلة فاشل" value={failures.syncFailed} sub={`${failures.syncConflict} تعارض`} tone={failures.syncFailed + failures.syncConflict > 0 ? 'warn' : undefined} />
        <Stat
          label="انتظار البوليصة من سلة"
          value={formatDuration(failures.labelWaitMedianSec)}
          sub={`90% ≤ ${formatDuration(failures.labelWaitP90Sec)}`}
          onClick={() => onDrill({ kind: 'shipping', title: 'من طلب الشحنة حتى وصول البوليصة', filter: { metric: 'labelWait', subset: 'measured' } })}
        />
      </div>
      {exceptions.byReason.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-bold text-[var(--lv-ink2)]">أسباب الاستثناءات</p>
          {exceptions.byReason.map((reason) => (
            <ShareRow
              key={reason.key}
              label={reason.label}
              count={reason.count}
              share={Math.round((reason.count / Math.max(1, exceptions.count)) * 100)}
              onClick={() => onDrill({ kind: 'prep', title: 'المشاكل المسجلة', filter: { metric: 'problems' } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Per carrier: volume, and how many of its orders left within the promise. */
export function Carriers({ report }: { report: WarehouseReport }) {
  if (report.carriers.length === 0) return <p className="p-4 text-center text-sm text-[var(--lv-muted)]">لا بوالص في هذه الفترة.</p>;
  return (
    <div className="space-y-2 p-3">
      {report.carriers.map((carrier) => (
        <div key={carrier.name} className="rounded-xl border border-[var(--lv-line2)] bg-[var(--lv-card)] p-2.5">
          <div className="flex items-center gap-2">
            <bdi className="min-w-0 flex-1 truncate text-sm font-extrabold text-[var(--lv-ink)]">{carrier.name}</bdi>
            <span className="text-xs tabular-nums text-[var(--lv-muted)]">
              <b className="text-[var(--lv-ink)]">{carrier.count}</b> · {carrier.share}%
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--lv-track)]">
            <div className="h-full rounded-full bg-[#a08560]" style={{ width: `${carrier.share}%`, transition: 'width 700ms' }} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-[var(--lv-muted)]">
            <span>
              في الموعد
              <b
                className={cn(
                  'block text-sm tabular-nums',
                  carrier.onTimePct === null ? 'text-[var(--lv-ink)]' : carrier.onTimePct >= 90 ? 'text-emerald-700' : carrier.onTimePct >= 75 ? 'text-amber-700' : 'text-rose-700',
                )}
              >
                {carrier.onTimePct === null ? '—' : `${carrier.onTimePct}%`}
              </b>
            </span>
            <span>
              عمر الطلب
              <b className="block text-sm tabular-nums text-[var(--lv-ink)]">{formatDuration(carrier.medianPlacedToPrintedSec)}</b>
            </span>
            <span>
              تجهيز ← طباعة
              <b className="block text-sm tabular-nums text-[var(--lv-ink)]">{formatDuration(carrier.medianPackedToPrintedSec)}</b>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
