'use client';

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import Image from 'next/image';
import { CalendarClock, CheckSquare, Loader2, Minus, Plus, RefreshCcw, Search, Trash2, X } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useToast } from '@/components/ui/use-toast';
import { addDays, arabicDays, daysBetween, riyadhToday, RESTOCK_ETA_MAX_DAYS } from '@/app/lib/restock-eta';

type SlimProduct = { i: string; n: string; s: string; m: string; q: number | null; o: boolean };
type Filter = 'out' | 'set' | 'expired' | 'all';
type Snapshot = { products: SlimProduct[]; etas: Record<string, string>; today: string };

const CACHE_KEY = 'restock-eta:v1';
const PAGE_SIZE = 60;
const QUICK_DAYS = [7, 14, 21, 30, 45, 60, 90];

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'out', label: 'نافدة' },
  { key: 'set', label: 'لها موعد' },
  { key: 'expired', label: 'انتهى موعدها' },
  { key: 'all', label: 'الكل' },
];

function readCache(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    return Array.isArray(parsed?.products) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(snapshot: Snapshot) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota or private mode: the page still works, it just loads from network next time.
  }
}

/** Loose Arabic/Latin matching: ignores hamza forms, taa marbuta, and digit script. */
function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ْـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function customerText(days: number) {
  return `نتوقع توفّره خلال ${arabicDays(days)}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/* ---------------- row ---------------- */

type RowProps = {
  product: SlimProduct;
  days: number | null; // null = no ETA; <=0 = expired
  selecting: boolean;
  selected: boolean;
  onOpen: (product: SlimProduct) => void;
  onToggle: (id: string) => void;
};

const ProductRow = memo(function ProductRow({ product, days, selecting, selected, onOpen, onToggle }: RowProps) {
  return (
    <li className="[contain-intrinsic-size:auto_72px] [content-visibility:auto]">
      <button
        type="button"
        onClick={() => (selecting ? onToggle(product.i) : onOpen(product))}
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-right transition-colors active:bg-stone-100 ${
          selected ? 'bg-violet-50' : ''
        }`}
      >
        {selecting && (
          <span
            aria-hidden
            className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
              selected ? 'border-violet-600 bg-violet-600 text-white' : 'border-stone-300 bg-white'
            }`}
          >
            {selected && <span className="text-xs leading-none">✓</span>}
          </span>
        )}
        <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-stone-100">
          {product.m && (
            <Image src={product.m} alt="" fill sizes="48px" className="object-cover" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium leading-5 text-stone-900">{product.n}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-500" dir="ltr">
            {product.o && (
              <span className="rounded bg-rose-50 px-1 py-px font-medium text-rose-600" dir="rtl">
                نافد
              </span>
            )}
            <span className="truncate">{product.s}</span>
          </span>
        </span>
        <EtaPill days={days} />
      </button>
    </li>
  );
});

function EtaPill({ days }: { days: number | null }) {
  if (days === null) {
    return (
      <span className="shrink-0 rounded-full border border-dashed border-stone-300 px-2.5 py-1 text-xs text-stone-400">
        + موعد
      </span>
    );
  }
  if (days <= 0) {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
        انتهى
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-violet-800">
      {days} يوم
    </span>
  );
}

/* ---------------- editor ---------------- */

type EditorProps = {
  open: boolean;
  title: string;
  subtitle: string;
  today: string;
  initialDays: number | null;
  canClear: boolean;
  onClose: () => void;
  onSave: (days: number) => void;
  onClear: () => void;
};

function EtaEditor({ open, title, subtitle, today, initialDays, canClear, onClose, onSave, onClear }: EditorProps) {
  const [days, setDays] = useState(initialDays && initialDays > 0 ? initialDays : 14);

  useEffect(() => {
    if (open) setDays(initialDays && initialDays > 0 ? initialDays : 14);
  }, [open, initialDays]);

  const clamp = (value: number) => Math.min(RESTOCK_ETA_MAX_DAYS, Math.max(1, Math.round(value) || 1));
  const date = addDays(today, days);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl p-0 pb-[max(1rem,env(safe-area-inset-bottom))]" dir="rtl">
        <SheetHeader className="px-4 pt-4 pb-1 text-right">
          <SheetTitle className="line-clamp-2 text-base">{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pt-2">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label="إنقاص يوم"
              onClick={() => setDays((value) => clamp(value - 1))}
              className="flex size-12 items-center justify-center rounded-xl bg-stone-100 active:bg-stone-200"
            >
              <Minus className="size-5" />
            </button>
            <label className="flex flex-1 flex-col items-center">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={RESTOCK_ETA_MAX_DAYS}
                value={days}
                onChange={(event) => setDays(clamp(Number(event.target.value)))}
                onFocus={(event) => event.target.select()}
                className="w-24 bg-transparent text-center text-4xl font-bold tabular-nums text-stone-900 outline-none"
                aria-label="عدد الأيام"
              />
              <span className="text-xs text-stone-500">يوم · {formatDate(date)}</span>
            </label>
            <button
              type="button"
              aria-label="زيادة يوم"
              onClick={() => setDays((value) => clamp(value + 1))}
              className="flex size-12 items-center justify-center rounded-xl bg-stone-100 active:bg-stone-200"
            >
              <Plus className="size-5" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {QUICK_DAYS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={`h-10 rounded-lg text-sm font-semibold tabular-nums transition-colors ${
                  days === value ? 'bg-violet-600 text-white' : 'bg-stone-100 text-stone-700 active:bg-stone-200'
                }`}
              >
                {value}
              </button>
            ))}
            <label className="relative flex h-10 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
              <CalendarClock className="size-4" />
              <span className="sr-only">اختر تاريخاً</span>
              <input
                type="date"
                min={addDays(today, 1)}
                max={addDays(today, RESTOCK_ETA_MAX_DAYS)}
                value={date}
                onChange={(event) => {
                  if (event.target.value) setDays(clamp(daysBetween(today, event.target.value)));
                }}
                className="absolute inset-0 opacity-0"
              />
            </label>
          </div>

          <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3">
            <div className="mb-1 text-[11px] font-medium text-violet-700">ما سيظهر للعميل</div>
            <div className="text-sm font-bold text-stone-900">{customerText(days)}</div>
            <div className="text-xs text-stone-500">المدة تقديرية وقد تتقدّم أو تتأخر قليلاً.</div>
          </div>

          <div className="flex gap-2">
            <Button className="h-12 flex-1 bg-violet-600 text-base hover:bg-violet-700" onClick={() => onSave(days)}>
              حفظ
            </Button>
            {canClear && (
              <Button variant="outline" className="h-12 text-rose-600" onClick={onClear}>
                <Trash2 className="size-4" />
                إزالة
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- page ---------------- */

export default function RestockEtaPage() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('out');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<SlimProduct[] | null>(null);
  const [, startTransition] = useTransition();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  const load = useCallback(async (refresh: boolean) => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/salla/restock-eta${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'تعذر تحميل المنتجات');
      const next: Snapshot = { products: data.products, etas: data.etas, today: data.today };
      setSnapshot(next);
      setError(null);
      writeCache(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المنتجات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Paint the last snapshot instantly, then revalidate in the background.
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setSnapshot(cached);
      setLoading(false);
    }
    void load(false);
  }, [load]);

  // Computed on the device rather than taken from the (possibly cached)
  // snapshot, so day counts stay right when the page is reopened tomorrow.
  const [today, setToday] = useState('');
  useEffect(() => setToday(riyadhToday()), [snapshot]);
  const etas = useMemo(() => snapshot?.etas ?? {}, [snapshot]);

  const daysFor = useCallback(
    (id: string): number | null => (etas[id] && today ? daysBetween(today, etas[id]) : null),
    [etas, today]
  );

  // Normalized search keys are computed once per catalog, not per keystroke.
  const indexed = useMemo(
    () => (snapshot?.products ?? []).map((product) => ({ product, key: normalizeSearch(`${product.n} ${product.s}`) })),
    [snapshot?.products]
  );

  const counts = useMemo(() => {
    const result = { out: 0, set: 0, expired: 0, all: indexed.length };
    for (const { product } of indexed) {
      const days = daysFor(product.i);
      if (product.o) result.out += 1;
      if (days !== null && days > 0) result.set += 1;
      if (days !== null && days <= 0) result.expired += 1;
    }
    return result;
  }, [indexed, daysFor]);

  const visible = useMemo(() => {
    const terms = normalizeSearch(deferredQuery).split(' ').filter(Boolean);
    const list = indexed.filter(({ product, key }) => {
      if (terms.length && !terms.every((term) => key.includes(term))) return false;
      const days = daysFor(product.i);
      if (filter === 'out') return product.o;
      if (filter === 'set') return days !== null && days > 0;
      if (filter === 'expired') return days !== null && days <= 0;
      return true;
    });
    // Sold-out products without a date are the to-do list: show them first.
    if (filter === 'out') {
      list.sort((a, b) => Number(daysFor(a.product.i) !== null) - Number(daysFor(b.product.i) !== null));
    } else if (filter === 'set') {
      list.sort((a, b) => (daysFor(a.product.i) ?? 0) - (daysFor(b.product.i) ?? 0));
    }
    return list.map((entry) => entry.product);
  }, [indexed, deferredQuery, filter, daysFor]);

  useEffect(() => setLimit(PAGE_SIZE), [deferredQuery, filter]);

  // Grow the rendered window as the user nears the end, instead of mounting
  // the whole catalog at once.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) startTransition(() => setLimit((value) => value + PAGE_SIZE));
      },
      { rootMargin: '800px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible.length, limit]);

  const openProduct = useCallback((product: SlimProduct) => setEditing([product]), []);
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const save = async (products: SlimProduct[], expectedDate: string | null) => {
    if (!snapshot) return;
    const previous = snapshot;
    const nextEtas = { ...snapshot.etas };
    for (const product of products) {
      if (expectedDate) nextEtas[product.i] = expectedDate;
      else delete nextEtas[product.i];
    }
    // Optimistic: close and update immediately, roll back if the server refuses.
    const optimistic = { ...snapshot, etas: nextEtas };
    setSnapshot(optimistic);
    setEditing(null);
    if (products.length > 1) exitSelecting();

    try {
      const response = await fetch('/api/salla/restock-eta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedDate,
          items: products.map((product) => ({ productId: product.i, productName: product.n, productSku: product.s })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || 'تعذر الحفظ');
      writeCache(optimistic);
      toast({
        description: expectedDate
          ? `تم الحفظ · ${products.length > 1 ? `${products.length} منتجات` : arabicDays(daysBetween(today, expectedDate))}`
          : 'تمت إزالة الموعد',
      });
    } catch (err) {
      setSnapshot(previous);
      toast({ description: err instanceof Error ? err.message : 'تعذر الحفظ', variant: 'destructive' });
    }
  };

  const selectAllVisible = () => setSelected(new Set(visible.map((product) => product.i)));

  const editingDays = editing?.length === 1 ? daysFor(editing[0].i) : null;
  const editingHasEta = editing?.some((product) => etas[product.i]) ?? false;

  return (
    <AppPageShell
      title="مواعيد توفر المنتجات"
      subtitle="المدة المتوقعة التي تظهر للعميل عند طلب أبلغني عند التوفر"
      contentClassName="flex flex-1 flex-col bg-stone-50 p-0"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col" dir="rtl">
        <div className="sticky top-0 z-10 space-y-2 border-b border-stone-200 bg-stone-50/95 px-3 pt-3 pb-2 backdrop-blur">
          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-stone-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث بالاسم أو SKU"
                className="h-11 w-full rounded-xl border border-stone-200 bg-white pr-9 pl-9 text-base outline-none focus:border-violet-400"
              />
              {query && (
                <button
                  type="button"
                  aria-label="مسح البحث"
                  onClick={() => setQuery('')}
                  className="absolute top-1/2 left-2 -translate-y-1/2 p-1 text-stone-400"
                >
                  <X className="size-4" />
                </button>
              )}
            </label>
            <button
              type="button"
              aria-label="تحديث من سلة"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="flex size-11 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 disabled:opacity-60"
            >
              <RefreshCcw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              aria-label="تحديد متعدد"
              aria-pressed={selecting}
              onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
              className={`flex size-11 items-center justify-center rounded-xl border ${
                selecting ? 'border-violet-600 bg-violet-600 text-white' : 'border-stone-200 bg-white text-stone-600'
              }`}
            >
              <CheckSquare className="size-4" />
            </button>
          </div>
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm transition-colors ${
                  filter === key ? 'bg-stone-900 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200'
                }`}
              >
                {label}
                <span className={`tabular-nums text-xs ${filter === key ? 'text-stone-300' : 'text-stone-400'}`}>
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>
          {selecting && (
            <div className="flex items-center justify-between text-xs text-stone-600">
              <span>اضغط على المنتجات لتحديدها</span>
              <button type="button" className="font-semibold text-violet-700" onClick={selectAllVisible}>
                تحديد الكل ({visible.length})
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-3 mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            {error}
            <button type="button" className="mr-2 font-semibold underline" onClick={() => void load(false)}>
              إعادة المحاولة
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-20 text-stone-500">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="py-20 text-center text-sm text-stone-500">لا توجد منتجات مطابقة</div>
        ) : (
          <ul className="divide-y divide-stone-100 bg-white pb-28">
            {visible.slice(0, limit).map((product) => (
              <ProductRow
                key={product.i}
                product={product}
                days={daysFor(product.i)}
                selecting={selecting}
                selected={selected.has(product.i)}
                onOpen={openProduct}
                onToggle={toggle}
              />
            ))}
            {limit < visible.length && <div ref={sentinelRef} className="h-px" />}
          </ul>
        )}

        {selecting && selected.size > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
            <div className="mx-auto flex max-w-2xl gap-2">
              <Button
                className="h-12 flex-1 bg-violet-600 text-base hover:bg-violet-700"
                onClick={() => {
                  const byId = new Map(snapshot?.products.map((product) => [product.i, product]));
                  setEditing(Array.from(selected, (id) => byId.get(id)).filter((p): p is SlimProduct => !!p));
                }}
              >
                تحديد موعد لـ {selected.size} منتج
              </Button>
              <Button variant="outline" className="h-12" onClick={exitSelecting}>
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* `today` is only known after mount; the editor formats dates from it. */}
      {today && (
      <EtaEditor
        open={!!editing}
        title={editing?.length === 1 ? editing[0].n : `${editing?.length ?? 0} منتجات`}
        subtitle={
          editing?.length === 1
            ? editingDays === null
              ? 'لا يوجد موعد حالياً'
              : editingDays <= 0
                ? 'انتهى الموعد السابق ولم يعد يظهر للعملاء'
                : `الموعد الحالي: ${formatDate(etas[editing[0].i])}`
            : 'سيتم تطبيق نفس الموعد على جميع المنتجات المحددة'
        }
        today={today}
        initialDays={editingDays}
        canClear={editingHasEta}
        onClose={() => setEditing(null)}
        onSave={(days) => editing && void save(editing, addDays(today, days))}
        onClear={() => editing && void save(editing, null)}
      />
      )}
    </AppPageShell>
  );
}
