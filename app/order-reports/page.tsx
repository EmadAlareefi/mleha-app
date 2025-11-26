'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  Calendar,
  Package,
  TrendingUp,
  User,
  Phone,
  CreditCard,
  MapPin,
  LoaderCircle,
  Send,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import SaudiCurrencyIcon from '@/components/icons/SaudiCurrencyIcon';

interface OrderRecord {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  statusSlug: string | null;
  statusName: string | null;
  fulfillmentStatus: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  shippingAmount: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
  customerId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  customerCity: string | null;
  customerCountry: string | null;
  fulfillmentCompany: string | null;
  trackingNumber: string | null;
  placedAt: string | null;
  updatedAtRemote: string | null;
  rawOrder: any;
  erpSyncedAt: string | null;
  erpInvoiceId: string | null;
  erpSyncError: string | null;
}

interface Stats {
  total: number;
  completed: number;
  cancelled: number;
  inProgress: number;
  totalAmount: number;
  averageAmount: number;
}

interface StatusStats {
  slug: string;
  name: string;
  count: number;
  percentage: number;
}

const HISTORY_PAGE_SIZE = 25;
const DEFAULT_STATUS_OPTIONS = [
  { slug: 'completed', name: 'تم التنفيذ' },
  { slug: 'delivered', name: 'تم التوصيل' },
  { slug: 'in_progress', name: 'قيد التنفيذ' },
  { slug: 'payment_pending', name: 'في انتظار الدفع' },
  { slug: 'canceled', name: 'ملغي' },
];
const STATUS_BADGE_MAP: Record<string, string> = {
  completed: 'bg-green-50 border-green-200 text-green-700',
  delivered: 'bg-green-50 border-green-200 text-green-700',
  ready_for_pickup: 'bg-green-50 border-green-200 text-green-700',
  fulfilled: 'bg-green-50 border-green-200 text-green-700',
  canceled: 'bg-red-50 border-red-200 text-red-700',
  cancelled: 'bg-red-50 border-red-200 text-red-700',
  restored: 'bg-red-50 border-red-200 text-red-700',
  removed: 'bg-red-50 border-red-200 text-red-700',
  payment_pending: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  under_review: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  in_progress: 'bg-blue-50 border-blue-200 text-blue-700',
  processing: 'bg-blue-50 border-blue-200 text-blue-700',
  delivering: 'bg-purple-50 border-purple-200 text-purple-700',
  delivered_pending: 'bg-purple-50 border-purple-200 text-purple-700',
};

export default function OrderReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusStats, setStatusStats] = useState<StatusStats[]>([]);
  const [statusOptions, setStatusOptions] = useState<{ slug: string; name: string }[]>(DEFAULT_STATUS_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'stats'>('stats');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [syncingOrders, setSyncingOrders] = useState<Set<string>>(new Set());
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [clearingDebugInvoices, setClearingDebugInvoices] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchOrders = useCallback(async (pageToLoad = 1, append = false) => {
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setLoading(true);
        setHasMore(false);
      }
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (filterStatus) params.append('status', filterStatus);
      params.append('page', pageToLoad.toString());
      params.append('limit', HISTORY_PAGE_SIZE.toString());
      params.append('sortDirection', sortDirection);

      const query = params.toString();
      const response = await fetch(
        `/api/order-history/admin${query ? `?${query}` : ''}`
      );
      const data = await response.json();

      if (data.success) {
        const fetchedOrders: OrderRecord[] = data.orders ?? [];
        setOrders((prev) => (append ? [...prev, ...fetchedOrders] : fetchedOrders));
        setStats(data.stats);
        setStatusStats(data.statusStats ?? []);
        setStatusOptions(
          data.filters?.statuses?.length ? data.filters.statuses : DEFAULT_STATUS_OPTIONS
        );
        setHasMore(Boolean(data.pagination?.hasMore));
        setPage(data.pagination?.page ?? pageToLoad);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [startDate, endDate, filterStatus, sortDirection]);

  useEffect(() => {
    if (session?.user) {
      fetchOrders(1);
    }
  }, [session, fetchOrders]);

  const getStatusColor = (slug: string | null) => {
    const normalized = slug ? slug.toLowerCase() : 'default';
    return STATUS_BADGE_MAP[normalized] ?? 'bg-gray-50 border-gray-200 text-gray-700';
  };

  const formatStatusText = (name: string | null, slug: string | null) => {
    return name ?? slug ?? 'غير معروف';
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return 'غير متوفر';
    const parsed = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(parsed.getTime())) return 'غير متوفر';
    return parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrencyValue = (amount: number | null, currency?: string | null): ReactNode => {
    if (amount === null || amount === undefined) return 'غير متوفر';
    const formatted = amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return (
      <span className="inline-flex items-center gap-1">
        <span>{formatted}</span>
        {currency ? (
          <span className="text-xs uppercase text-gray-500">{currency}</span>
        ) : (
          <SaudiCurrencyIcon className="h-5 w-5" />
        )}
      </span>
    );
  };

  const formatNumber = (value: number) => {
    return value.toLocaleString('en-US');
  };

  const syncOrderToERP = async (orderId: string, orderNumber: string | null) => {
    setSyncingOrders(prev => new Set(prev).add(orderId));
    setSyncMessage(null);

    try {
      const res = await fetch('/api/erp/sync-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, force: false }),
      });

      const data = await res.json();

      if (data.success) {
        setSyncMessage({
          type: 'success',
          text: `تم مزامنة الطلب ${orderNumber || orderId} بنجاح`,
        });

        // Update the order in the list
        setOrders(prev =>
          prev.map(order =>
            order.orderId === orderId
              ? { ...order, erpSyncedAt: new Date().toISOString(), erpInvoiceId: data.erpInvoiceId, erpSyncError: null }
              : order
          )
        );
      } else {
        setSyncMessage({
          type: 'error',
          text: `فشل مزامنة الطلب: ${data.error || data.message}`,
        });

        // Update error status
        setOrders(prev =>
          prev.map(order =>
            order.orderId === orderId
              ? { ...order, erpSyncError: data.error || data.message }
              : order
          )
        );
      }
    } catch (error) {
      setSyncMessage({
        type: 'error',
        text: 'حدث خطأ أثناء المزامنة',
      });
    } finally {
      setSyncingOrders(prev => {
        const newSet = new Set(prev);
        newSet.delete(orderId);
        return newSet;
      });

      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  const syncAllUnsyncedOrders = async () => {
    const unsyncedOrders = orders.filter(order => !order.erpSyncedAt);

    if (unsyncedOrders.length === 0) {
      setSyncMessage({ type: 'error', text: 'لا توجد طلبات غير مزامنة' });
      setTimeout(() => setSyncMessage(null), 3000);
      return;
    }

    if (!confirm(`هل تريد مزامنة ${unsyncedOrders.length} طلب مع نظام ERP؟`)) {
      return;
    }

    // Add all unsynced orders to syncing set
    setSyncingOrders(prev => {
      const newSet = new Set(prev);
      unsyncedOrders.forEach(order => newSet.add(order.orderId));
      return newSet;
    });

    let successCount = 0;
    let failCount = 0;

    for (const order of unsyncedOrders) {
      try {
        const res = await fetch('/api/erp/sync-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.orderId }),
        });

        const data = await res.json();

        if (data.success) {
          successCount++;
          setOrders(prev =>
            prev.map(o =>
              o.orderId === order.orderId
                ? { ...o, erpSyncedAt: new Date().toISOString(), erpInvoiceId: data.erpInvoiceId, erpSyncError: null }
                : o
            )
          );
        } else {
          failCount++;
          setOrders(prev =>
            prev.map(o =>
              o.orderId === order.orderId
                ? { ...o, erpSyncError: data.error || data.message }
                : o
            )
          );
        }
      } catch (error) {
        failCount++;
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setSyncingOrders(new Set());
    setSyncMessage({
      type: successCount > 0 ? 'success' : 'error',
      text: `تمت مزامنة ${successCount} طلب بنجاح، فشل ${failCount} طلب`,
    });
    setTimeout(() => setSyncMessage(null), 5000);
  };

  const clearDebugInvoices = async () => {
    if (!confirm('هل تريد حذف جميع الفواتير التجريبية (DEBUG)؟')) {
      return;
    }

    setClearingDebugInvoices(true);
    setSyncMessage(null);

    try {
      const res = await fetch('/api/erp/clear-debug-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (data.success) {
        setSyncMessage({
          type: 'success',
          text: `تم حذف ${data.count} فاتورة تجريبية بنجاح`,
        });

        // Update orders to remove debug syncs
        setOrders(prev =>
          prev.map(order =>
            order.erpInvoiceId?.startsWith('DEBUG-')
              ? { ...order, erpSyncedAt: null, erpInvoiceId: null, erpSyncError: null }
              : order
          )
        );

        // Refresh the list
        await fetchOrders(1, false);
      } else {
        setSyncMessage({
          type: 'error',
          text: `فشل حذف الفواتير التجريبية: ${data.error || data.message}`,
        });
      }
    } catch (error) {
      setSyncMessage({
        type: 'error',
        text: 'حدث خطأ أثناء حذف الفواتير التجريبية',
      });
    } finally {
      setClearingDebugInvoices(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <LoaderCircle className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button
            onClick={() => router.push('/')}
            variant="ghost"
            className="mb-4"
          >
            <ArrowRight className="ml-2 h-4 w-4" />
            العودة
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">تقارير الطلبات</h1>
        </div>

        {/* Sync Message */}
        {syncMessage && (
          <div
            className={`mb-4 p-4 rounded-lg ${
              syncMessage.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {syncMessage.text}
          </div>
        )}

        {/* View Mode Toggle */}
        <div className="flex gap-2 mb-6">
          <Button
            onClick={() => setViewMode('stats')}
            variant={viewMode === 'stats' ? 'default' : 'outline'}
            className="flex-1"
          >
            <TrendingUp className="ml-2 h-4 w-4" />
            الإحصائيات
          </Button>
          <Button
            onClick={() => setViewMode('list')}
            variant={viewMode === 'list' ? 'default' : 'outline'}
            className="flex-1"
          >
            <Package className="ml-2 h-4 w-4" />
            قائمة الطلبات
          </Button>
        </div>

        {/* Overall Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <Card className="p-4">
              <div className="text-sm text-gray-600">إجمالي الطلبات</div>
              <div className="text-2xl font-bold text-gray-900">{formatNumber(stats.total)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">طلبات مكتملة/مستلمة</div>
              <div className="text-2xl font-bold text-green-600">{formatNumber(stats.completed)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">طلبات جارية</div>
              <div className="text-2xl font-bold text-blue-600">{formatNumber(stats.inProgress)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">طلبات ملغاة/مسترجعة</div>
              <div className="text-2xl font-bold text-red-600">{formatNumber(stats.cancelled)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">إجمالي المبيعات المقدرة</div>
              <div className="text-2xl font-bold text-purple-600 flex items-center gap-2">
                {formatCurrencyValue(stats.totalAmount)}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">متوسط قيمة الطلب</div>
              <div className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
                {formatCurrencyValue(stats.averageAmount)}
              </div>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                حالة الطلب
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">الكل</option>
                {statusOptions.map((statusOption, index) => (
                  <option key={`${statusOption.slug ?? 'status'}-${index}`} value={statusOption.slug ?? ''}>
                    {statusOption.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                من تاريخ
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                إلى تاريخ
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ترتيب العرض
              </label>
              <select
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="desc">من الأحدث إلى الأقدم</option>
                <option value="asc">من الأقدم إلى الأحدث</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setFilterStatus('');
                  setSortDirection('desc');
                }}
                variant="outline"
                className="w-full"
              >
                مسح الفلاتر
              </Button>
            </div>
          </div>
        </Card>

        {/* Content based on view mode */}
        {viewMode === 'stats' ? (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-6 w-6" />
              إحصائيات حالات الطلبات
            </h2>
            {statusStats.length === 0 ? (
              <Card className="p-8 text-center">
                <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">لا توجد بيانات</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {statusStats.map((statusStat, index) => (
                  <Card key={`${statusStat.slug ?? 'statusStat'}-${index}`} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-lg">{statusStat.name}</h3>
                        <p className="text-sm text-gray-500">الحالة: {statusStat.slug}</p>
                      </div>
                      <div className="text-3xl font-bold text-blue-600">{formatNumber(statusStat.count)}</div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <span>النسبة من الإجمالي</span>
                      <span className="font-semibold text-gray-900">
                        {statusStat.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Orders List */
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Package className="h-6 w-6" />
                قائمة الطلبات
              </h2>
              <div className="flex items-center gap-3">
                {stats && (
                  <p className="text-sm text-gray-600">
                    عرض {formatNumber(orders.length)} من {formatNumber(stats.total)} طلب
                  </p>
                )}
                {process.env.NODE_ENV === 'development' && (
                  <Button
                    onClick={clearDebugInvoices}
                    disabled={clearingDebugInvoices || syncingOrders.size > 0}
                    variant="outline"
                    size="sm"
                  >
                    {clearingDebugInvoices ? (
                      <>
                        <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />
                        جاري الحذف...
                      </>
                    ) : (
                      <>
                        <XCircle className="ml-2 h-4 w-4" />
                        حذف الفواتير التجريبية
                      </>
                    )}
                  </Button>
                )}
                <Button
                  onClick={syncAllUnsyncedOrders}
                  disabled={syncingOrders.size > 0 || clearingDebugInvoices}
                  variant="default"
                  size="sm"
                >
                  {syncingOrders.size > 0 ? (
                    <>
                      <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />
                      جاري المزامنة...
                    </>
                  ) : (
                    <>
                      <Send className="ml-2 h-4 w-4" />
                      مزامنة الطلبات غير المزامنة
                    </>
                  )}
                </Button>
              </div>
            </div>
            {orders.length === 0 ? (
              <Card className="p-8 text-center">
                <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">لا توجد طلبات في السجل</p>
              </Card>
            ) : (
              <>
                {orders.map((order, index) => {
                  const cardKey = order.id ?? order.orderNumber ?? order.orderId ?? 'order';
                  return (
                    <Card key={`${cardKey}-${index}`} className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-lg">
                              #{order.orderNumber ?? order.orderId}
                            </h3>
                            <span
                              className={`px-3 py-1 rounded-full text-sm border ${getStatusColor(order.statusSlug)}`}
                            >
                              {formatStatusText(order.statusName, order.statusSlug)}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 space-y-1">
                            {order.customerName && (
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4" />
                                <span className="font-medium">{order.customerName}</span>
                              </div>
                            )}
                            {order.customerMobile && (
                              <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4" />
                                <span>{order.customerMobile}</span>
                              </div>
                            )}
                            {order.customerCity && (
                              <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4" />
                                <span>{order.customerCity}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span>تاريخ الطلب: {formatDate(order.placedAt ?? order.updatedAtRemote)}</span>
                            </div>
                            {order.fulfillmentCompany && (
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4" />
                                <span>شركة الشحن: {order.fulfillmentCompany}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-left space-y-2">
                        <div className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          <span>{formatCurrencyValue(order.totalAmount, order.currency)}</span>
                        </div>
                        {order.paymentStatus && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <CreditCard className="h-4 w-4" />
                            <span>الدفع: {order.paymentStatus}</span>
                          </div>
                        )}
                        {order.paymentMethod && (
                          <div className="text-sm text-gray-500">
                            طريقة الدفع: {order.paymentMethod}
                          </div>
                        )}
                        {order.trackingNumber && (
                          <div className="text-sm text-gray-500">
                            رقم التتبع: {order.trackingNumber}
                          </div>
                        )}

                        {/* ERP Sync Status */}
                        <div className="mt-3 pt-3 border-t space-y-2">
                          {order.erpSyncedAt ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <span>مزامن مع ERP</span>
                              </div>
                              {order.erpInvoiceId && (
                                <div className="bg-green-50 p-2 rounded">
                                  <p className="text-xs text-gray-600">رقم الفاتورة:</p>
                                  <p className="text-sm font-bold text-green-700">{order.erpInvoiceId}</p>
                                </div>
                              )}
                            </div>
                          ) : order.erpSyncError ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm text-red-600">
                                <XCircle className="h-4 w-4" />
                                <span>فشل المزامنة</span>
                              </div>
                              <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                                {order.erpSyncError}
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => syncOrderToERP(order.orderId, order.orderNumber)}
                                disabled={syncingOrders.has(order.orderId)}
                                className="w-full text-xs"
                              >
                                {syncingOrders.has(order.orderId) ? (
                                  <>
                                    <LoaderCircle className="ml-1 h-3 w-3 animate-spin" />
                                    جاري إعادة المحاولة...
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="ml-1 h-3 w-3" />
                                    إعادة المحاولة
                                  </>
                                )}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Package className="h-4 w-4" />
                                <span>لم تتم المزامنة</span>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => syncOrderToERP(order.orderId, order.orderNumber)}
                                disabled={syncingOrders.has(order.orderId)}
                                className="w-full text-xs"
                              >
                                {syncingOrders.has(order.orderId) ? (
                                  <>
                                    <LoaderCircle className="ml-1 h-3 w-3 animate-spin" />
                                    جاري المزامنة...
                                  </>
                                ) : (
                                  <>
                                    <Send className="ml-1 h-3 w-3" />
                                    مزامنة مع ERP
                                  </>
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    </Card>
                  );
                })}
                {hasMore && (
                  <div className="flex justify-center">
                    <Button
                      onClick={() => fetchOrders(page + 1, true)}
                      disabled={isLoadingMore}
                      className="min-w-[200px]"
                    >
                      {isLoadingMore ? 'جاري التحميل...' : 'تحميل المزيد'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
