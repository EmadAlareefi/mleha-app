'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import AppNavbar from '@/components/AppNavbar';

interface OrderUser {
  id: string;
  username: string;
  name: string;
}

interface OrderAssignment {
  id: string;
  orderId: string;
  orderNumber: string;
  status: string;
  sallaStatus: string | null;
  assignedUserId: string;
  assignedUserName: string;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  orderData: any;
  notes?: string;
}

interface StatsByUser {
  userId: string;
  userName: string;
  total: number;
  completed: number;
  underReview: number;
  reservation: number;
}

interface StatsBucket {
  total: number;
  completed: number;
  underReview: number;
  reservation: number;
  shipped: number;
  byUser: StatsByUser[];
}

interface Stats {
  active: StatsBucket;
  today: StatsBucket;
  week: StatsBucket;
  month: StatsBucket;
}

type TimeFilter = 'active' | 'today' | 'week' | 'month';
type StatusFilter = 'all' | 'active' | 'completed' | 'under_review' | 'reservation';

const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  active: 'الطلبات النشطة',
  today: 'مكتملة اليوم',
  week: 'مكتملة هذا الأسبوع',
  month: 'مكتملة هذا الشهر',
};

export default function AdminOrderPrepPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role;
  const roles = ((session?.user as any)?.roles || [role]) as string[];
  const isAdmin = roles.includes('admin');

  const [timeFilter, setTimeFilter] = useState<TimeFilter>('active');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [assignments, setAssignments] = useState<OrderAssignment[]>([]);
  const [users, setUsers] = useState<OrderUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [reassignUserId, setReassignUserId] = useState<string>('');
  const [showReassignModal, setShowReassignModal] = useState(false);
  const currentStats = stats ? stats[timeFilter] : null;
  const currentUserStats = currentStats?.byUser ?? [];

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/order-assignments/users');
      const data = await response.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        timeFilter,
        statusFilter,
      });

      const [assignmentsRes, statsRes] = await Promise.all([
        fetch(`/api/admin/order-assignments/list?${params}`),
        fetch(`/api/admin/order-assignments/stats?${params}`),
      ]);

      const assignmentsData = await assignmentsRes.json();
      const statsData = await statsRes.json();

      if (assignmentsData.success) {
        setAssignments(assignmentsData.assignments);
      }

      if (statsData.success) {
        setStats(statsData.stats);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, timeFilter]);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
      loadData();
    }
  }, [isAdmin, loadData, loadUsers]);

  const handleSelectOrder = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedOrders.size === assignments.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(assignments.map(a => a.id)));
    }
  };

  const handleReassign = async () => {
    if (!reassignUserId || selectedOrders.size === 0) {
      alert('الرجاء اختيار مستخدم وطلبات للنقل');
      return;
    }

    try {
      const response = await fetch('/api/admin/order-assignments/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentIds: Array.from(selectedOrders),
          newUserId: reassignUserId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`تم نقل ${data.reassignedCount} طلب بنجاح`);
        setSelectedOrders(new Set());
        setShowReassignModal(false);
        loadData();
      } else {
        alert(data.error || 'فشل نقل الطلبات');
      }
    } catch (error) {
      console.error('Reassign error:', error);
      alert('فشل نقل الطلبات');
    }
  };

  const handleReopenOrders = async () => {
    if (selectedOrders.size === 0) {
      alert('الرجاء اختيار طلبات لإعادة فتحها');
      return;
    }

    const confirmed = confirm(
      `هل أنت متأكد من إعادة فتح ${selectedOrders.size} طلب؟\n\nسيتم تغيير حالة الطلبات إلى "طلب جديد" وستكون متاحة للتحضير مرة أخرى.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch('/api/admin/order-assignments/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentIds: Array.from(selectedOrders),
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`تم إعادة فتح ${data.reopenedCount} طلب بنجاح`);
        setSelectedOrders(new Set());
        loadData();
      } else {
        alert(data.error || 'فشل إعادة فتح الطلبات');
      }
    } catch (error) {
      console.error('Reopen error:', error);
      alert('فشل إعادة فتح الطلبات');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusLabel = (status: string, sallaStatus: string | null) => {
    // Check Salla status IDs
    if (sallaStatus === '1065456688') return 'تحت المراجعة';
    if (sallaStatus === '1576217163') return 'تحت المراجعة حجز قطع';
    if (sallaStatus === '165947469') return 'تم الشحن';

    // Fallback to local status
    const statusMap: Record<string, string> = {
      'pending': 'معلق',
      'in_progress': 'جاري التجهيز',
      'preparing': 'قيد التحضير',
      'prepared': 'جاهز',
      'completed': 'مكتمل',
      'shipped': 'تم الشحن',
      'under_review': 'تحت المراجعة',
      'under_review_reservation': 'تحت المراجعة حجز قطع',
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string, sallaStatus: string | null) => {
    // Check Salla status IDs
    if (sallaStatus === '1065456688') return 'bg-orange-100 text-orange-800 border-orange-300';
    if (sallaStatus === '1576217163') return 'bg-purple-100 text-purple-800 border-purple-300';
    if (sallaStatus === '165947469') return 'bg-green-100 text-green-800 border-green-300';

    const colorMap: Record<string, string> = {
      'pending': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'in_progress': 'bg-blue-100 text-blue-800 border-blue-300',
      'preparing': 'bg-blue-100 text-blue-800 border-blue-300',
      'prepared': 'bg-green-100 text-green-800 border-green-300',
      'completed': 'bg-green-100 text-green-800 border-green-300',
      'shipped': 'bg-green-100 text-green-800 border-green-300',
      'under_review': 'bg-orange-100 text-orange-800 border-orange-300',
      'under_review_reservation': 'bg-purple-100 text-purple-800 border-purple-300',
    };
    return colorMap[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg">جاري التحميل...</p>
      </div>
    );
  }

  if (!session || !isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">إدارة طلبات التحضير</h1>
          <p className="text-gray-600 mb-6">يجب تسجيل الدخول كمسؤول للوصول إلى هذه الصفحة</p>
          <Button onClick={() => window.location.href = '/login'} className="w-full">
            تسجيل الدخول
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar title="إدارة طلبات التحضير" subtitle="لوحة تحكم المسؤول" />

      <div className="w-full px-4 md:px-6 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Statistics Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">إجمالي الطلبات</h3>
                <p className="text-3xl font-bold text-blue-600">
                  {stats[timeFilter].total}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {timeFilter === 'active' ? 'الحالية' : timeFilter === 'today' ? 'اليوم' : timeFilter === 'week' ? 'هذا الأسبوع' : 'هذا الشهر'}
                </p>
              </Card>

              <Card className="p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">مكتملة</h3>
                <p className="text-3xl font-bold text-green-600">
                  {stats[timeFilter].completed}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {stats[timeFilter].total > 0
                    ? `${Math.round((stats[timeFilter].completed / stats[timeFilter].total) * 100)}%`
                    : '0%'}
                </p>
              </Card>

              <Card className="p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">تحت المراجعة</h3>
                <p className="text-3xl font-bold text-orange-600">
                  {stats[timeFilter].underReview}
                </p>
                <p className="text-xs text-gray-500 mt-1">يحتاج متابعة</p>
              </Card>

              <Card className="p-6">
                <h3 className="text-sm font-medium text-gray-600 mb-2">حجز قطع</h3>
                <p className="text-3xl font-bold text-purple-600">
                  {stats[timeFilter].reservation}
                </p>
                <p className="text-xs text-gray-500 mt-1">قيد الحجز</p>
              </Card>
            </div>
          )}

          {/* Filters */}
          <Card className="p-6">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              {/* Time Filter */}
              <div className="flex gap-2">
                <Button
                  onClick={() => setTimeFilter('active')}
                  variant={timeFilter === 'active' ? 'default' : 'outline'}
                  className={timeFilter === 'active' ? 'bg-blue-600' : ''}
                >
                  الطلبات النشطة
                </Button>
                <Button
                  onClick={() => setTimeFilter('today')}
                  variant={timeFilter === 'today' ? 'default' : 'outline'}
                  className={timeFilter === 'today' ? 'bg-blue-600' : ''}
                >
                  مكتملة اليوم
                </Button>
                <Button
                  onClick={() => setTimeFilter('week')}
                  variant={timeFilter === 'week' ? 'default' : 'outline'}
                  className={timeFilter === 'week' ? 'bg-blue-600' : ''}
                >
                  مكتملة الأسبوع
                </Button>
                <Button
                  onClick={() => setTimeFilter('month')}
                  variant={timeFilter === 'month' ? 'default' : 'outline'}
                  className={timeFilter === 'month' ? 'bg-blue-600' : ''}
                >
                  مكتملة الشهر
                </Button>
              </div>

              {/* Status Filter */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => setStatusFilter('all')}
                  variant={statusFilter === 'all' ? 'default' : 'outline'}
                  size="sm"
                >
                  الكل
                </Button>
                <Button
                  onClick={() => setStatusFilter('active')}
                  variant={statusFilter === 'active' ? 'default' : 'outline'}
                  size="sm"
                >
                  نشط
                </Button>
                <Button
                  onClick={() => setStatusFilter('completed')}
                  variant={statusFilter === 'completed' ? 'default' : 'outline'}
                  size="sm"
                >
                  مكتمل
                </Button>
                <Button
                  onClick={() => setStatusFilter('under_review')}
                  variant={statusFilter === 'under_review' ? 'default' : 'outline'}
                  size="sm"
                >
                  تحت المراجعة
                </Button>
                <Button
                  onClick={() => setStatusFilter('reservation')}
                  variant={statusFilter === 'reservation' ? 'default' : 'outline'}
                  size="sm"
                >
                  حجز قطع
                </Button>
              </div>
            </div>
          </Card>

          {/* Bulk Actions */}
          {selectedOrders.size > 0 && (
            <Card className="p-4 bg-blue-50 border-blue-200">
              <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                <p className="text-sm font-medium text-blue-900">
                  تم اختيار {selectedOrders.size} طلب
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowReassignModal(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    📦 نقل للمستخدم
                  </Button>
                  <Button
                    onClick={handleReopenOrders}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    🔄 إعادة فتح
                  </Button>
                  <Button
                    onClick={() => setSelectedOrders(new Set())}
                    variant="outline"
                  >
                    إلغاء التحديد
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Users Performance */}
          {currentUserStats.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">أداء المستخدمين</h3>
                <span className="text-sm text-gray-500">{TIME_FILTER_LABELS[timeFilter]}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-right pb-3 font-semibold">المستخدم</th>
                      <th className="text-center pb-3 font-semibold">الإجمالي</th>
                      <th className="text-center pb-3 font-semibold">مكتمل</th>
                      <th className="text-center pb-3 font-semibold">تحت المراجعة</th>
                      <th className="text-center pb-3 font-semibold">حجز قطع</th>
                      <th className="text-center pb-3 font-semibold">معدل الإنجاز</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentUserStats.map((userStat) => (
                      <tr key={userStat.userId} className="border-b">
                        <td className="py-3 font-medium">{userStat.userName}</td>
                        <td className="text-center">{userStat.total}</td>
                        <td className="text-center text-green-600 font-semibold">
                          {userStat.completed}
                        </td>
                        <td className="text-center text-orange-600">
                          {userStat.underReview}
                        </td>
                        <td className="text-center text-purple-600">
                          {userStat.reservation}
                        </td>
                        <td className="text-center font-semibold">
                          {userStat.total > 0
                            ? `${Math.round((userStat.completed / userStat.total) * 100)}%`
                            : '0%'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Orders Table */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">الطلبات ({assignments.length})</h3>
              <Button onClick={loadData} variant="outline" size="sm">
                🔄 تحديث
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-500">جاري التحميل...</p>
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">لا توجد طلبات</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-right p-3">
                        <input
                          type="checkbox"
                          checked={selectedOrders.size === assignments.length}
                          onChange={handleSelectAll}
                          className="rounded"
                        />
                      </th>
                      <th className="text-right p-3 font-semibold">رقم الطلب</th>
                      <th className="text-right p-3 font-semibold">المستخدم</th>
                      <th className="text-right p-3 font-semibold">الحالة</th>
                      <th className="text-right p-3 font-semibold">النوع</th>
                      <th className="text-right p-3 font-semibold">العلامات</th>
                      <th className="text-right p-3 font-semibold">وقت التعيين</th>
                      <th className="text-right p-3 font-semibold">وقت البدء</th>
                      <th className="text-right p-3 font-semibold">وقت الإنهاء</th>
                      <th className="text-right p-3 font-semibold">العميل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((assignment) => (
                      <tr key={assignment.id} className="border-b hover:bg-gray-50">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedOrders.has(assignment.id)}
                            onChange={() => handleSelectOrder(assignment.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="p-3 font-medium">{assignment.orderNumber}</td>
                        <td className="p-3">{assignment.assignedUserName}</td>
                        <td className="p-3">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(
                              assignment.status,
                              assignment.sallaStatus
                            )}`}
                          >
                            {getStatusLabel(assignment.status, assignment.sallaStatus)}
                          </span>
                        </td>
                        <td className="p-3">
                          {(() => {
                            const country = assignment.orderData?.customer?.country
                              || assignment.orderData?.shipping_address?.country
                              || assignment.orderData?.billing_address?.country;

                            if (country && country !== 'SA') {
                              return (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300">
                                  🌍 دولي
                                </span>
                              );
                            }
                            return (
                              <span className="text-xs text-gray-400">محلي</span>
                            );
                          })()}
                        </td>
                        <td className="p-3">
                          {assignment.orderData?.tags && assignment.orderData.tags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {assignment.orderData.tags.slice(0, 2).map((tag: any, idx: number) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300"
                                >
                                  🏷️ {typeof tag === 'string' ? tag : tag.name || tag.value}
                                </span>
                              ))}
                              {assignment.orderData.tags.length > 2 && (
                                <span className="text-xs text-gray-500">
                                  +{assignment.orderData.tags.length - 2}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-gray-600">
                          {formatDate(assignment.assignedAt)}
                        </td>
                        <td className="p-3 text-xs text-gray-600">
                          {assignment.startedAt ? formatDate(assignment.startedAt) : '-'}
                        </td>
                        <td className="p-3 text-xs text-gray-600">
                          {assignment.completedAt ? formatDate(assignment.completedAt) : '-'}
                        </td>
                        <td className="p-3 text-xs">
                          {assignment.orderData?.customer?.first_name}{' '}
                          {assignment.orderData?.customer?.last_name}
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

      {/* Reassign Modal */}
      {showReassignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">نقل الطلبات لمستخدم آخر</h3>
            <p className="text-sm text-gray-600 mb-4">
              سيتم نقل {selectedOrders.size} طلب إلى المستخدم المحدد
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">اختر المستخدم</label>
              <select
                value={reassignUserId}
                onChange={(e) => setReassignUserId(e.target.value)}
                className="w-full border rounded-lg p-3"
              >
                <option value="">-- اختر مستخدم --</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.username})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleReassign}
                disabled={!reassignUserId}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                نقل الطلبات
              </Button>
              <Button
                onClick={() => {
                  setShowReassignModal(false);
                  setReassignUserId('');
                }}
                variant="outline"
                className="flex-1"
              >
                إلغاء
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
