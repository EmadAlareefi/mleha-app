'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { RefreshCcw, ShieldCheck, Search, Zap } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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
    badge: 'تحديث',
  },
  {
    title: 'أولوية الطابور',
    description: 'أي طلب تضيفه هنا يظهر أولاً في الطابور ثم يتم تعيينه تلقائياً للمستخدم المناسب.',
    badge: 'FIFO+',
  },
  {
    title: 'لوحة الفحص',
    description: 'زر فحص في لوحة التحضير يعرض سبب عدم ظهور الطلب ويؤكد وصول طلبات الأولوية.',
    badge: 'فحص',
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
    <AppPageShell
      title="الطلبات عالية الأولوية"
      subtitle="طابور خاص يضمن أن أقدم طلبات العملاء الحساسة تظهر أولاً في لوحة التحضير الجديدة"
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {message && (
          <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <div className="text-sm text-muted-foreground">إجمالي الطلبات المميزة</div>
            <div className="mt-2 text-3xl font-bold">{stats.total}</div>
            <p className="mt-2 text-xs text-muted-foreground">
              آخر إضافة: {formatDateTime(stats.newestAt)}
            </p>
          </Card>
          <Card className="p-5">
            <div className="text-sm text-amber-600">بانتظار التعيين</div>
            <div className="mt-2 text-3xl font-bold text-amber-600">{stats.queueCount}</div>
            <p className="mt-2 text-xs text-muted-foreground">
              سيتم دفع هذه الطلبات تلقائياً عند تشغيل التحديث التلقائي أو زر التحديث اليدوي.
            </p>
          </Card>
          <Card className="p-5">
            <div className="text-sm text-blue-600">مع فريق التحضير</div>
            <div className="mt-2 flex items-baseline gap-2 text-3xl font-bold text-blue-700">
              {stats.assignedCount}
              <span className="text-xs font-normal text-muted-foreground">
                {stats.assignedCount > 0 ? 'قيد المتابعة' : 'لا يوجد حالياً'}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              تتم مراقبة حالة هذه الطلبات بما يتماشى مع منطق التحضير الجديد.
            </p>
          </Card>
          <Card className="p-5 flex flex-col justify-between">
            <div>
              <div className="text-sm text-muted-foreground">آخر مزامنة مع لوحة التحضير</div>
              <div className="mt-2 text-lg font-semibold">
                {formatDateTime(lastRefreshAt)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              تم تحديث لوحة التحضير لتحاور واجهة سلة مباشرةً، وتعمل تلقائياً كل 30 ثانية عندما لا يملك
              المستخدم طلباً نشطاً. أي طلب مضاف هنا يتصدر الطابور في كل من التحديث التلقائي وزر
              &quot;تحديث الطلبات&quot;، مما يضمن أن عملاء VIP يتم التعامل معهم أولاً.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {workflowHighlights.map((item) => (
              <div
                key={item.title}
                className="rounded-lg border bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold">{item.title}</span>
                  <Badge variant="secondary">{item.badge}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <Badge variant="outline" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              يتم فحص حالة الطلب لحظياً من سلة
            </Badge>
            <Badge variant="outline" className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              أولوية الطابور تنعكس في زر &quot;تحديث الطلبات&quot;
            </Badge>
            <Badge variant="outline" className="gap-2">
              <Zap className="h-4 w-4" />
              جاهز للترتيب حسب الأقدمية
            </Badge>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-2xl font-bold mb-4">إضافة طلب عالي الأولوية</h2>
          <p className="text-sm text-muted-foreground mb-6">
            بمجرد حفظ الطلب سيتم إدراجه في الطابور الخاص وسيظهر أولاً لمستخدمي التحضير سواء عبر التحديث
            التلقائي أو زر التحديث اليدوي.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field className="gap-2">
              <FieldLabel htmlFor="orderNumber">رقم الطلب</FieldLabel>
              <Input
                id="orderNumber"
                type="text"
                value={formState.orderNumber}
                onChange={(e) => setFormState((prev) => ({ ...prev, orderNumber: e.target.value }))}
                placeholder="مثال: 123456"
                required
              />
            </Field>

            <Field className="gap-2">
              <FieldLabel htmlFor="reason">سبب الأهمية</FieldLabel>
              <Input
                id="reason"
                type="text"
                value={formState.reason}
                onChange={(e) => setFormState((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="مثال: عميل VIP بحاجة للطلب اليوم"
              />
            </Field>

            <Field className="gap-2">
              <FieldLabel htmlFor="notes">ملاحظات داخلية</FieldLabel>
              <Textarea
                id="notes"
                value={formState.notes}
                onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
                placeholder="تفاصيل إضافية لفريق التحضير..."
              />
            </Field>

            <div className="flex items-center justify-between">
              <Button type="submit" disabled={submitting}>
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
              <p className="text-sm text-muted-foreground">
                يتم ترتيب هذه الطلبات أولاً عند تشغيل التحديث التلقائي (كل 30 ثانية) أو الضغط على زر
                &quot;تحديث الطلبات&quot; داخل لوحة التحضير. بمجرد تعيين الطلب، يظهر للمستخدم مع شارة توضح
                سبب الأهمية.
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  الطلبات غير المعينة = جاهزة للتعيين فوراً
                </Badge>
                <Badge variant="outline">
                  الطلبات المعينة = قيد التحضير أو الشحن
                </Badge>
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
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
            <LoadingState label="جاري تحميل الطلبات..." />
          ) : displayedOrders.length === 0 ? (
            <EmptyState title="لا توجد طلبات عالية الأولوية حالياً" />
          ) : (
            <div className="mt-6 space-y-4">
              {displayedOrders.map((order) => {
                const isAssigned = Boolean(order.assignment);
                const assignmentState = order.assignment?.status
                  ? assignmentStatusLabel[order.assignment.status] || 'معين'
                  : 'جاهز للتعيين';

                return (
                  <div
                    key={order.id}
                    className="rounded-lg border bg-card p-5"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm text-muted-foreground">رقم الطلب</div>
                        <div className="text-2xl font-bold">
                          #{order.orderNumber || order.orderId}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          تمت الإضافة في {formatDateTime(order.createdAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-medium">
                        <Badge variant={isAssigned ? 'default' : 'secondary'}>
                          {assignmentState}
                        </Badge>
                        {order.reason && (
                          <Badge variant="outline">
                            {order.reason}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs text-muted-foreground">العميل</p>
                        <p className="text-sm font-medium">
                          {order.customerName || 'غير متوفر'}
                        </p>
                        {order.createdByName && (
                          <p className="text-xs text-muted-foreground">
                            أضيف بواسطة: {order.createdByName}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">ملاحظات داخلية</p>
                        <p className="text-sm">{order.notes || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">حالة التعيين</p>
                        {isAssigned ? (
                          <div className="text-sm">
                            <p className="font-semibold text-blue-700">
                              {order.assignment?.userName}
                            </p>
                            <p className="text-xs text-muted-foreground">
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
                    <div className="mt-4 flex flex-col gap-3 border-t pt-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
                      <div>
                        يظهر هذا الطلب أعلى الطابور عند{' '}
                        <span className="font-semibold text-foreground">التحديث القادم</span>.
                      </div>
                      <Button
                        variant="destructive"
                        onClick={() => handleRemove(order.id)}
                        disabled={removingId === order.id}
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
    </AppPageShell>
  );
}
