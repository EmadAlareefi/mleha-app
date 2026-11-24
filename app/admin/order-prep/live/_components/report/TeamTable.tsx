'use client';

import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, Download } from 'lucide-react';
import { formatDuration } from '@/app/lib/analytics/stats';
import type { TeamRow, WarehouseReport } from '@/app/lib/analytics/report';
import type { AnalyticsKind, DrillFilter } from '@/app/lib/analytics/types';
import { cn } from '@/lib/utils';
import { Sparkline } from '../primitives';
import type { OpenDrill } from './format';

type Column = {
  key: keyof TeamRow;
  label: string;
  hint: string;
  /** Which end is best (for the highlight); 'none' = no highlight. */
  best: 'high' | 'low' | 'none';
  show: (row: TeamRow) => string;
  drill?: { title: string; filter: Omit<DrillFilter, 'person'> };
};

const dur = (value: number | null) => formatDuration(value);

function columns(kind: AnalyticsKind, scanEnabled: boolean): Column[] {
  const metric = kind === 'prep' ? 'pack' : 'gap';
  const base: Column[] = [
    {
      key: 'count',
      label: kind === 'prep' ? 'الطلبات' : 'البوالص',
      hint: 'كل ما أنجزه في الفترة',
      best: 'high',
      show: (row) => String(row.count),
      drill: { title: 'كل الطلبات', filter: { metric, subset: 'all' } },
    },
    { key: 'workingHours', label: 'ساعات العمل', hint: 'مجموع وقت العمل الفعلي (دون فترات التوقف)', best: 'none', show: (row) => row.workingHours.toFixed(1) },
    {
      key: 'perHour',
      label: 'طلب/ساعة',
      hint: 'الإنتاجية: طلبات لكل ساعة عمل فعلية',
      best: 'high',
      show: (row) => (row.perHour === null ? '—' : row.perHour.toFixed(1)),
      drill: { title: 'الوقت لكل طلب', filter: { metric, subset: 'measured' } },
    },
    {
      key: 'medianSec',
      label: 'الوسيط',
      hint: 'نصف طلباته أسرع من هذا',
      best: 'low',
      show: (row) => dur(row.medianSec),
      drill: { title: 'الوقت لكل طلب', filter: { metric, subset: 'measured' } },
    },
    {
      key: 'p90Sec',
      label: '90%',
      hint: '9 من كل 10 طلبات أسرع من هذا — يكشف التذبذب',
      best: 'low',
      show: (row) => dur(row.p90Sec),
      drill: { title: 'الأبطأ', filter: { metric, subset: 'slow' } },
    },
  ];
  const prep: Column[] = [
    ...(scanEnabled
      ? [
          {
            key: 'scanPct',
            label: 'المسح',
            hint: 'نسبة الطلبات المؤكدة بمسح الباركود',
            best: 'high',
            show: (row: TeamRow) => (row.scanPct === null ? '—' : `${row.scanPct}%`),
            drill: { title: 'طلبات بدون مسح', filter: { metric: 'pack', subset: 'manual' } },
          } satisfies Column,
        ]
      : []),
    {
      key: 'shortages',
      label: 'نقص',
      hint: 'قطع أبلغ أنها غير موجودة أو تالفة',
      best: 'none',
      show: (row) => String(row.shortages ?? 0),
      drill: { title: 'النقص المُبلغ عنه', filter: { metric: 'shortages' } },
    },
    {
      key: 'wrongItems',
      label: 'منتج خاطئ',
      hint: 'مرتجعات «منتج خاطئ» على طلبات جهّزها (تتأخر أياماً)',
      best: 'low',
      show: (row) => String(row.wrongItems ?? 0),
      drill: { title: 'مرتجع: منتج خاطئ', filter: { metric: 'returns_wrong_item' } },
    },
  ];
  const breaks: Column = {
    key: 'breaks',
    label: 'توقف',
    hint: kind === 'prep' ? 'فجوات أطول من 30 دقيقة' : 'فجوات أطول من 10 دقائق',
    best: 'none',
    show: (row) => String(row.breaks),
    drill: { title: 'فترات التوقف', filter: { metric, subset: 'breaks' } },
  };
  return kind === 'prep' ? [...base, ...prep, breaks] : [...base, breaks];
}

/** The team, sortable, best value per column marked, a daily trend per person. Every cell opens its orders. */
export function TeamTable({ report, onDrill }: { report: WarehouseReport; onDrill: OpenDrill }) {
  const [kind, setKind] = useState<AnalyticsKind>('prep');
  const [sortKey, setSortKey] = useState<keyof TeamRow>('count');
  const [asc, setAsc] = useState(false);
  const rows = kind === 'prep' ? report.team.packers : report.team.shippers;
  const cols = useMemo(() => columns(kind, report.scanEnabled), [kind, report.scanEnabled]);
  const maxCount = Math.max(1, ...rows.map((row) => row.count));

  const sorted = useMemo(() => {
    const value = (row: TeamRow) => {
      const raw = row[sortKey];
      return typeof raw === 'number' ? raw : raw === null ? null : String(raw);
    };
    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (left === null) return 1;
      if (right === null) return -1;
      const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'ar');
      return asc ? order : -order;
    });
  }, [asc, rows, sortKey]);

  // Best per column, among people with enough orders to mean something.
  const best = useMemo(() => {
    const pool = rows.filter((row) => row.count >= Math.max(5, maxCount * 0.1));
    const out = new Map<string, number>();
    for (const col of cols) {
      if (col.best === 'none') continue;
      const values = pool.map((row) => row[col.key]).filter((value): value is number => typeof value === 'number');
      if (values.length < 2) continue;
      out.set(String(col.key), col.best === 'high' ? Math.max(...values) : Math.min(...values));
    }
    return out;
  }, [cols, maxCount, rows]);

  const sortBy = (key: keyof TeamRow) => {
    if (key === sortKey) setAsc(!asc);
    else {
      setSortKey(key);
      setAsc(false);
    }
  };

  const exportCsv = () => {
    const header = ['الاسم', ...cols.map((col) => col.label)];
    const lines = sorted.map((row) => [row.name, ...cols.map((col) => col.show(row))]);
    const csv = [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `team-${kind}-${report.period.key.replace(/[^a-z0-9]+/gi, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-[var(--lv-chip)] p-0.5">
          {(['prep', 'shipping'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setKind(value);
                setSortKey('count');
                setAsc(false);
              }}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-bold transition',
                kind === value ? 'bg-[var(--lv-card)] text-[var(--lv-ink)] shadow-sm' : 'text-[var(--lv-muted)]',
              )}
            >
              {value === 'prep' ? `المجهِّزون (${report.team.packers.length})` : `الشاحنون (${report.team.shippers.length})`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="mr-auto flex items-center gap-1.5 rounded-lg border border-[var(--lv-line)] px-2.5 py-1 text-[11px] font-bold text-[var(--lv-ink2)] transition hover:bg-[var(--lv-hover)] disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" /> تصدير CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--lv-muted)]">لا توجد بيانات في هذه الفترة.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-right text-[11px] text-[var(--lv-muted)]">
                <th className="py-2 pl-2 font-semibold">الاسم</th>
                {cols.map((col) => (
                  <th key={String(col.key)} className="px-1 py-2 font-semibold" title={col.hint}>
                    <button type="button" onClick={() => sortBy(col.key)} className="flex items-center gap-1 hover:text-[var(--lv-ink)]">
                      {col.label}
                      {sortKey === col.key && <ArrowDownWideNarrow className={cn('h-3 w-3', asc && 'rotate-180')} />}
                    </button>
                  </th>
                ))}
                <th className="px-1 py-2 font-semibold" title="العدد اليومي (أو بالساعة لليوم الواحد)">
                  الاتجاه
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, index) => (
                <tr key={row.name} className="border-t border-[var(--lv-line2)] hover:bg-[var(--lv-hover)]">
                  <td className="py-2 pl-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black',
                          index === 0 && sortKey === 'count' && !asc ? 'bg-[#e8c896] text-[#3b2f22]' : 'bg-[var(--lv-chip)] text-[var(--lv-muted)]',
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="font-bold text-[var(--lv-ink)]">{row.name}</span>
                    </span>
                  </td>
                  {cols.map((col) => {
                    const value = row[col.key];
                    const isBest = typeof value === 'number' && best.get(String(col.key)) === value;
                    const content = (
                      <span className="relative flex flex-col">
                        <span className={cn('tabular-nums', isBest ? 'font-black text-emerald-700' : 'font-semibold text-[var(--lv-ink)]')}>
                          {col.show(row)}
                          {isBest && <span className="mr-1 text-[10px]">★</span>}
                        </span>
                        {col.key === 'count' && (
                          <span className="mt-0.5 h-1 w-full max-w-16 overflow-hidden rounded-full bg-[var(--lv-track)]">
                            <span className="block h-full rounded-full bg-[#c9a97a]" style={{ width: `${(row.count / maxCount) * 100}%` }} />
                          </span>
                        )}
                      </span>
                    );
                    return (
                      <td key={String(col.key)} className="px-1 py-2">
                        {col.drill ? (
                          <button
                            type="button"
                            onClick={() => onDrill({ kind, title: `${row.name} — ${col.drill!.title}`, filter: { ...col.drill!.filter, person: row.name } })}
                            className="rounded px-1 text-right underline-offset-4 hover:underline"
                          >
                            {content}
                          </button>
                        ) : (
                          <span className="px-1">{content}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-2">
                    <Sparkline values={row.daily} width={72} height={20} color="#b08850" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[var(--lv-muted)]">
        ★ الأفضل في العمود بين من أنجز عدداً كافياً. اضغط أي رقم لترى طلباته. «منتج خاطئ» يتأخر لأن المرتجعات تصل بعد أيام.
      </p>
    </div>
  );
}
