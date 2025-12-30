'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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

export default function HighPriorityOrdersPage() {
  const { status } = useSession();
  const [orders, setOrders] = useState<HighPriorityOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    orderNumber: '',
    reason: '',
    notes: '',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
        subtitle="حدد رقم الطلب الذي يجب أن يظهر أولاً لفريق التحضير"
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

        <Card className="p-6">
          <h2 className="text-2xl font-bold mb-4">إضافة طلب عالي الأولوية</h2>
          <p className="text-sm text-gray-600 mb-6">
            قم بإدخال رقم الطلب كما يظهر في سلة وسنقوم بجلب بياناته وتحديده ليظهر أولاً لفريق التحضير.
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
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold">قائمة الطلبات عالية الأولوية</h2>
              <p className="text-sm text-gray-600">
                يتم ترتيب هذه الطلبات أولاً عند جلب الطلبات الجديدة لفريق التحضير.
              </p>
            </div>
            <input
              type="search"
              placeholder="بحث برقم الطلب أو اسم العميل..."
              className="rounded border border-gray-300 px-4 py-2 w-full md:w-80 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <p className="text-gray-500 text-center py-8">جاري تحميل الطلبات...</p>
          ) : filteredOrders.length === 0 ? (
            <p className="text-gray-500 text-center py-8">لا توجد طلبات محددة كعالية الأولوية حالياً.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">رقم الطلب</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">العميل</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">السبب</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">ملاحظات</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">المعين إليه</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-bold text-gray-900">#{order.orderNumber || order.orderId}</div>
                        <div className="text-xs text-gray-500">
                          تمت الإضافة في{' '}
                          {new Date(order.createdAt).toLocaleString('ar-SA')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">{order.customerName || 'غير متوفر'}</div>
                        {order.createdByName && (
                          <div className="text-xs text-gray-500">أضيفت بواسطة: {order.createdByName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {order.reason || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {order.notes || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {order.assignment ? (
                          <div className="space-y-1">
                            <div className="font-semibold text-blue-700">{order.assignment.userName}</div>
                            <div className="text-xs text-gray-500">
                              الحالة: {order.assignment.status === 'shipped' ? 'تم شحنه' : order.assignment.status === 'preparing' ? 'قيد التحضير' : 'معين'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500">غير معين بعد</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-left">
                        <Button
                          variant="outline"
                          onClick={() => handleRemove(order.id)}
                          disabled={removingId === order.id}
                          className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          {removingId === order.id ? 'جاري الإزالة...' : 'إزالة'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
