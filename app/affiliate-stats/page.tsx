'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import AppNavbar from '@/components/AppNavbar';
import {
  Calendar,
  CreditCard,
  LoaderCircle,
  Package,
  TrendingUp,
} from 'lucide-react';

interface AffiliateStats {
  totalOrders: number;
  totalSales: number;
  averageOrderValue: number;
}

interface StatusStat {
  slug: string | null;
  name: string | null;
  count: number;
  percentage: number;
}

interface Order {
  id: string;
  orderId: string;
  orderNumber: string | null;
  statusSlug: string | null;
  statusName: string | null;
  totalAmount: number;
  currency: string | null;
  placedAt: string | null;
  campaignName: string | null;
}

const STATUS_BADGE_MAP: Record<string, string> = {
  completed: 'bg-green-50 border-green-200 text-green-700',
  delivered: 'bg-green-50 border-green-200 text-green-700',
  cancelled: 'bg-red-50 border-red-200 text-red-700',
  payment_pending: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  in_progress: 'bg-blue-50 border-blue-200 text-blue-700',
};

export default function AffiliateStatsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [statusStats, setStatusStats] = useState<StatusStat[]>([]);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (session?.user) {
      const user = session.user as any;
      if (!user.affiliateName) {
        setError('لا يوجد حساب مسوق مرتبط بهذا المستخدم');
        setLoading(false);
        return;
      }
      fetchStats();
    }
  }, [session, startDate, endDate]);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/affiliate-stats?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setStats(data.stats);
        setStatusStats(data.statusStats);
        setRecentOrders(data.recentOrders);
      } else {
        setError(data.error || 'حدث خطأ في جلب البيانات');
      }
    } catch (err) {
      console.error(err);
      setError('حدث خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number, currency: string = 'SAR') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const getStatusColor = (slug: string | null) => {
    if (!slug) return 'bg-gray-50 border-gray-200 text-gray-700';
    return STATUS_BADGE_MAP[slug] || 'bg-gray-50 border-gray-200 text-gray-700';
  };

  if (status === 'loading' || (loading && !stats && !error)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoaderCircle className="h-12 w-12 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppNavbar title="إحصائيات المسوق" />
        <div className="max-w-4xl mx-auto p-8">
          <Card className="p-8 text-center text-red-600">
            <h2 className="text-xl font-bold mb-2">تنبيه</h2>
            <p>{error}</p>
            <Button onClick={() => router.push('/')} className="mt-4" variant="outline">
              العودة للرئيسية
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar title="إحصائيات المسوق" subtitle={`المسوق: ${(session?.user as any)?.affiliateName}`} />

      <div className="max-w-7xl mx-auto p-4 space-y-6">
        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border rounded-md"
              />
            </div>
            <Button 
              variant="outline" 
              onClick={() => { setStartDate(''); setEndDate(''); }}
            >
              مسح الفلاتر
            </Button>
          </div>
        </Card>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6 flex items-center gap-4">
            <div className="p-4 bg-blue-100 rounded-full text-blue-600">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-gray-600">إجمالي الطلبات</p>
              <h3 className="text-2xl font-bold">{stats?.totalOrders}</h3>
            </div>
          </Card>
          <Card className="p-6 flex items-center gap-4">
            <div className="p-4 bg-green-100 rounded-full text-green-600">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-gray-600">إجمالي المبيعات</p>
              <h3 className="text-2xl font-bold">{formatCurrency(stats?.totalSales || 0)}</h3>
            </div>
          </Card>
          <Card className="p-6 flex items-center gap-4">
            <div className="p-4 bg-purple-100 rounded-full text-purple-600">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-gray-600">متوسط قيمة الطلب</p>
              <h3 className="text-2xl font-bold">{formatCurrency(stats?.averageOrderValue || 0)}</h3>
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status Breakdown */}
          <Card className="p-6 lg:col-span-1">
            <h3 className="text-lg font-bold mb-4">حالات الطلبات</h3>
            <div className="space-y-4">
              {statusStats.map((stat, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${stat.slug === 'completed' ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className="text-sm text-gray-700">{stat.name || stat.slug}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{stat.count}</span>
                    <span className="text-xs text-gray-500">({stat.percentage.toFixed(1)}%)</span>
                  </div>
                </div>
              ))}
              {statusStats.length === 0 && <p className="text-gray-500 text-sm">لا توجد بيانات</p>}
            </div>
          </Card>

          {/* Recent Orders */}
          <Card className="p-6 lg:col-span-2">
            <h3 className="text-lg font-bold mb-4">أحدث 10 طلبات</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">رقم الطلب</th>
                    <th className="px-4 py-3">التاريخ</th>
                    <th className="px-4 py-3">المبلغ</th>
                    <th className="px-4 py-3">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        #{order.orderNumber || order.orderId}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {order.placedAt ? new Date(order.placedAt).toLocaleDateString('ar-SA') : '-'}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {formatCurrency(order.totalAmount, order.currency || 'SAR')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs border ${getStatusColor(order.statusSlug)}`}>
                          {order.statusName || order.statusSlug}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {recentOrders.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                        لا توجد طلبات حديثة
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
