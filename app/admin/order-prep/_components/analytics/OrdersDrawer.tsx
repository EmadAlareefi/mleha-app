'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, Package } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDuration } from '@/app/lib/analytics/stats';
import type { AnalyticsKind, DrillFilter, DrillResponse, DrillRow, OrderItemsDetail } from '@/app/lib/analytics/types';
import { cn } from '@/lib/utils';

export type DrillRequest = { title: string; filter: DrillFilter };

const timeFormat = new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
  timeZone: 'Asia/Riyadh',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const formatTime = (iso: string | null) => (iso ? timeFormat.format(new Date(iso)) : '—');

/** The orders behind a clicked number, slowest first, each expandable to its timeline. */
export function OrdersDrawer({
  kind,
  periodQuery,
  request,
  onClose,
}: {
  kind: AnalyticsKind;
  periodQuery: string;
  request: DrillRequest | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<DrillResponse | null>(null);
  const [rows, setRows] = useState<DrillRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'duration' | 'time'>('duration');

  const load = useCallback(
    async (offset: number) => {
      if (!request) return;
      setLoading(true);
      try {
        const params = new URLSearchParams(periodQuery);
        params.set('kind', kind);
        params.set('view', 'orders');
        params.set('metric', request.filter.metric);
        if (request.filter.subset) params.set('subset', request.filter.subset);
        if (request.filter.bucket) params.set('bucket', request.filter.bucket);
        if (request.filter.person) params.set('person', request.filter.person);
        params.set('sort', sort);
        params.set('offset', String(offset));
        const response = await fetch(`/api/order-prep/v2/analytics?${params}`, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'تعذر التحميل');
        setData(body.result);
        setRows((current) => (offset === 0 ? body.result.rows : [...current, ...body.result.rows]));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر التحميل');
      } finally {
        setLoading(false);
      }
    },
    [kind, periodQuery, request, sort],
  );

  useEffect(() => {
    if (request) void load(0);
    else {
      setData(null);
      setRows([]);
    }
  }, [load, request]);

  return (
    <Sheet open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-xl" dir="rtl">
        <SheetHeader className="text-right">
          <SheetTitle>{request?.title}</SheetTitle>
          <SheetDescription>
            {data
              ? `${data.count} طلب${data.avgSec !== null ? ` · المتوسط ${formatDuration(data.avgSec)} · الوسيط ${formatDuration(data.medianSec)}` : ''}`
              : 'جاري التحميل…'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">الترتيب:</span>
          {(['duration', 'time'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSort(value)}
              className={cn('rounded-full border px-3 py-1 font-semibold', sort === value && 'bg-foreground text-background')}
            >
              {value === 'duration' ? 'الأطول أولاً' : 'الأحدث أولاً'}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <ul className="mt-3 divide-y rounded-xl border">
          {rows.map((row) => (
            <DrillRowItem key={`${row.orderId}:${row.at}`} row={row} metricLabel={data?.metricLabel ?? ''} />
          ))}
          {rows.length === 0 && !loading && <li className="p-4 text-sm text-muted-foreground">لا توجد طلبات.</li>}
        </ul>
        {loading && <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-muted-foreground" />}
        {data?.nextOffset != null && !loading && (
          <button
            type="button"
            onClick={() => void load(data.nextOffset!)}
            className="mt-3 w-full rounded-xl border py-2 text-sm font-semibold"
          >
            عرض المزيد
          </button>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrillRowItem({ row, metricLabel }: { row: DrillRow; metricLabel: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OrderItemsDetail | null>(null);
  const [itemsError, setItemsError] = useState(false);

  useEffect(() => {
    if (!open || items || itemsError) return;
    void (async () => {
      try {
        const response = await fetch(`/api/order-prep/v2/analytics?view=items&orderId=${encodeURIComponent(row.orderId)}`, {
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error();
        setItems(body.detail);
      } catch {
        setItemsError(true);
      }
    })();
  }, [items, itemsError, open, row.orderId]);

  const slow = row.isBreak || (row.valueSec !== null && row.valueSec > 300);
  return (
    <li>
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2.5 text-right">
        <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
        <span className="font-mono text-sm font-bold">#{row.orderNumber}</span>
        <span className="truncate text-xs text-muted-foreground">{row.person ?? '—'}</span>
        <span className="mr-auto flex items-center gap-2">
          {row.isBreak && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">توقف</span>}
          {row.valueSec !== null && (
            <span className={cn('text-sm font-black', slow ? 'text-red-700' : 'text-foreground')}>{formatDuration(row.valueSec)}</span>
          )}
          <span className="text-[11px] text-muted-foreground">{formatTime(row.at)}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-3 bg-muted/40 px-4 pb-4 pt-1 text-sm">
          {row.valueSec !== null && (
            <p className="text-xs text-muted-foreground">
              {metricLabel}: <b className="text-foreground">{formatDuration(row.valueSec)}</b>
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {row.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold">
                {tag}
              </span>
            ))}
          </div>
          {row.note && <p className="rounded-lg bg-background p-2 text-xs">{row.note}</p>}
          <Timeline steps={row.timeline} />
          <div>
            {!items && !itemsError && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {itemsError && <p className="text-xs text-red-700">تعذر تحميل المنتجات</p>}
            {items && (
              <ul className="space-y-2">
                {items.items.map((item, index) => (
                  <li key={`${item.sku}:${index}`} className="flex items-center gap-2">
                    <span className="relative h-14 w-11 shrink-0 overflow-hidden rounded-md bg-background">
                      {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={item.name} fill unoptimized sizes="44px" className="object-cover" />
                      ) : (
                        <Package className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-xs font-semibold">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[item.size && `مقاس ${item.size}`, item.color, `×${item.quantity}`, item.sku].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {items?.sallaUrl && (
              <a
                href={items.sallaUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700"
              >
                <ExternalLink className="h-3.5 w-3.5" /> فتح الطلب في سلة
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Each step with its time and how long it took since the previous one. */
function Timeline({ steps }: { steps: DrillRow['timeline'] }) {
  let previous: number | null = null;
  return (
    <ol className="space-y-1.5 border-r-2 border-border pr-3">
      {steps.map((step) => {
        const at = step.at ? Date.parse(step.at) : null;
        const delta = at !== null && previous !== null ? (at - previous) / 1000 : null;
        if (at !== null) previous = at;
        return (
          <li key={step.label} className={cn('flex items-baseline gap-2 text-xs', at === null && 'opacity-40')}>
            <span className="font-semibold">{step.label}</span>
            {step.by && <span className="text-muted-foreground">{step.by}</span>}
            <span className="mr-auto text-muted-foreground">{formatTime(step.at)}</span>
            {delta !== null && delta >= 0 && <span className="w-16 text-left font-bold">+{formatDuration(delta)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
