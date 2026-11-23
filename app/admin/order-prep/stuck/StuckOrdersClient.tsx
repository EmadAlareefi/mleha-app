'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Hand, Loader2, RefreshCcw, Search, X } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { THRESHOLD_OPTIONS, parseThreshold } from '@/app/lib/stuck-orders/threshold';
import type { ActionTarget, StuckCategory, StuckItem, StuckOrdersResult } from '@/app/lib/stuck-orders/types';
import { cn } from '@/lib/utils';
import { CategoryTiles } from './_components/CategoryTiles';
import { ACTION_META, CATEGORY_META, THRESHOLD_LABELS } from './_components/labels';
import { OrderJourneySheet } from './_components/OrderJourneySheet';
import { StuckOrderCard } from './_components/StuckOrderCard';

const REFRESH_MS = 60_000;
const PAGE_SIZE = 40;

export default function StuckOrdersClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();

  const q = params.get('q') ?? '';
  const threshold = parseThreshold(params.get('t'));
  const category = (params.get('cat') as StuckCategory | null) || null;
  const showHeld = params.get('held') === '1';
  const openOrderId = params.get('open');

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    if (draft.trim() === q) return;
    const timer = window.setTimeout(() => setParams({ q: draft.trim() || null, open: null }), 350);
    return () => window.clearTimeout(timer);
  }, [draft, q, setParams]);

  const [result, setResult] = useState<StuckOrdersResult | null>(null);
  const [searchItems, setSearchItems] = useState<StuckItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState<{ item: StuckItem; target: ActionTarget } | null>(null);
  const autoOpened = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ threshold: String(threshold) });
      if (q) query.set('q', q);
      const response = await fetch(`/api/admin/stuck-orders?${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'تعذر التحميل');
      if (q) {
        setSearchItems(data.search.items);
      } else {
        setSearchItems(null);
        setResult(data.result);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر التحميل');
    } finally {
      setLoading(false);
    }
  }, [q, threshold]);

  useEffect(() => {
    void load();
    if (q) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, q]);

  useEffect(() => setLimit(PAGE_SIZE), [category, threshold, showHeld]);

  // A search that finds exactly one order opens it straight away.
  useEffect(() => {
    if (!q || !searchItems || autoOpened.current === q) return;
    const orderIds = new Set(searchItems.map((item) => item.orderId));
    if (orderIds.size === 1) {
      autoOpened.current = q;
      setParams({ open: searchItems[0].orderId });
    }
  }, [q, searchItems, setParams]);

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text).then(
        () => toast({ description: `نُسخ ${text}` }),
        () => undefined,
      );
    },
    [toast],
  );

  const runAction = useCallback(async () => {
    if (!pending) return;
    const { target } = pending;
    setPending(null);
    setBusy(true);
    try {
      const response = await fetch('/api/admin/stuck-orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'تعذر تنفيذ الإجراء');
      toast({ description: data.message || 'تم' });
      setRefreshKey((key) => key + 1);
      await load();
    } catch (err) {
      toast({ variant: 'destructive', description: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء' });
    } finally {
      setBusy(false);
    }
  }, [load, pending, toast]);

  const visible = useMemo(() => {
    if (searchItems) return searchItems;
    if (!result) return [];
    return result.items.filter((item) => {
      if (Boolean(item.diagnosis.held) !== showHeld) return false;
      return !category || item.diagnosis.category === category;
    });
  }, [category, result, searchItems, showHeld]);

  const total = result ? result.items.length - result.heldCount : 0;
  const searching = Boolean(q);

  return (
    <div className="space-y-5 pb-10">
      {/* Search + threshold: sticky so it stays reachable on phones. */}
      <div className="sticky top-0 z-20 -mx-4 space-y-3 bg-background/90 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 right-4 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            inputMode="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="ابحث عن أي طلب: رقم الطلب، البوليصة، الجوال، اسم العميل…"
            className="h-14 w-full rounded-2xl border bg-card pr-12 pl-12 text-base shadow-sm outline-none transition focus:border-[#8b6f47] focus:ring-4 focus:ring-[#8b6f47]/15"
            aria-label="بحث"
          />
          {draft && (
            <button
              type="button"
              aria-label="مسح البحث"
              onClick={() => {
                setDraft('');
                setParams({ q: null, open: null });
              }}
              className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!searching && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">عالق أكثر من</span>
              <div className="flex rounded-xl border bg-card p-1 shadow-sm" role="radiogroup" aria-label="مدة التعليق">
                {THRESHOLD_OPTIONS.map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    role="radio"
                    aria-checked={threshold === hours}
                    onClick={() => setParams({ t: hours === 24 ? null : String(hours) })}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                      threshold === hours ? 'bg-[#8b6f47] text-white shadow' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {THRESHOLD_LABELS[hours]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {result && result.heldCount > 0 && (
                <button
                  type="button"
                  onClick={() => setParams({ held: showHeld ? null : '1', cat: null })}
                  className={cn(
                    'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition',
                    showHeld ? 'border-sky-300 bg-sky-50 text-sky-800' : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Hand className="h-4 w-4" /> معلّقة عمداً ({result.heldCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => void load()}
                className="flex items-center gap-1.5 rounded-xl border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} تحديث
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {!searching && result && !showHeld && (
        <CategoryTiles counts={result.counts} total={total} selected={category} onSelect={(cat) => setParams({ cat })} />
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">
            {searching
              ? `نتائج البحث عن «${q}»`
              : showHeld
                ? 'طلبات معلّقة عمداً (لا تشحن / تعديل العميل)'
                : category
                  ? CATEGORY_META[category].label
                  : 'كل الطلبات العالقة'}
          </h2>
          {!loading && <span className="text-sm text-muted-foreground tabular-nums">{visible.length} طلب</span>}
        </div>

        {(searching ? !searchItems : !result) ? (
          <div className="space-y-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-44 w-full rounded-2xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyResult searching={searching} />
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              {visible.slice(0, limit).map((item) => (
                <StuckOrderCard
                  key={item.key}
                  item={item}
                  busy={busy}
                  onOpen={(selected) => setParams({ open: selected.orderId })}
                  onAction={(selected, target) => setPending({ item: selected, target })}
                  onCopy={copy}
                />
              ))}
            </div>
            {visible.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((value) => value + PAGE_SIZE)}
                className="mx-auto block rounded-xl border bg-card px-5 py-2 text-sm font-medium hover:bg-muted"
              >
                عرض المزيد ({visible.length - limit})
              </button>
            )}
          </>
        )}
      </section>

      <OrderJourneySheet
        orderId={openOrderId}
        threshold={threshold}
        refreshKey={refreshKey}
        busy={busy}
        onClose={() => setParams({ open: null })}
        onAction={(item, target) => setPending({ item, target })}
        onCopy={copy}
      />

      <ConfirmationDialog
        open={Boolean(pending)}
        title={pending ? `${ACTION_META[pending.target.action].label} — #${pending.item.orderNumber ?? pending.item.orderId}` : ''}
        message={pending ? ACTION_META[pending.target.action].confirm : ''}
        confirmLabel={pending ? ACTION_META[pending.target.action].label : 'تأكيد'}
        confirmVariant={pending && ACTION_META[pending.target.action].danger ? 'danger' : 'primary'}
        onConfirm={() => void runAction()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function EmptyResult({ searching }: { searching: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center">
      <span className="text-5xl">{searching ? '🔍' : '🎉'}</span>
      <p className="mt-3 text-lg font-bold">{searching ? 'لم نجد طلباً بهذا البحث' : 'لا توجد طلبات عالقة'}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {searching ? 'جرّب رقم الطلب كاملاً، أو رقم البوليصة، أو آخر أرقام الجوال.' : 'كل الطلبات تتحرك في المستودع كما يجب.'}
      </p>
    </div>
  );
}
