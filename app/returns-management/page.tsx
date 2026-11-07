'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { QueueTab } from '@/app/lib/returns/stage-filters';
import { CouponAmountDialog } from './components/coupon-amount-dialog';
import { InspectorNotesDialog } from './components/inspector-notes-dialog';
import { ProcessDialog } from './components/process-dialog';
import { RequestDetailSheet } from './components/request-detail-sheet';
import { RequestRow } from './components/request-row';
import { WindowOverrideDialog } from './components/window-override-dialog';
import type { ReturnRequest } from './components/types';

const QUEUES: Array<{ key: QueueTab; label: string; hint: string }> = [
  { key: 'ready', label: 'جاهز للمعالجة', hint: 'وصلت وتم فحص جميع القطع. اعتمديها لتنفيذ الاسترجاع والمخزون والكوبون.' },
  { key: 'needs_attention', label: 'يحتاج تدخل', hint: 'خطوة لم تكتمل تلقائياً. افتحي الطلب لمعرفة السبب.' },
  { key: 'received', label: 'بانتظار الفحص', hint: 'وصلت للمستودع ولم يكتمل فحص القطع.' },
  { key: 'in_transit', label: 'في الطريق', hint: 'بانتظار استلام الشحنة من العميل أو في الطريق إلينا.' },
  { key: 'completed', label: 'مكتمل', hint: '' },
  { key: 'closed', label: 'ملغي', hint: '' },
  { key: 'all', label: 'الكل', hint: '' },
];

const PAGE_SIZE = 50;

interface PermissionInfo {
  merchantId: string;
  known: boolean;
  missing: Array<{ scope: string; label: string }>;
}

export default function ReturnsManagementPage() {
  const { data: session } = useSession();
  const canManage = hasServiceAccess(session, 'returns-management');
  const { toast } = useToast();

  const [queue, setQueue] = useState<QueueTab>('ready');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'return' | 'exchange'>('all');
  const [missingShipmentOnly, setMissingShipmentOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [requests, setRequests] = useState<ReturnRequest[]>([]);
  const [counts, setCounts] = useState<Partial<Record<QueueTab, number>>>({});
  const [missingShipmentCount, setMissingShipmentCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [processRequest, setProcessRequest] = useState<ReturnRequest | null>(null);
  const [couponRequest, setCouponRequest] = useState<ReturnRequest | null>(null);
  const [notesRequest, setNotesRequest] = useState<ReturnRequest | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const notify = useCallback(
    (message: string, variant: 'default' | 'destructive' = 'default') =>
      toast({ title: variant === 'destructive' ? 'تعذر التنفيذ' : 'تم', description: message, variant }),
    [toast],
  );

  // Debounced search.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), counts: '1' });
      if (missingShipmentOnly) params.set('shipment', 'missing');
      else params.set('queue', queue);
      if (typeFilter !== 'all') params.append('type', typeFilter);
      if (search) params.set('search', search);
      const response = await fetch(`/api/returns/list?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشل جلب طلبات الإرجاع');
      setRequests(data.data);
      setCounts(data.queueCounts || {});
      setMissingShipmentCount(data.missingShipmentCount ?? 0);
      setTotalPages(Math.max(1, data.pagination?.totalPages ?? 1));
      setSelected((previous) => new Set([...previous].filter((id) => data.data.some((r: ReturnRequest) => r.id === id))));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [missingShipmentOnly, page, queue, search, typeFilter]);

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
  const openRequest = requests.find((request) => request.id === openId) ?? null;
  const readyRows = requests.filter((request) => request.stage === 'ready');
  const activeQueue = QUEUES.find((q) => q.key === queue);

  const toggleSelect = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async () => {
    const ids = [...selected].slice(0, 20);
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
      title="إدارة طلبات الإرجاع والاستبدال"
      subtitle="الطلبات تتقدم تلقائياً مع الشحن والفحص — دورك اعتماد الجاهز ومعالجة ما يحتاج تدخل"
      contentClassName="flex flex-1 flex-col gap-4 p-4 md:p-6"
    >
      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/local-shipping/tracking">تتبع الشحنات المحلية</Link>
        </Button>
        {canManage && <WindowOverrideDialog />}
        <Button size="sm" asChild className="bg-orange-600 text-white hover:bg-orange-700">
          <Link href="/returns-priority">⚡ عالية الأولوية</Link>
        </Button>
      </div>

      {missingScopes.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-950">
          <ShieldAlert className="size-4" />
          <AlertDescription>
            تطبيق سلة يحتاج صلاحيات إضافية لتنفيذ المعالجة تلقائياً: {missingScopes.map((m) => m.label).join('، ')}. فعّلي
            الصلاحيات في بوابة شركاء سلة ثم أعيدي ربط المتجر. حتى ذلك، تتحول الخطوات المتأثرة إلى &quot;يحتاج تدخل&quot;.
          </AlertDescription>
        </Alert>
      )}

      {(missingShipmentCount > 0 || missingShipmentOnly) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {missingShipmentCount} طلب بدون شحنة مرتجع لأكثر من 30 دقيقة — أنشئي البوليصة في سلة ثم «تحديث من سلة».
          </span>
          <Button
            size="sm"
            variant={missingShipmentOnly ? 'outline' : 'default'}
            onClick={() => {
              setMissingShipmentOnly((value) => !value);
              setPage(1);
            }}
          >
            {missingShipmentOnly ? 'العودة للقوائم' : 'عرضها'}
          </Button>
        </div>
      )}

      {/* Queues */}
      {!missingShipmentOnly && (
        <Tabs
          value={queue}
          onValueChange={(value) => {
            setQueue(value as QueueTab);
            setPage(1);
            setSelected(new Set());
          }}
          dir="rtl"
        >
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
            {QUEUES.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="flex-none gap-2 px-3 py-1.5">
                {tab.label}
                {counts[tab.key] !== undefined && (
                  <Badge
                    variant="secondary"
                    className={
                      tab.key === 'ready' && counts.ready
                        ? 'bg-emerald-600 text-white'
                        : tab.key === 'needs_attention' && counts.needs_attention
                          ? 'bg-red-600 text-white'
                          : ''
                    }
                  >
                    {counts[tab.key]}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="رقم الطلب، اسم العميل، الجوال، رقم التتبع..."
            className="pr-9"
          />
        </div>
        <NativeSelect
          aria-label="نوع الطلب"
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value as typeof typeFilter);
            setPage(1);
          }}
          className="sm:w-44"
        >
          <option value="all">كل الأنواع</option>
          <option value="return">فيها استرجاع</option>
          <option value="exchange">فيها استبدال</option>
        </NativeSelect>
      </div>

      {activeQueue?.hint && !missingShipmentOnly && <p className="text-sm text-gray-500">{activeQueue.hint}</p>}

      {/* Bulk bar */}
      {queue === 'ready' && readyRows.length > 0 && !missingShipmentOnly && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setSelected((previous) =>
                previous.size === readyRows.length ? new Set() : new Set(readyRows.slice(0, 20).map((r) => r.id)),
              )
            }
          >
            {selected.size === readyRows.length ? 'إلغاء التحديد' : `تحديد ${Math.min(readyRows.length, 20)}`}
          </Button>
          <span className="text-emerald-900">
            {selected.size > 0 ? `${selected.size} طلب محدد` : 'حدّدي الطلبات السليمة لمعالجتها دفعة واحدة'}
          </span>
          <Button
            size="sm"
            className="mr-auto bg-emerald-600 hover:bg-emerald-700"
            disabled={selected.size === 0 || bulkRunning}
            onClick={runBulk}
          >
            {bulkRunning ? <Loader2 className="size-4 animate-spin" /> : null}
            اعتماد ومعالجة المحدد
          </Button>
        </div>
      )}

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
            queue === 'ready'
              ? 'لا توجد طلبات جاهزة للمعالجة 🎉'
              : queue === 'needs_attention'
                ? 'لا يوجد ما يحتاج تدخل'
                : 'لا توجد طلبات'
          }
        />
      ) : (
        <div className={`space-y-2 ${loading ? 'opacity-60' : ''}`}>
          {requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              selectable={queue === 'ready' && request.stage === 'ready'}
              selected={selected.has(request.id)}
              busy={bulkRunning && selected.has(request.id)}
              onToggleSelect={() => toggleSelect(request.id)}
              onOpen={() => setOpenId(request.id)}
              onProcess={() => (request.stage === 'ready' ? setProcessRequest(request) : setOpenId(request.id))}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            السابق
          </Button>
          <span className="text-sm text-gray-600">
            صفحة {page} من {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            التالي
          </Button>
        </div>
      )}

      <RequestDetailSheet
        request={openRequest}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
        onProcess={(request) => setProcessRequest(request)}
        onEditCoupon={(request) => setCouponRequest(request)}
        onEditInspectorNotes={(request) => setNotesRequest(request)}
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

      <CouponAmountDialog
        request={couponRequest ? { ...couponRequest, items: couponRequest.items.map((item) => ({ ...item, type: item.type })) } : null}
        onClose={() => setCouponRequest(null)}
        onSaved={(message) => {
          setCouponRequest(null);
          notify(message);
          void load();
        }}
      />

      <InspectorNotesDialog
        request={notesRequest}
        onClose={() => setNotesRequest(null)}
        onSaved={() => {
          setNotesRequest(null);
          notify('تم حفظ الملاحظات.');
          void load();
        }}
      />
    </AppPageShell>
  );
}
