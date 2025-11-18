'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Calendar, Clock, Package, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface OrderHistory {
  id: string;
  orderId: string;
  orderNumber: string;
  orderData: any;
  status: string;
  assignedAt: Date;
  startedAt: Date | null;
  finishedAt: Date;
  durationMinutes: number | null;
  finalSallaStatus: string | null;
  notes: string | null;
}

interface Stats {
  total: number;
  completed: number;
  cancelled: number;
  removed: number;
  totalDuration: number;
  averageDuration: number;
}

export default function OrderHistoryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [history, setHistory] = useState<OrderHistory[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchHistory();
    }
  }, [session, startDate, endDate, filterStatus]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        userId: session?.user?.id || '',
      });

      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (filterStatus) params.append('status', filterStatus);

      const response = await fetch(`/api/order-history/user?${params}`);
      const data = await response.json();

      if (data.success) {
        setHistory(data.history);
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'removed':
        return <AlertCircle className="h-5 w-5 text-orange-500" />;
      default:
        return <Package className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'مكتمل';
      case 'cancelled':
        return 'ملغي';
      case 'removed':
        return 'محذوف';
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 border-green-200 text-green-700';
      case 'cancelled':
        return 'bg-red-50 border-red-200 text-red-700';
      case 'removed':
        return 'bg-orange-50 border-orange-200 text-orange-700';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-700';
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (minutes: number | null) => {
    if (!minutes) return 'غير محدد';
    if (minutes < 60) return `${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} ساعة و ${mins} دقيقة`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
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
            onClick={() => router.push('/order-prep')}
            variant="ghost"
            className="mb-4"
          >
            <ArrowRight className="ml-2 h-4 w-4" />
            العودة
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">سجل الطلبات</h1>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card className="p-4">
              <div className="text-sm text-gray-600">الإجمالي</div>
              <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">مكتملة</div>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">ملغاة</div>
              <div className="text-2xl font-bold text-red-600">{stats.cancelled}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">محذوفة</div>
              <div className="text-2xl font-bold text-orange-600">{stats.removed}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">متوسط الوقت</div>
              <div className="text-2xl font-bold text-blue-600">{stats.averageDuration} د</div>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                الحالة
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">الكل</option>
                <option value="completed">مكتمل</option>
                <option value="cancelled">ملغي</option>
                <option value="removed">محذوف</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setFilterStatus('');
                }}
                variant="outline"
                className="w-full"
              >
                مسح الفلاتر
              </Button>
            </div>
          </div>
        </Card>

        {/* History List */}
        <div className="space-y-4">
          {history.length === 0 ? (
            <Card className="p-8 text-center">
              <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">لا توجد طلبات في السجل</p>
            </Card>
          ) : (
            history.map((order) => (
              <Card key={order.id} className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    {getStatusIcon(order.status)}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-lg">#{order.orderNumber}</h3>
                        <span className={`px-3 py-1 rounded-full text-sm border ${getStatusColor(order.status)}`}>
                          {getStatusText(order.status)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>انتهى في: {formatDate(order.finishedAt)}</span>
                        </div>
                        {order.durationMinutes !== null && (
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            <span>المدة: {formatDuration(order.durationMinutes)}</span>
                          </div>
                        )}
                        {order.notes && (
                          <div className="text-gray-500 mt-2">
                            <span className="font-medium">ملاحظات:</span> {order.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-left">
                    {order.orderData?.amounts?.total && (
                      <div className="text-lg font-bold text-gray-900">
                        {order.orderData.amounts.total.amount} {order.orderData.amounts.total.currency}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
