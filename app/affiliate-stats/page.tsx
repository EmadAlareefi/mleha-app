'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CreditCard,
  Package,
  TrendingUp,
} from 'lucide-react';

interface AffiliateStats {
  totalOrders: number;
  totalSales: number;
  averageOrderValue: number;
  totalCommissionEarned: number;
  averageCommissionPerOrder: number;
}

interface StatusStat {
  slug: string | null;
  name: string | null;
  count: number;
  netAmount?: number;
  commissionEarned?: number; // New field
  percentage: number;
}

interface Order {
  id: string;
  orderId: string;
  orderNumber: string | null;
  statusSlug: string | null;
  statusName: string | null;
  totalAmount: number;
  shippingAmount: number;
  netAmount: number;
  currency: string | null;
  placedAt: string | null;
  campaignName: string | null;
  affiliateCommission: number | null; // New field
  commissionAmount: number;
  isDelivered: boolean;
}

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

  const fetchStats = useCallback(async () => {
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
  }, [startDate, endDate]);

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
  }, [session, fetchStats]);

  const formatCurrency = (amount: number | null | undefined, currency: string = 'SAR') => {
    if (amount === null || amount === undefined) return '-'; // Display a dash for undefined amounts
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const getStatusVariant = (slug: string | null): 'default' | 'secondary' | 'destructive' => {
    if (slug === 'cancelled') return 'destructive';
    if (slug === 'completed' || slug === 'delivered') return 'default';
    return 'secondary';
  };

  if (status === 'loading' || (loading && !stats && !error)) {
    return (
      <AppPageShell title="إحصائيات المسوق">
        <LoadingState />
      </AppPageShell>
    );
  }

  if (error) {
    return (
      <AppPageShell title="إحصائيات المسوق">
        <div className="mx-auto w-full max-w-4xl">
          <Alert variant="destructive">
            <AlertTitle>تنبيه</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button onClick={() => router.push('/')} className="mt-4" variant="outline">
              العودة للرئيسية
            </Button>
          </Alert>
        </div>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell title="إحصائيات المسوق" subtitle={`المسوق: ${(session?.user as any)?.affiliateName}`}>
      <div className="mx-auto w-full max-w-7xl space-y-6">
        {/* Filters */}
        <Card className="rounded-lg">
          <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">من تاريخ</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <Button 
              variant="outline" 
              onClick={() => { setStartDate(''); setEndDate(''); }}
            >
              مسح الفلاتر
            </Button>
          </div>
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="rounded-lg">
            <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-muted p-4 text-primary">
              <Package className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي الطلبات</p>
              <h3 className="text-2xl font-bold">{stats?.totalOrders}</h3>
            </div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-muted p-4 text-primary">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي المبيعات الصافية</p>
              <h3 className="text-2xl font-bold">{formatCurrency(stats?.totalSales || 0)}</h3>
            </div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-muted p-4 text-primary">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">متوسط قيمة الطلب الصافي</p>
              <h3 className="text-2xl font-bold">{formatCurrency(stats?.averageOrderValue || 0)}</h3>
            </div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-muted p-4 text-primary">
              <CreditCard className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">إجمالي العمولات</p>
              <h3 className="text-2xl font-bold">{formatCurrency(stats?.totalCommissionEarned || 0)}</h3>
            </div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-muted p-4 text-primary">
              <TrendingUp className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">متوسط عمولة الطلب</p>
              <h3 className="text-2xl font-bold">{formatCurrency(stats?.averageCommissionPerOrder || 0)}</h3>
            </div>
            </CardContent>
          </Card>
          {/* Status Breakdown */}
          <Card className="rounded-lg lg:col-span-1">
            <CardHeader>
              <CardTitle>حالات الطلبات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {statusStats.map((stat, index) => {
                const percentageLabel = Number.isFinite(stat.percentage) ? stat.percentage.toFixed(1) : '0.0';
                return (
                  <div key={stat.slug || index} className="flex items-center justify-between rounded-lg border bg-card p-4">
                  <div>
                    <p className="text-sm font-semibold">{stat.name || stat.slug || 'غير معروف'}</p>
                    <p className="text-xs text-muted-foreground">
                      {stat.count} طلب - {percentageLabel}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">المبيعات الصافية</p>
                    <p className="text-sm font-semibold">{formatCurrency(stat.netAmount || 0)}</p>
                    <p className="text-xs text-primary mt-1">
                      {formatCurrency(stat.commissionEarned || 0)} عمولة
                    </p>
                  </div>
                </div>
                );
              })}
              {statusStats.length === 0 && <EmptyState title="لا توجد بيانات" />}
            </CardContent>
          </Card>

          {/* Recent Orders */}
          <Card className="rounded-lg lg:col-span-2">
            <CardHeader>
              <CardTitle>أحدث 10 طلبات</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الطلب</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المبلغ الصافي</TableHead>
                    <TableHead>العمولة</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.map((order) => {
                    const commission = order.commissionAmount ?? 0;
                    return (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">
                          #{order.orderNumber || order.orderId}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.placedAt ? new Date(order.placedAt).toLocaleDateString('ar-SA') : '-'}
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(order.netAmount, order.currency || 'SAR')}
                        </TableCell>
                        <TableCell className="font-medium text-primary">
                          {order.isDelivered ? (
                            <>
                              {formatCurrency(commission, order.currency || 'SAR')} ({order.affiliateCommission ?? 10}%)
                            </>
                          ) : (
                            <span className="text-muted-foreground">بانتظار التوصيل</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(order.statusSlug)}>
                            {order.statusName || order.statusSlug}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {recentOrders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        لا توجد طلبات حديثة
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppPageShell>
  );
}
