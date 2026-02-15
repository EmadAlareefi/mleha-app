'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, Loader2, RefreshCcw, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';

interface UnavailableItemRecord {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  sku: string;
  normalizedSku: string;
  itemName?: string | null;
  reportedByName?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  resolvedByName?: string | null;
}

const formatDateTime = (value: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-SA', { hour12: false });
  } catch {
    return value;
  }
};

const formatRelative = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value).getTime();
  const diffMs = Date.now() - date;
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'الآن';
  if (diffMinutes < 60) return `${diffMinutes} دقيقة`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ساعة`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} يوم`;
};

export default function MissingItemsClient() {
  const { status } = useSession();
  const { toast } = useToast();
  const [items, setItems] = useState<UnavailableItemRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'refunded'>('pending');
  const [markingRefundId, setMarkingRefundId] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/order-prep/unavailable-items?includeResolved=true');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحميل قائمة النواقص');
      }
      setItems(Array.isArray(data?.data) ? data.data : []);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة النواقص');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void loadItems();
    }
  }, [loadItems, status]);

  const filteredItems = useMemo(() => {
    if (!search.trim()) {
      return items;
    }
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      return (
        (item.orderNumber || item.orderId || '').toLowerCase().includes(query) ||
        (item.sku || '').toLowerCase().includes(query) ||
        (item.itemName || '').toLowerCase().includes(query) ||
        (item.reportedByName || '').toLowerCase().includes(query)
      );
    });
  }, [items, search]);

  const pendingCount = useMemo(
    () => items.filter((item) => !item.resolvedAt).length,
    [items]
  );
  const refundedCount = useMemo(
    () => items.filter((item) => item.resolvedAt).length,
    [items]
  );

  const pendingItems = useMemo(
    () => filteredItems.filter((item) => !item.resolvedAt),
    [filteredItems]
  );
  const refundedItems = useMemo(
    () => filteredItems.filter((item) => item.resolvedAt),
    [filteredItems]
  );
  const displayedItems = activeTab === 'pending' ? pendingItems : refundedItems;

  const handleMarkRefunded = useCallback(
    async (record: UnavailableItemRecord) => {
      if (!record?.id) {
        return;
      }
      setMarkingRefundId(record.id);
      try {
        const response = await fetch('/api/order-prep/unavailable-items', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: record.id }),
        });
        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'تعذر تحديث السجل');
        }
        const updated: UnavailableItemRecord = data.data;
        setItems((prev) =>
          prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
        );
        toast({
          description: `تم تسجيل إرجاع مبلغ الطلب ${record.orderNumber || record.orderId}`,
        });
      } catch (err) {
        toast({
          variant: 'destructive',
          description: err instanceof Error ? err.message : 'تعذر تحديث السجل',
        });
      } finally {
        setMarkingRefundId((current) => (current === record.id ? null : current));
      }
    },
    [toast]
  );

  return (
    <section className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-rose-700 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            متابعة القطع غير المتوفرة
          </p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">صفحة النواقص</h1>
          <p className="text-sm text-gray-600 mt-1">
            تعرض هذه الصفحة كل القطع التي تم الإبلاغ عنها من فرق التحضير حتى تُعالج من قبل فريق
            المشتريات أو خدمة العملاء.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadItems} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4 ml-2" />
            )}
            تحديث القائمة
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1">
          {(
            [
              { key: 'pending', label: 'النواقص الحالية', count: pendingCount },
              { key: 'refunded', label: 'مبالغ تم ارجاعها', count: refundedCount },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex min-w-[150px] flex-col rounded-lg px-4 py-2 text-right text-sm font-semibold transition focus:outline-none ${
                activeTab === tab.key
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-xs font-normal ${
                  activeTab === tab.key ? 'text-white/90' : 'text-gray-500'
                }`}
              >
                {tab.count} سجل
              </span>
            </button>
          ))}
        </div>
      </div>
      <Card className="p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="ابحث برقم الطلب أو SKU أو اسم المبلغ"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pr-10"
            />
          </div>
          <p className="text-sm text-gray-500">
            آخر تحديث: {lastUpdated ? formatDateTime(lastUpdated) : '—'}
          </p>
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-rose-600" />
            <span className="mr-2 text-sm text-gray-600">جاري التحديث...</span>
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-gray-500">
            {activeTab === 'pending'
              ? 'لا توجد بلاغات نواقص حالياً.'
              : 'لا توجد سجلات تم إرجاع مبالغها.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="px-4 py-3 text-right font-semibold">رقم الطلب</th>
                  <th className="px-4 py-3 text-right font-semibold">SKU</th>
                  <th className="px-4 py-3 text-right font-semibold">اسم المنتج</th>
                  <th className="px-4 py-3 text-right font-semibold">المبلّغ</th>
                  <th className="px-4 py-3 text-right font-semibold">وقت التبليغ</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    {activeTab === 'pending' ? 'الإجراء' : 'تحديث الحالة'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {displayedItems.map((item) => (
                  <tr key={item.id} className="text-gray-700">
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      #{item.orderNumber || item.orderId}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-slate-50 px-2 py-1 font-mono text-xs">
                        {item.sku || item.normalizedSku}
                      </span>
                    </td>
                    <td className="px-4 py-3">{item.itemName || '—'}</td>
                    <td className="px-4 py-3">{item.reportedByName || 'غير معروف'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col text-xs text-gray-500">
                        <span className="font-semibold text-gray-900">
                          {formatRelative(item.createdAt)}
                        </span>
                        <span>{formatDateTime(item.createdAt)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {activeTab === 'pending' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleMarkRefunded(item)}
                          disabled={markingRefundId === item.id}
                          className="min-w-[140px]"
                        >
                          {markingRefundId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          تم ارجاع المبلغ
                        </Button>
                      ) : (
                        <div className="text-xs text-gray-500">
                          <p className="font-semibold text-gray-900">تم الإرجاع</p>
                          <p>
                            {item.resolvedByName
                              ? `بواسطة ${item.resolvedByName}`
                              : '—'}
                          </p>
                          <p>{formatDateTime(item.resolvedAt || null)}</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
