'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { RefreshCcw, ShieldCheck, Search } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface HighPriorityOrder {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  customerName?: string | null;
  reason?: string | null;
  notes?: string | null;
  createdAt: string;
  createdByName?: string | null;
  createdByUsername?: string | null;
  assignment?: {
    status: string;
    assignedAt: string;
    userName: string;
  } | null;
}

const workflowHighlights = [
  {
    title: 'التحديث التلقائي',
    description: 'لوحة التحضير تبحث عن طلبات جديدة كل 30 ثانية عندما ينهي المستخدم طلبه الحالي.',
    badge: '30 ثانية',
  },
  {
    title: 'زر تحديث الطلبات',
    description: 'عند الضغط على زر التحديث يتم تنظيف الطلبات القديمة وجلب الأقدم مباشرة من سلة ثم تعيين الأولوية أولاً.',
    badge: '🔄 تحديث',
  },
  {
    title: 'أولوية الطابور',
    description: 'أي طلب تضيفه هنا يظهر أولاً في الطابور ثم يتم تعيينه تلقائياً للمستخدم المناسب.',
    badge: 'FIFO+',
  },
  {
    title: 'لوحة الفحص',
    description: 'زر فحص في لوحة التحضير يعرض سبب عدم ظهور الطلب ويؤكد وصول طلبات الأولوية.',
    badge: '🔍 فحص',
  },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-SA', { hour12: false });
  } catch {
    return value;
  }
};

const assignmentStatusLabel: Record<string, string> = {
  shipped: 'تم شحنه',
  completed: 'مكتمل',
  preparing: 'قيد التحضير',
  assigned: 'بانتظار البدء',
  waiting: 'قيد الانتظار',
};

export default function HighPriorityOrdersPage() {
  const { status } = useSession();
  const [orders, setOrders] = useState<HighPriorityOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    orderNumber: '',
    reason: '',
    notes: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'queue' | 'assigned'>('all');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const stats = useMemo(() => {
    const total = orders.length;
    const queueCount = orders.filter((order) => !order.assignment).length;
    const assignedCount = total - queueCount;

    return {
      total,
      queueCount,
      assignedCount,
      newestAt: orders[0]?.createdAt || null,
      oldestAt: orders[orders.length - 1]?.createdAt || null,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) {
      return orders;
    }
    const query = searchQuery.trim().toLowerCase();
    return orders.filter((order) => {
      return (
        (order.orderNumber || '').toLowerCase().includes(query) ||
        (order.customerName || '').toLowerCase().includes(query) ||
        (order.reason || '').toLowerCase().includes(query) ||
        (order.notes || '').toLowerCase().includes(query) ||
        (order.assignment?.userName || '').toLowerCase().includes(query)
      );
    });
  }, [orders, searchQuery]);

  const displayedOrders = useMemo(() => {
    if (statusFilter === 'queue') {
      return filteredOrders.filter((order) => !order.assignment);
    }
    if (statusFilter === 'assigned') {
      return filteredOrders.filter((order) => Boolean(order.assignment));
    }
    return filteredOrders;
  }, [filteredOrders, statusFilter]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadOrders();
    }
  }, [status]);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/high-priority-orders');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل جلب الطلبات عالية الأولوية');
      }

      setOrders(data.data || []);
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      console.error(error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'حدث خطأ غير متوقع',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (!formState.orderNumber.trim()) {
      setMessage({
        type: 'error',
        text: 'يرجى إدخال رقم الطلب',
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/high-priority-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تحديد الطلب كعالي الأولوية');
      }

      setMessage({
        type: 'success',
        text: 'تم تحديد الطلب كعالي الأولوية وسيظهر أولاً في لوحة التحضير',
      });
      setFormState({
        orderNumber: '',
        reason: '',
        notes: '',
      });
      await loadOrders();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'حدث خطأ غير متوقع',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (orderId: string) => {
    if (!orderId) return;
    setRemovingId(orderId);
    setMessage(null);
    try {
      const response = await fetch(`/api/high-priority-orders/${orderId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل إزالة الطلب من قائمة الأولوية');
      }

      setMessage({
        type: 'success',
        text: 'تم إزالة الطلب من قائمة الأولوية بنجاح',
      });
      setOrders((prev) => prev.filter((order) => order.id !== orderId));
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'حدث خطأ غير متوقع',
      });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar
        title="الطلبات عالية الأولوية"
        subtitle="طابور خاص يضمن أن أقدم طلبات العملاء الحساسة تظهر أولاً في لوحة التحضير الجديدة"
      />

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {message && (
          <div
            className={`p-4 rounded border text-sm ${
              message.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <div className="text-sm text-gray-500">إجمالي الطلبات المميزة</div>
            <div className="mt-2 text-3xl font-bold text-gray-900">{stats.total}</div>
            <p className="mt-2 text-xs text-gray-500">
              آخر إضافة: {formatDateTime(stats.newestAt)}
            </p>
          </Card>
          <Card className="p-5">
            <div className="text-sm text-amber-600">بانتظار التعيين</div>
            <div className="mt-2 text-3xl font-bold text-amber-600">{stats.queueCount}</div>
            <p className="mt-2 text-xs text-gray-500">
              سيتم دفع هذه الطلبات تلقائياً عند تشغيل التحديث التلقائي أو زر التحديث اليدوي.
            </p>
          </Card>
          <Card className="p-5">
            <div className="text-sm text-blue-600">مع فريق التحضير</div>
            <div className="mt-2 flex items-baseline gap-2 text-3xl font-bold text-blue-700">
              {stats.assignedCount}
              <span className="text-xs font-normal text-gray-500">
                {stats.assignedCount > 0 ? 'قيد المتابعة' : 'لا يوجد حالياً'}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              تتم مراقبة حالة هذه الطلبات بما يتماشى مع منطق التحضير الجديد.
            </p>
          </Card>
          <Card className="p-5 flex flex-col justify-between">
            <div>
              <div className="text-sm text-gray-500">آخر مزامنة مع لوحة التحضير</div>
              <div className="mt-2 text-lg font-semibold text-gray-900">
                {formatDateTime(lastRefreshAt)}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                يشمل تنظيف الطلبات المتغيرة والتحقق من توفر طلبات سلة مباشرة.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => loadOrders()}
              variant="outline"
              className="mt-4"
              disabled={loading}
            >
              <RefreshCcw className="h-4 w-4" />
              {loading ? 'جاري التحديث...' : 'مزامنة الآن'}
            </Button>
          </Card>
        </div>

        <Card className="p-6 space-y-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold">كيف تتكامل مع منطق التحضير الجديد؟</h2>
            <p className="text-sm text-gray-600">
              تم تحديث لوحة التحضير لتحاور واجهة سلة مباشرةً، وتعمل تلقائياً كل 30 ثانية عندما لا يملك
              المستخدم طلباً نشطاً. أي طلب مضاف هنا يتصدر الطابور في كل من التحديث التلقائي وزر
              &quot;تحديث الطلبات&quot;، مما يضمن أن عملاء VIP يتم التعامل معهم أولاً.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {workflowHighlights.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold text-gray-900">{item.title}</span>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                    {item.badge}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{item.description}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-gray-600">
            <span className="inline-flex items-center gap-2 rounded-full bg-green-50 px-4 py-1 text-green-700">
              <ShieldCheck className="h-4 w-4" />
              يتم فحص حالة الطلب لحظياً من سلة
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-4 py-1 text-blue-700">
              <RefreshCcw className="h-4 w-4" />
              أولوية الطابور تنعكس في زر &quot;تحديث الطلبات&quot;
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1 text-amber-700">
              ⚡ جاهز للترتيب حسب الأقدمية
            </span>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-2xl font-bold mb-4">إضافة طلب عالي الأولوية</h2>
          <p className="text-sm text-gray-600 mb-6">
            بمجرد حفظ الطلب سيتم إدراجه في الطابور الخاص وسيظهر أولاً لمستخدمي التحضير سواء عبر التحديث
            التلقائي أو زر التحديث اليدوي.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2" htmlFor="orderNumber">
                رقم الطلب
              </label>
              <input
                id="orderNumber"
                type="text"
                value={formState.orderNumber}
                onChange={(e) => setFormState((prev) => ({ ...prev, orderNumber: e.target.value }))}
                className="w-full rounded border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="مثال: 123456"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" htmlFor="reason">
                سبب الأهمية
              </label>
              <input
                id="reason"
                type="text"
                value={formState.reason}
                onChange={(e) => setFormState((prev) => ({ ...prev, reason: e.target.value }))}
                className="w-full rounded border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="مثال: عميل VIP بحاجة للطلب اليوم"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2" htmlFor="notes">
                ملاحظات داخلية (اختياري)
              </label>
              <textarea
                id="notes"
                value={formState.notes}
                onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                className="w-full rounded border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="تفاصيل إضافية لفريق التحضير..."
              />
            </div>

            <div className="flex items-center justify-between">
              <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                {submitting ? 'جاري المعالجة...' : 'حفظ كأولوية قصوى'}
              </Button>
              <Button type="button" variant="outline" onClick={loadOrders} disabled={loading}>
                {loading ? 'جاري التحديث...' : 'تحديث القائمة'}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">طابور الطلبات عالية الأولوية</h2>
              <p className="text-sm text-gray-600">
                يتم ترتيب هذه الطلبات أولاً عند تشغيل التحديث التلقائي (كل 30 ثانية) أو الضغط على زر
                &quot;تحديث الطلبات&quot; داخل لوحة التحضير. بمجرد تعيين الطلب، يظهر للمستخدم مع شارة توضح
                سبب الأهمية.
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  الطلبات غير المعينة = جاهزة للتعيين فوراً
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                  الطلبات المعينة = قيد التحضير أو الشحن
                </span>
              </div>
            </div>
            <div className="w-full max-w-md space-y-2">
              <label className="sr-only" htmlFor="order-search">
                بحث عن طلبات الأولوية
              </label>
              <div className="relative">
                <Input
                  id="order-search"
                  type="search"
                  placeholder="بحث برقم الطلب، العميل أو الملاحظات..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              </div>
              <div className="flex gap-2">
                {[
                  { value: 'all', label: 'كل الطلبات' },
                  { value: 'queue', label: 'بانتظار التعيين' },
                  { value: 'assigned', label: 'معين حالياً' },
                ].map((filter) => (
                  <Button
                    key={filter.value}
                    type="button"
                    size="sm"
                    variant={statusFilter === filter.value ? 'default' : 'outline'}
                    onClick={() => setStatusFilter(filter.value as typeof statusFilter)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-500 text-center py-8">جاري تحميل الطلبات...</p>
          ) : displayedOrders.length === 0 ? (
            <p className="text-gray-500 text-center py-8">لا توجد طلبات محددة كعالية الأولوية حالياً.</p>
          ) : (
            <div className="mt-6 space-y-4">
              {displayedOrders.map((order) => {
                const isAssigned = Boolean(order.assignment);
                const queueBadgeClasses = isAssigned
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-amber-50 text-amber-700 border border-amber-200';
                const assignmentState = order.assignment?.status
                  ? assignmentStatusLabel[order.assignment.status] || 'معين'
                  : 'جاهز للتعيين';

                return (
                  <div
                    key={order.id}
                    className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm text-gray-500">رقم الطلب</div>
                        <div className="text-2xl font-bold text-gray-900">
                          #{order.orderNumber || order.orderId}
                        </div>
                        <div className="text-xs text-gray-500">
                          تمت الإضافة في {formatDateTime(order.createdAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-medium">
                        <span className={`rounded-full px-3 py-1 ${queueBadgeClasses}`}>
                          {assignmentState}
                        </span>
                        {order.reason && (
                          <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">
                            {order.reason}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs text-gray-500">العميل</p>
                        <p className="text-sm font-medium text-gray-900">
                          {order.customerName || 'غير متوفر'}
                        </p>
                        {order.createdByName && (
                          <p className="text-xs text-gray-500">
                            أضيف بواسطة: {order.createdByName}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">ملاحظات داخلية</p>
                        <p className="text-sm text-gray-700">{order.notes || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">حالة التعيين</p>
                        {isAssigned ? (
                          <div className="text-sm text-gray-900">
                            <p className="font-semibold text-blue-700">
                              {order.assignment?.userName}
                            </p>
                            <p className="text-xs text-gray-500">
                              {assignmentState} منذ{' '}
                              {formatDateTime(order.assignment?.assignedAt)}
                            </p>
                          </div>
                        ) : (
                          <p className="text-sm text-amber-700">
                            سيتم التقاطه تلقائياً في أقرب تحديث
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 text-sm text-gray-500 md:flex-row md:items-center md:justify-between">
                      <div>
                        يظهر هذا الطلب أعلى الطابور عند{' '}
                        <span className="font-semibold text-gray-900">التحديث القادم</span>.
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => handleRemove(order.id)}
                        disabled={removingId === order.id}
                        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                      >
                        {removingId === order.id ? 'جاري الإزالة...' : 'إزالة من الطابور'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
