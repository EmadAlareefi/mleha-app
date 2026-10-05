'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ShipmentTrackingSummary from '@/components/local-shipping/ShipmentTrackingSummary';
import { LOCAL_SHIPMENT_STATUSES } from '@/app/lib/local-shipping/tracking';
import type { LocalTrackingShipment } from '@/app/lib/local-shipping/tracking-query';

export default function LocalShipmentTrackingPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState({ search: '', status: '', page: 1 });
  const [shipments, setShipments] = useState<LocalTrackingShipment[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ search: query.search, status: query.status, page: String(query.page) });
      const id = new URLSearchParams(window.location.search).get('id');
      if (id) params.set('id', id);
      const response = await fetch(`/api/local-shipping/tracking?${params}`, { cache: 'no-store', signal: current.signal });
      if (!response.ok) throw new Error('تعذر تحميل الشحنات. تحقق من صلاحية الدخول وحاول مجدداً.');
      const data = await response.json();
      if (current.signal.aborted) return;
      setShipments(data.shipments);
      setTotal(data.total);
      setPages(data.totalPages);
    } catch (err) {
      if (!current.signal.aborted) setError(err instanceof Error ? err.message : 'تعذر تحميل الشحنات');
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    return () => { clearInterval(timer); controller.current?.abort(); };
  }, [refresh]);

  return (
    <AppPageShell title="تتبع الشحنات المحلية" subtitle="مكان الشحنة حسب آخر حالة مسجلة لدى المندوب، وليس موقع GPS مباشر. يتم التحديث كل دقيقة.">
      <div className="mx-auto max-w-5xl space-y-4" dir="rtl">
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => {
            window.history.replaceState(null, '', '/local-shipping/tracking');
            setSearch('');
            setStatus('');
            setQuery({ search: '', status: '', page: 1 });
          }}>كل الشحنات</Button>
          <Button onClick={() => void refresh()} disabled={loading}>تحديث</Button>
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault();
          window.history.replaceState(null, '', '/local-shipping/tracking');
          setQuery({ search: search.trim(), status, page: 1 });
        }}>
          <label className="flex-1 space-y-1">بحث بالطلب أو التتبع أو اسم العميل
            <Input value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <label className="space-y-1">الحالة
            <NativeSelect value={status} onChange={event => setStatus(event.target.value)}>
              <option value="">كل الحالات</option>
              {Object.entries(LOCAL_SHIPMENT_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
          </label>
          <Button type="submit">بحث</Button>
        </form>
        {error && <Alert variant="destructive"><AlertDescription>{error} {shipments.length > 0 && 'البيانات المعروضة من آخر تحديث ناجح.'}</AlertDescription></Alert>}
        <p role="status">{loading ? 'جاري تحديث الشحنات...' : `${total} شحنة`}</p>
        {!loading && !error && shipments.length === 0 && <p>لا توجد شحنات تطابق البحث.</p>}
        {shipments.map(shipment => <Card key={shipment.id}>
          <CardHeader><CardTitle>طلب #{shipment.orderNumber} — {shipment.customerName}</CardTitle></CardHeader>
          <CardContent><ShipmentTrackingSummary shipment={shipment} detailed /></CardContent>
        </Card>)}
        {pages > 1 && <div className="flex items-center justify-center gap-3">
          <Button variant="outline" disabled={loading || query.page <= 1} onClick={() => setQuery(value => ({ ...value, page: value.page - 1 }))}>السابق</Button>
          <span>{query.page} / {pages}</span>
          <Button variant="outline" disabled={loading || query.page >= pages} onClick={() => setQuery(value => ({ ...value, page: value.page + 1 }))}>التالي</Button>
        </div>}
      </div>
    </AppPageShell>
  );
}
