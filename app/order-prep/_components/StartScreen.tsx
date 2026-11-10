'use client';

import { Loader2, PackageOpen, Play } from 'lucide-react';
import type { QueueStats } from '@/app/lib/order-prep/types';
import { formatAgeAr, orderAgeMs } from '@/app/lib/order-prep/riyadh-time';
import { cn } from '@/lib/utils';

export function StartScreen({
  stats,
  myCompletedToday,
  starting,
  empty,
  onStart,
}: {
  stats: QueueStats | null;
  myCompletedToday: number;
  starting: boolean;
  /** The last start found nothing to pack. */
  empty: boolean;
  onStart: () => void;
}) {
  const oldestAge = orderAgeMs(stats?.oldestPlacedAt ?? null);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-8 text-center">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">تجهيز الطلبات</p>
        <h1 className="text-2xl font-extrabold text-foreground">جاهز للتجهيز؟</h1>
      </div>

      <div className="grid w-full max-w-sm grid-cols-3 gap-2">
        <Stat label="بالانتظار" value={stats ? stats.waiting.toLocaleString('ar-SA') : '—'} />
        <Stat
          label="أقدم طلب"
          value={formatAgeAr(oldestAge)}
          tone={oldestAge !== null && oldestAge > 48 * 3_600_000 ? 'danger' : 'default'}
        />
        <Stat label="أنجزت اليوم" value={myCompletedToday.toLocaleString('ar-SA')} />
      </div>

      {empty && (
        <div className="flex w-full max-w-sm items-center gap-3 rounded-xl border bg-card p-4 text-right">
          <PackageOpen className="h-6 w-6 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            لا توجد طلبات جاهزة للتجهيز الآن. ستظهر الطلبات الجديدة تلقائياً.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="flex h-16 w-full max-w-sm items-center justify-center gap-3 rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg active:scale-[0.98] disabled:opacity-70"
      >
        {starting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Play className="h-6 w-6" />}
        ابدأ التجهيز
      </button>
      <p className="max-w-sm text-xs text-muted-foreground">
        يُعطى أقدم طلب أولاً. يبقى الطلب محجوزاً لك ما دامت الصفحة مفتوحة، ويعود للقائمة تلقائياً إذا أُغلقت لفترة.
      </p>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <div className={cn('rounded-xl border bg-card px-2 py-3', tone === 'danger' && 'border-red-300 bg-red-50')}>
      <div className={cn('text-lg font-bold', tone === 'danger' ? 'text-red-700' : 'text-foreground')}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
