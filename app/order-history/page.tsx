'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        userId: (session?.user as any)?.id || '',
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
  }, [session, startDate, endDate, filterStatus]);

  useEffect(() => {
    if ((session?.user as any)?.id) {
      fetchHistory();
    }
  }, [session, fetchHistory]);

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

  const getStatusVariant = (status: string): 'default' | 'secondary' | 'destructive' => {
    switch (status) {
      case 'completed':
        return 'default';
      case 'cancelled':
        return 'destructive';
      case 'removed':
        return 'secondary';
      default:
        return 'secondary';
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
      <AppPageShell title="سجل الطلبات" subtitle="عرض الطلبات المنتهية ومدة تجهيزها">
        <LoadingState />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell title="سجل الطلبات" subtitle="عرض الطلبات المنتهية ومدة تجهيزها">
      <div className="mx-auto w-full max-w-7xl">
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
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">الإجمالي</div>
              <div className="text-2xl font-bold">{stats.total}</div>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">مكتملة</div>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">ملغاة</div>
              <div className="text-2xl font-bold text-red-600">{stats.cancelled}</div>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">محذوفة</div>
              <div className="text-2xl font-bold text-orange-600">{stats.removed}</div>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">متوسط الوقت</div>
              <div className="text-2xl font-bold text-blue-600">{stats.averageDuration} د</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card className="rounded-lg mb-6">
          <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                من تاريخ
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                إلى تاريخ
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                الحالة
              </label>
              <NativeSelect
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <NativeSelectOption value="">الكل</NativeSelectOption>
                <NativeSelectOption value="completed">مكتمل</NativeSelectOption>
                <NativeSelectOption value="cancelled">ملغي</NativeSelectOption>
                <NativeSelectOption value="removed">محذوف</NativeSelectOption>
              </NativeSelect>
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
          </CardContent>
        </Card>

        {/* History List */}
        <div className="space-y-4">
          {history.length === 0 ? (
            <EmptyState title="لا توجد طلبات في السجل" />
          ) : (
            history.map((order) => (
              <Card key={order.id} className="rounded-lg">
                <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    {getStatusIcon(order.status)}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-lg">#{order.orderNumber}</h3>
                        <Badge variant={getStatusVariant(order.status)}>
                          {getStatusText(order.status)}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
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
                          <div className="text-muted-foreground mt-2">
                            <span className="font-medium">ملاحظات:</span> {order.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-left">
                    {order.orderData?.amounts?.total && (
                      <div className="text-lg font-bold">
                        {order.orderData.amounts.total.amount} {order.orderData.amounts.total.currency}
                      </div>
                    )}
                  </div>
                </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppPageShell>
  );
}
