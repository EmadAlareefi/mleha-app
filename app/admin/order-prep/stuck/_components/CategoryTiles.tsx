import { Layers } from 'lucide-react';
import type { CategorySummary, StuckCategory } from '@/app/lib/stuck-orders/types';
import { cn } from '@/lib/utils';
import { CATEGORY_META, CATEGORY_ORDER, formatAge } from './labels';

type Props = {
  counts: Partial<Record<StuckCategory, CategorySummary>>;
  total: number;
  selected: StuckCategory | null;
  onSelect: (category: StuckCategory | null) => void;
};

/** One tile per kind of stuck, plus "all". Tap to filter. */
export function CategoryTiles({ counts, total, selected, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex flex-col justify-between rounded-2xl bg-[#3b2f22] p-3.5 text-right text-white shadow-sm transition hover:shadow-md',
          selected === null ? 'ring-2 ring-[#8b6f47] ring-offset-2 ring-offset-background' : 'opacity-90 hover:opacity-100',
        )}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Layers className="h-4 w-4" /> كل العالقة
        </span>
        <span className="mt-2 text-3xl font-extrabold tabular-nums">{total}</span>
        <span className="text-[11px] text-white/60">اضغط أي بطاقة للتصفية</span>
      </button>
      {CATEGORY_ORDER.map((category) => {
        const meta = CATEGORY_META[category];
        const summary = counts[category];
        const count = summary?.count ?? 0;
        const active = selected === category;
        return (
          <button
            key={category}
            type="button"
            disabled={count === 0 && !active}
            onClick={() => onSelect(active ? null : category)}
            className={cn(
              'relative flex flex-col rounded-2xl border bg-card p-3.5 text-right shadow-sm transition',
              count === 0 ? 'cursor-default opacity-45' : 'hover:-translate-y-0.5 hover:shadow-md',
              active && cn('ring-2 ring-offset-2 ring-offset-background', meta.ring),
            )}
          >
            {(summary?.critical ?? 0) > 0 && (
              <span className="absolute top-2.5 left-2.5 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {summary!.critical} حرجة
              </span>
            )}
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', meta.chip)}>
              <meta.Icon className="h-4 w-4" />
            </span>
            <span className="mt-2 text-2xl font-extrabold tabular-nums">{count}</span>
            <span className="text-sm leading-tight font-bold">{meta.label}</span>
            <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
              {count > 0 ? `أقدمها منذ ${formatAge(summary?.oldestAgeMs ?? null)}` : meta.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
