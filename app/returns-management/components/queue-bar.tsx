'use client';

import { useEffect, useRef } from 'react';
import type { QueueTab } from '@/app/lib/returns/stage-filters';
import { cn } from '@/lib/utils';

export const QUEUES: Array<{ key: QueueTab; label: string; hint: string }> = [
  { key: 'ready', label: 'جاهز للمعالجة', hint: 'وصلت وتم فحص جميع القطع. اعتمديها لتنفيذ الاسترجاع والمخزون والكوبون.' },
  { key: 'needs_attention', label: 'يحتاج تدخل', hint: 'خطوة لم تكتمل تلقائياً أو تحتاج قرارك. افتحي الطلب لمعرفة السبب.' },
  { key: 'received', label: 'بانتظار الفحص', hint: 'وصلت للمستودع ولم يكتمل فحص القطع.' },
  { key: 'in_transit', label: 'في الطريق', hint: 'بانتظار استلام الشحنة من العميل أو في الطريق إلينا.' },
  { key: 'completed', label: 'مكتمل', hint: '' },
  { key: 'closed', label: 'ملغي', hint: '' },
  { key: 'all', label: 'الكل', hint: '' },
];

interface QueueBarProps {
  value: QueueTab;
  counts: Partial<Record<QueueTab, number>>;
  onChange: (queue: QueueTab) => void;
}

/** One row of queue chips that scrolls sideways on phones; the active one stays in view. */
export function QueueBar({ value, counts, onChange }: QueueBarProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  return (
    <div
      role="tablist"
      aria-label="مراحل الطلبات"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {QUEUES.map((tab) => {
        const active = tab.key === value;
        const count = counts[tab.key];
        const alert = tab.key === 'needs_attention' && Boolean(count);
        const ready = tab.key === 'ready' && Boolean(count);
        return (
          <button
            key={tab.key}
            ref={active ? activeRef : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
              active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted',
            )}
          >
            {tab.label}
            {count !== undefined && (
              <span
                className={cn(
                  'min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums',
                  active
                    ? 'bg-primary-foreground/20'
                    : alert
                      ? 'bg-red-600 text-white'
                      : ready
                        ? 'bg-emerald-600 text-white'
                        : 'bg-muted text-muted-foreground',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
