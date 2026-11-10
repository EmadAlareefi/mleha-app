'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, Loader2, MoreHorizontal, RefreshCw, Search, ShieldAlert, ShieldCheck, Truck, Zap } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useToast } from '@/components/ui/use-toast';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { QueueTab } from '@/app/lib/returns/stage-filters';
import { ProcessDialog } from './process-dialog';
import { QUEUES, QueueBar } from './queue-bar';
import { RequestCard } from './request-card';
import { RequestDetailSheet } from './request-detail-sheet';
import { WindowOverrideDialog } from './window-override-dialog';
import { useReturnsUrlState, type TypeFilter } from './use-returns-url-state';
import type { ReturnRequest } from './types';

const PAGE_SIZE = 50;
const BULK_LIMIT = 20;

interface PermissionInfo {
  merchantId: string;
  known: boolean;
  missing: Array<{ scope: string; label: string }>;
}

export function ReturnsManagementView() {
  const { data: session } = useSession();
  const canManage = hasServiceAccess(session, 'returns-management');
  const { toast } = useToast();
  const { state, navigate, openRequest, closeRequest } = useReturnsUrlState();

  const [searchInput, setSearchInput] = useState(state.q);
  const [requests, setRequests] = useState<ReturnRequest[]>([]);
  const [counts, setCounts] = useState<Partial<Record<QueueTab, number>>>({});
  const [missingShipmentCount, setMissingShipmentCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processRequest, setProcessRequest] = useState<ReturnRequest | null>(null);
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const notify = useCallback(
    (message: string, variant: 'default' | 'destructive' = 'default') =>
      toast({ title: variant === 'destructive' ? 'تعذر التنفيذ' : 'تم', description: message, variant }),
    [toast],
  );

  // Search box → URL, debounced. URL → search box only when the URL changed by
  // itself (back / forward), never while the box is being typed into.
  const pushedQuery = useRef(state.q);
  useEffect(() => {
    if (state.q !== pushedQuery.current) {
      pushedQuery.current = state.q;
      setSearchInput(state.q);
    }
  }, [state.q]);
  useEffect(() => {
    const query = searchInput.trim();
    if (query === pushedQuery.current) return;
    const timer = setTimeout(() => {
      pushedQuery.current = query;
      navigate({ q: query, page: 1 });
    }, 350);
    return () => clearTimeout(timer);
  }, [navigate, searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(state.page), limit: String(PAGE_SIZE), counts: '1' });
      if (state.missing) params.set('shipment', 'missing');
      else params.set('queue', state.queue);
      if (state.type !== 'all') params.append('type', state.type);
      if (state.q) params.set('search', state.q);
      const response = await fetch(`/api/returns/list?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشل جلب طلبات الإرجاع');
      setRequests(data.data);
      setCounts(data.queueCounts || {});
      setMissingShipmentCount(data.missingShipmentCount ?? 0);
      setTotalPages(Math.max(1, data.pagination?.totalPages ?? 1));
      setSelected((previous) => new Set([...previous].filter((id) => data.data.some((row: ReturnRequest) => row.id === id))));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [state.missing, state.page, state.q, state.queue, state.type]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    fetch('/api/returns/salla-permissions')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.merchants && setPermissions(data.merchants))
      .catch(() => undefined);
  }, [canManage]);

  const missingScopes = useMemo(
    () => Array.from(new Map(permissions.flatMap((p) => p.missing).map((m) => [m.scope, m])).values()),
    [permissions],
  );
  const readyRows = requests.filter((request) => request.stage === 'ready');
  const activeQueue = QUEUES.find((q) => q.key === state.queue);
  const openRow = state.open ? requests.find((request) => request.id === state.open) ?? null : null;

  const toggleSelect = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < BULK_LIMIT) next.add(id);
      return next;
    });

  const runBulk = async () => {
    const ids = [...selected].slice(0, BULK_LIMIT);
    if (ids.length === 0) return;
    setBulkRunning(true);
    try {
      const response = await fetch('/api/returns/process/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnRequestIds: ids }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشلت المعالجة الجماعية');
      const results: Array<{ outcome: string }> = data.results || [];
      const done = results.filter((r) => r.outcome === 'completed').length;
      const attention = results.filter((r) => r.outcome === 'needs_attention' || r.outcome === 'failed').length;
      const skipped = results.filter((r) => r.outcome === 'skipped').length;
      notify(
        `اكتمل ${done}` +
          (attention ? ` • يحتاج تدخل ${attention}` : '') +
          (skipped ? ` • تُرك ${skipped} للمراجعة الفردية (عليه تنبيهات)` : ''),
        attention ? 'destructive' : 'default',
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'حدث خطأ', 'destructive');
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <AppPageShell
      title="الإرجاع والاستبدال"
      subtitle="الطلبات تتقدم تلقائياً مع الشحن والفحص — اعتمدي الجاهز وعالجي ما يحتاج تدخل"
      contentClassName="flex flex-1 flex-col gap-3 p-4 pb-28 md:gap-4 md:p-6"
    >
      {/* Header actions: everything on desktop, a menu on phones */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> تحديث
        </Button>
        <Button size="sm" asChild className="h-10 bg-orange-600 text-white hover:bg-orange-700 md:h-8">
          <Link href="/returns-priority">
            <Zap /> عالية الأولوية
          </Link>
        </Button>
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="outline" size="sm" asChild>
            <Link href="/local-shipping/tracking">
              <Truck /> تتبع الشحنات المحلية
            </Link>
          </Button>
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setOverridesOpen(true)}>
              <ShieldCheck /> استثناء مدة الإرجاع
            </Button>
          )}
        </div>
        <DropdownMenu dir="rtl">
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-10 md:hidden" aria-label="المزيد">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem className="min-h-11" asChild>
              <Link href="/local-shipping/tracking">تتبع الشحنات المحلية</Link>
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem className="min-h-11" onSelect={() => setOverridesOpen(true)}>
                استثناء مدة الإرجاع
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {missingScopes.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <ShieldAlert className="size-4" />
          <AlertDescription>
            تطبيق سلة يحتاج صلاحيات إضافية لتنفيذ المعالجة تلقائياً: {missingScopes.map((m) => m.label).join('، ')}. فعّلي الصلاحيات في
            بوابة شركاء سلة ثم أعيدي ربط المتجر. حتى ذلك، تتحول الخطوات المتأثرة إلى &quot;يحتاج تدخل&quot;.
          </AlertDescription>
        </Alert>
      )}

      {(missingShipmentCount > 0 || state.missing) && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {missingShipmentCount} طلب بدون شحنة مرتجع لأكثر من 30 دقيقة — أنشئي البوليصة في سلة ثم «تحديث من سلة».
          </span>
          <Button
            size="sm"
            className="h-10 md:h-8"
            variant={state.missing ? 'outline' : 'default'}
            onClick={() => navigate({ missing: !state.missing, page: 1 })}
          >
            {state.missing ? 'العودة للقوائم' : 'عرضها'}
          </Button>
        </div>
      )}

      {/* Queues + search, sticky on phones */}
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-background/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        {!state.missing && (
          <QueueBar
            value={state.queue}
            counts={counts}
            onChange={(queue) => {
              setSelected(new Set());
              navigate({ queue, page: 1 });
            }}
          />
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="رقم الطلب، الاسم، الجوال، التتبع…"
              aria-label="بحث"
              className="h-11 bg-card pr-9 md:h-9"
            />
          </div>
          <NativeSelect
            aria-label="نوع الطلب"
            value={state.type}
            onChange={(event) => navigate({ type: event.target.value as TypeFilter, page: 1 })}
            className="h-11 w-32 bg-card md:h-9 md:w-40"
          >
            <option value="all">كل الأنواع</option>
            <option value="return">فيها استرجاع</option>
            <option value="exchange">فيها استبدال</option>
          </NativeSelect>
        </div>
      </div>

      {activeQueue?.hint && !state.missing && <p className="text-sm text-muted-foreground">{activeQueue.hint}</p>}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && requests.length === 0 ? (
        <LoadingState />
      ) : requests.length === 0 ? (
        <EmptyState
          title={
            state.queue === 'ready'
              ? 'لا توجد طلبات جاهزة للمعالجة 🎉'
              : state.queue === 'needs_attention'
                ? 'لا يوجد ما يحتاج تدخل'
                : 'لا توجد طلبات'
          }
        />
      ) : (
        <div className={`space-y-2 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              selectable={state.queue === 'ready' && request.stage === 'ready' && !state.missing}
              selected={selected.has(request.id)}
              busy={bulkRunning && selected.has(request.id)}
              onToggleSelect={() => toggleSelect(request.id)}
              onOpen={() => openRequest(request.id)}
              onProcess={() => setProcessRequest(request)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3" aria-label="الصفحات">
          <Button variant="outline" className="h-10 md:h-8" size="sm" disabled={state.page === 1} onClick={() => navigate({ page: state.page - 1 })}>
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {state.page} من {totalPages}
          </span>
          <Button
            variant="outline"
            className="h-10 md:h-8"
            size="sm"
            disabled={state.page >= totalPages}
            onClick={() => navigate({ page: state.page + 1 })}
          >
            التالي
          </Button>
        </nav>
      )}

      {/* Bulk processing: a bar pinned to the bottom while pieces are selected */}
      {state.queue === 'ready' && readyRows.length > 0 && !state.missing && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] shadow-lg backdrop-blur md:sticky md:bottom-4 md:mx-0 md:rounded-xl md:border md:pb-3">
          <div className="mx-auto flex max-w-5xl items-center gap-2">
            <Button
              variant="outline"
              className="h-11 shrink-0 md:h-9"
              onClick={() =>
                setSelected((previous) =>
                  previous.size > 0 ? new Set() : new Set(readyRows.slice(0, BULK_LIMIT).map((row) => row.id)),
                )
              }
            >
              {selected.size > 0 ? 'إلغاء التحديد' : `تحديد ${Math.min(readyRows.length, BULK_LIMIT)}`}
            </Button>
            <Button
              className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700 md:h-9"
              disabled={selected.size === 0 || bulkRunning}
              onClick={runBulk}
            >
              {bulkRunning ? <Loader2 className="animate-spin" /> : null}
              {selected.size > 0 ? `اعتماد ومعالجة ${selected.size}` : 'حدّدي الطلبات السليمة'}
            </Button>
          </div>
        </div>
      )}

      <RequestDetailSheet
        requestId={state.open}
        initial={openRow}
        onClose={closeRequest}
        onListChanged={() => void load()}
        notify={notify}
      />

      <ProcessDialog
        request={processRequest}
        onClose={() => setProcessRequest(null)}
        onDone={({ completed, message }) => {
          setProcessRequest(null);
          notify(message, completed ? 'default' : 'destructive');
          void load();
        }}
      />

      <WindowOverrideDialog open={overridesOpen} onOpenChange={setOverridesOpen} onChanged={() => void load()} />
    </AppPageShell>
  );
}
