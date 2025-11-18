'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Calendar, Clock, Package, CheckCircle, XCircle, AlertCircle, Users, TrendingUp } from 'lucide-react';

interface OrderHistory {
  id: string;
  userId: string;
  userName: string;
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

interface UserStats {
  userId: string;
  userName: string;
  total: number;
  completed: number;
  cancelled: number;
  removed: number;
  totalDuration: number;
  averageDuration: number;
}

interface OrderUser {
  id: string;
  name: string;
  email: string | null;
}

export default function OrderReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [history, setHistory] = useState<OrderHistory[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [users, setUsers] = useState<OrderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'stats'>('stats');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user) {
      fetchUsers();
      fetchHistory();
    }
  }, [session, selectedUserId, startDate, endDate, filterStatus]);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/order-users/list');
      const data = await response.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      if (selectedUserId) params.append('userId', selectedUserId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (filterStatus) params.append('status', filterStatus);

      const response = await fetch(`/api/order-history/admin?${params}`);
      const data = await response.json();

      if (data.success) {
        setHistory(data.history);
        setStats(data.stats);
        setUserStats(data.userStats);
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

  if (loading && history.length === 0) {
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
            onClick={() => router.push('/')}
            variant="ghost"
            className="mb-4"
          >
            <ArrowRight className="ml-2 h-4 w-4" />
            العودة
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">تقارير الطلبات</h1>
        </div>

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
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
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
              <div className="text-sm text-gray-600">إجمالي الوقت</div>
              <div className="text-2xl font-bold text-blue-600">{Math.round(stats.totalDuration / 60)} س</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">متوسط الوقت</div>
              <div className="text-2xl font-bold text-purple-600">{stats.averageDuration} د</div>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                المستخدم
              </label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">الكل</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
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
                  setSelectedUserId('');
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

        {/* Content based on view mode */}
        {viewMode === 'stats' ? (
          /* User Stats */
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="h-6 w-6" />
              إحصائيات المستخدمين
            </h2>
            {userStats.length === 0 ? (
              <Card className="p-8 text-center">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">لا توجد بيانات</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {userStats.map((user) => (
                  <Card key={user.userId} className="p-4">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <Users className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">{user.userName}</h3>
                        <p className="text-sm text-gray-600">إجمالي: {user.total} طلب</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-green-50 p-2 rounded">
                        <div className="text-green-600 font-medium">مكتملة</div>
                        <div className="text-2xl font-bold text-green-700">{user.completed}</div>
                      </div>
                      <div className="bg-red-50 p-2 rounded">
                        <div className="text-red-600 font-medium">ملغاة</div>
                        <div className="text-2xl font-bold text-red-700">{user.cancelled}</div>
                      </div>
                      <div className="bg-orange-50 p-2 rounded">
                        <div className="text-orange-600 font-medium">محذوفة</div>
                        <div className="text-2xl font-bold text-orange-700">{user.removed}</div>
                      </div>
                      <div className="bg-blue-50 p-2 rounded">
                        <div className="text-blue-600 font-medium">متوسط الوقت</div>
                        <div className="text-2xl font-bold text-blue-700">{user.averageDuration} د</div>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">إجمالي الوقت</span>
                        <span className="font-bold text-gray-900">
                          {Math.round(user.totalDuration / 60)} ساعة
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* History List */
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Package className="h-6 w-6" />
              قائمة الطلبات
            </h2>
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
                            <Users className="h-4 w-4" />
                            <span className="font-medium">{order.userName}</span>
                          </div>
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
        )}
      </div>
    </div>
  );
}
