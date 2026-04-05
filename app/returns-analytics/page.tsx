'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppNavbar from '@/components/AppNavbar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowDownRight,
  BarChart3,
  Filter,
  RefreshCcw,
  Search,
  TrendingUp,
} from 'lucide-react';
import { STATUS_COLORS, STATUS_LABELS } from '@/app/lib/returns/status';

type TimeframeKey = '7d' | '30d' | '90d';

interface ReturnItem {
  id: string;
  productName: string;
  productSku?: string | null;
  variantName?: string | null;
  quantity?: number | null;
  price?: number | string | null;
}

interface ReturnRequest {
  id: string;
  orderNumber: string | null;
  type: 'return' | 'exchange';
  status: string;
  reason?: string | null;
  reasonDetails?: string | null;
  adminNotes?: string | null;
  customerName?: string | null;
  createdAt: string;
  totalRefundAmount?: number | string | null;
  items: ReturnItem[];
}

interface ReasonStat {
  id: string;
  label: string;
  total: number;
  percentage: number;
  trend: number;
}

interface AggregatedItem {
  sku: string;
  name: string;
  totalQuantity: number;
  totalValue: number;
  reasons: string[];
}

interface ReportRow {
  id: string;
  sku: string;
  orderNumber: string;
  type: 'return' | 'exchange';
  reason: string;
  amount: number;
  status: string;
  resolution: string;
  customer: string;
  createdAt: string;
}

const TIMEFRAME_CONFIG: Record<TimeframeKey, { label: string; days: number }> = {
  '7d': { label: 'آخر ٧ أيام', days: 7 },
  '30d': { label: 'آخر ٣٠ يوماً', days: 30 },
  '90d': { label: 'آخر ٩٠ يوماً', days: 90 },
};

const FALLBACK_REASON = 'أسباب غير مصنفة';
const numberFormatter = new Intl.NumberFormat('ar-SA');
const currencyFormatter = new Intl.NumberFormat('ar-SA', {
  style: 'currency',
  currency: 'SAR',
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat('ar-SA', {
  month: 'short',
  day: 'numeric',
});

const normalizeReason = (value?: string | null): string => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : FALLBACK_REASON;
};

const parseAmount = (value: number | string | null | undefined): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const getItemQuantity = (item: ReturnItem): number => {
  const quantity = Number(item.quantity ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const getItemValue = (item: ReturnItem): number => {
  return parseAmount(item.price) * getItemQuantity(item);
};

const getRequestRefundValue = (request: ReturnRequest): number => {
  if (request.type !== 'return') {
    return 0;
  }
  const directRefund = parseAmount(request.totalRefundAmount);
  if (directRefund > 0) {
    return directRefund;
  }
  return request.items.reduce((total, item) => total + getItemValue(item), 0);
};

const computeTrend = (current: number, previous: number): number => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
};

const formatCurrency = (value: number) => currencyFormatter.format(Math.round(value));
const formatNumber = (value: number) => numberFormatter.format(Math.round(value));
const formatDate = (value: string) => dateFormatter.format(new Date(value));

export default function ReturnsAnalyticsPage() {
  const [timeframe, setTimeframe] = useState<TimeframeKey>('30d');
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [searchSku, setSearchSku] = useState('');
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadRequests = useCallback(
    async (options?: { silent?: boolean }) => {
      setError('');
      if (options?.silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const response = await fetch('/api/returns/list?limit=500');
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'تعذر جلب البيانات');
        }
        setReturnRequests(data.data || []);
      } catch (err) {
        console.error('Failed to load return analytics data', err);
        setError('تعذر جلب بيانات المرتجعات. حاول مجدداً.');
      } finally {
        if (options?.silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const timeframeMeta = useMemo(() => {
    const durationMs = TIMEFRAME_CONFIG[timeframe].days * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return {
      durationMs,
      startMs: now - durationMs,
      previousStartMs: now - durationMs * 2,
    };
  }, [timeframe]);

  const timeframeRequests = useMemo(() => {
    return returnRequests.filter((request) => {
      const createdAt = new Date(request.createdAt).getTime();
      if (Number.isNaN(createdAt)) {
        return false;
      }
      return createdAt >= timeframeMeta.startMs;
    });
  }, [returnRequests, timeframeMeta]);

  const previousRequests = useMemo(() => {
    return returnRequests.filter((request) => {
      const createdAt = new Date(request.createdAt).getTime();
      if (Number.isNaN(createdAt)) {
        return false;
      }
      return createdAt >= timeframeMeta.previousStartMs && createdAt < timeframeMeta.startMs;
    });
  }, [returnRequests, timeframeMeta]);

  const reasonStats = useMemo<ReasonStat[]>(() => {
    const currentCounts = new Map<string, number>();
    const previousCounts = new Map<string, number>();

    timeframeRequests.forEach((request) => {
      const reason = normalizeReason(request.reason);
      currentCounts.set(reason, (currentCounts.get(reason) || 0) + 1);
    });

    previousRequests.forEach((request) => {
      const reason = normalizeReason(request.reason);
      previousCounts.set(reason, (previousCounts.get(reason) || 0) + 1);
    });

    const total = timeframeRequests.length || 1;

    return Array.from(currentCounts.entries())
      .map(([reason, count]) => {
        const prevCount = previousCounts.get(reason) || 0;
        return {
          id: reason,
          label: reason,
          total: count,
          percentage: Math.round((count / total) * 100),
          trend: computeTrend(count, prevCount),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [timeframeRequests, previousRequests]);

  const reasonLabelMap = useMemo(() => {
    return reasonStats.reduce((acc, stat) => {
      acc[stat.id] = stat.label;
      return acc;
    }, {} as Record<string, string>);
  }, [reasonStats]);

  useEffect(() => {
    setSelectedReasons((previousSelection) => {
      const validReasons = previousSelection.filter((reason) => reasonLabelMap[reason]);
      return validReasons.length === previousSelection.length ? previousSelection : validReasons;
    });
  }, [reasonLabelMap]);

  const filteredRequests = useMemo(() => {
    return timeframeRequests.filter((request) => {
      if (!selectedReasons.length) {
        return true;
      }
      const reason = normalizeReason(request.reason);
      return selectedReasons.includes(reason);
    });
  }, [timeframeRequests, selectedReasons]);

  const previousFilteredRequests = useMemo(() => {
    return previousRequests.filter((request) => {
      if (!selectedReasons.length) {
        return true;
      }
      const reason = normalizeReason(request.reason);
      return selectedReasons.includes(reason);
    });
  }, [previousRequests, selectedReasons]);

  const summaryMetrics = useMemo(() => {
    const returnsCount = filteredRequests.filter((request) => request.type === 'return').length;
    const exchangesCount = filteredRequests.filter((request) => request.type === 'exchange').length;
    const refundValue = filteredRequests.reduce(
      (total, request) => total + getRequestRefundValue(request),
      0
    );

    const previousReturns = previousFilteredRequests.filter(
      (request) => request.type === 'return'
    ).length;
    const previousExchanges = previousFilteredRequests.filter(
      (request) => request.type === 'exchange'
    ).length;
    const previousRefundValue = previousFilteredRequests.reduce(
      (total, request) => total + getRequestRefundValue(request),
      0
    );

    return {
      returnsCount,
      exchangesCount,
      refundValue,
      trends: {
        returns: computeTrend(returnsCount, previousReturns),
        exchanges: computeTrend(exchangesCount, previousExchanges),
        refund: computeTrend(refundValue, previousRefundValue),
      },
    };
  }, [filteredRequests, previousFilteredRequests]);

  const aggregateItems = useCallback(
    (type: 'return' | 'exchange'): AggregatedItem[] => {
      const map = new Map<
        string,
        { sku: string; name: string; totalQuantity: number; totalValue: number; reasons: Map<string, number> }
      >();

      filteredRequests
        .filter((request) => request.type === type)
        .forEach((request) => {
          const reason = normalizeReason(request.reason);
          request.items.forEach((item) => {
            const name = (item.productName || item.variantName || 'منتج غير معروف').trim();
            const sku = item.productSku?.trim() || '';
            const key = sku || `${type}:${name}`;
            const quantity = getItemQuantity(item);
            const value = getItemValue(item);
            if (quantity <= 0 && value <= 0) {
              return;
            }
            const entry =
              map.get(key) ||
              {
                sku: sku || 'غير متوفر',
                name,
                totalQuantity: 0,
                totalValue: 0,
                reasons: new Map<string, number>(),
              };
            entry.totalQuantity += quantity;
            entry.totalValue += value;
            entry.reasons.set(reason, (entry.reasons.get(reason) || 0) + quantity);
            map.set(key, entry);
          });
        });

      return Array.from(map.values())
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, 5)
        .map((entry) => ({
          sku: entry.sku,
          name: entry.name,
          totalQuantity: entry.totalQuantity,
          totalValue: entry.totalValue,
          reasons: Array.from(entry.reasons.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([reasonLabel]) => reasonLabel)
            .slice(0, 3),
        }));
    },
    [filteredRequests]
  );

  const mostRefundedItems = useMemo(() => aggregateItems('return'), [aggregateItems]);
  const mostExchangedItems = useMemo(() => aggregateItems('exchange'), [aggregateItems]);

  const reportRows = useMemo<ReportRow[]>(() => {
    return filteredRequests.flatMap((request) => {
      const reason = normalizeReason(request.reason);
      return request.items.map((item) => {
        const id = `${request.id}-${item.id}`;
        const sku = item.productSku?.trim() || 'غير متوفر';
        const amount = getItemValue(item);
        const resolution =
          request.adminNotes?.trim() ||
          request.reasonDetails?.trim() ||
          (request.type === 'exchange'
            ? 'بانتظار اكتمال الاستبدال'
            : 'بانتظار معالجة الاسترداد');

        return {
          id,
          sku,
          orderNumber: request.orderNumber || 'غير متوفر',
          type: request.type,
          reason,
          amount,
          status: request.status || 'pending_review',
          resolution,
          customer: request.customerName || 'عميل غير معروف',
          createdAt: request.createdAt,
        };
      });
    });
  }, [filteredRequests]);

  const filteredReports = useMemo(() => {
    const normalizedQuery = searchSku.trim().toLowerCase();
    return [...reportRows]
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .filter((row) => {
        if (!normalizedQuery) {
          return true;
        }
        return row.sku.toLowerCase().includes(normalizedQuery);
      });
  }, [reportRows, searchSku]);

  const reasonSummaryText = selectedReasons.length
    ? `يتم عرض البيانات بناءً على (${selectedReasons
        .map((reason) => reasonLabelMap[reason] || reason)
        .join('، ')})`
    : 'يتم عرض جميع أسباب الإرجاع والاستبدال';

  const toggleReason = (reason: string) => {
    setSelectedReasons((prev) =>
      prev.includes(reason) ? prev.filter((value) => value !== reason) : [...prev, reason]
    );
  };

  const clearReasons = () => setSelectedReasons([]);

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <AppNavbar
        title="تحليل المرتجعات"
        subtitle="فلترة الأسباب، مراقبة المنتجات الحرجة، والبحث بالـ SKU اعتماداً على بيانات ReturnRequest"
      />
      <main className="mx-auto mt-6 flex w-full max-w-6xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">تقرير الملخص</p>
              <h1 className="text-2xl font-semibold text-slate-900">لوحة تحليل المرتجعات</h1>
              <p className="mt-1 text-sm text-slate-500">
                {`تعرض هذه الصفحة أداء المرتجعات والاستبدالات لـ ${
                  TIMEFRAME_CONFIG[timeframe].label
                }. ${reasonSummaryText}.`}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="text-sm text-slate-500">
                <p className="font-medium text-slate-700">الفترة الزمنية</p>
                <p>{TIMEFRAME_CONFIG[timeframe].label}</p>
              </div>
              <Select
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value as TimeframeKey)}
                className="w-full rounded-2xl border-slate-200 text-sm sm:w-44"
              >
                <option value="7d">آخر ٧ أيام</option>
                <option value="30d">آخر ٣٠ يوماً</option>
                <option value="90d">آخر ٩٠ يوماً</option>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || refreshing}
                onClick={() => loadRequests({ silent: true })}
                className="rounded-2xl border-slate-200 text-slate-600 hover:text-slate-900"
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                تحديث البيانات
              </Button>
            </div>
          </div>
          {(loading || error) && (
            <div className="mt-4 flex flex-col gap-2">
              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}
              {loading && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                  جاري تحميل بيانات المرتجعات...
                </div>
              )}
            </div>
          )}
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Card className="border-indigo-100 bg-indigo-50/60 text-indigo-900">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">طلبات الإرجاع</CardTitle>
                <BarChart3 className="h-5 w-5 text-indigo-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatNumber(summaryMetrics.returnsCount)}
                </div>
                <p
                  className={`mt-1 flex items-center text-xs ${
                    summaryMetrics.trends.returns >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  <TrendingUp className="ms-1 h-4 w-4" />
                  {summaryMetrics.trends.returns >= 0 ? '+' : ''}
                  {summaryMetrics.trends.returns}‎% مقارنة بالفترة السابقة
                </p>
              </CardContent>
            </Card>
            <Card className="border-sky-100 bg-sky-50/60 text-sky-900">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">طلبات الاستبدال</CardTitle>
                <TrendingUp className="h-5 w-5 text-sky-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {formatNumber(summaryMetrics.exchangesCount)}
                </div>
                <p
                  className={`mt-1 text-xs ${
                    summaryMetrics.trends.exchanges >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {summaryMetrics.trends.exchanges >= 0 ? '+' : ''}
                  {summaryMetrics.trends.exchanges}‎% مقارنة بالفترة السابقة
                </p>
              </CardContent>
            </Card>
            <Card className="border-emerald-100 bg-emerald-50/60 text-emerald-900">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">القيمة المستردة</CardTitle>
                <ArrowDownRight className="h-5 w-5 text-emerald-500" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCurrency(summaryMetrics.refundValue)}</div>
                <p
                  className={`mt-1 text-xs ${
                    summaryMetrics.trends.refund >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {summaryMetrics.trends.refund >= 0 ? '+' : ''}
                  {summaryMetrics.trends.refund}‎% مقارنة بالفترة السابقة
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <Card className="border-slate-100">
          <CardHeader className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Filter className="h-5 w-5 text-indigo-500" />
                فلاتر أسباب الإرجاع والاستبدال
              </CardTitle>
              <CardDescription>
                حدد الأسباب لمتابعة تأثيرها على المنتجات والتقارير في الأسفل
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {selectedReasons.length > 0 && (
                <p className="text-sm text-slate-500">
                  تم تفعيل {formatNumber(selectedReasons.length)} أسباب
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearReasons}
                disabled={selectedReasons.length === 0}
                className="rounded-full border border-slate-200 px-3 text-slate-600 hover:text-slate-900 disabled:opacity-50"
              >
                <RefreshCcw className="h-4 w-4" />
                إعادة التعيين
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {reasonStats.length === 0 ? (
              <p className="text-sm text-slate-500">
                لا توجد أسباب مسجلة ضمن الفترة الحالية. جرّب اختيار فترة زمنية أطول أو تحديث البيانات.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {reasonStats.map((reason) => {
                  const isSelected = selectedReasons.includes(reason.id);
                  const trendColor =
                    reason.trend > 0
                      ? 'text-emerald-600'
                      : reason.trend < 0
                        ? 'text-rose-600'
                        : 'text-slate-500';
                  return (
                    <Button
                      key={reason.id}
                      type="button"
                      variant="outline"
                      aria-pressed={isSelected}
                      onClick={() => toggleReason(reason.id)}
                      className={`!h-auto w-full flex flex-col items-start justify-start rounded-2xl border-2 px-4 py-3 text-right ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{reason.label}</p>
                          <p className="text-xs text-slate-500">
                            {formatNumber(reason.total)} حالة • {reason.percentage}‎%
                          </p>
                        </div>
                        <span className={`text-xs font-medium ${trendColor}`}>
                          {reason.trend >= 0 ? '+' : ''}
                          {reason.trend}‎%
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        اضغط لضم أو استبعاد هذا السبب من الجداول أدناه
                      </p>
                    </Button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-slate-100">
            <CardHeader>
              <CardTitle className="text-lg">أكثر المنتجات إرجاعاً</CardTitle>
              <CardDescription>يتم ترتيب المنتجات بناءً على عدد وحدات الإرجاع المسجلة</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {mostRefundedItems.length === 0 ? (
                <p className="text-sm text-slate-500">
                  لا توجد منتجات بارزة ضمن الفترة الحالية بعد تطبيق الفلاتر.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>وحدات الإرجاع</TableHead>
                      <TableHead>القيمة المستردة</TableHead>
                      <TableHead>أبرز الأسباب</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mostRefundedItems.map((item) => (
                      <TableRow key={`refund-${item.sku}-${item.name}`}>
                        <TableCell>
                          <p className="font-medium text-slate-900">{item.name}</p>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-slate-600">{item.sku}</TableCell>
                        <TableCell className="font-semibold text-slate-900">
                          {formatNumber(item.totalQuantity)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatCurrency(item.totalValue)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {item.reasons.map((reason) => (
                              <span
                                key={`refund-reason-${item.sku}-${reason}`}
                                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-100">
            <CardHeader>
              <CardTitle className="text-lg">أكثر المنتجات استبدالاً</CardTitle>
              <CardDescription>
                ساعد فرق المخزون على تجهيز المقاسات أو الألوان المطلوبة بناءً على سجل الاستبدالات
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {mostExchangedItems.length === 0 ? (
                <p className="text-sm text-slate-500">
                  لا توجد منتجات استبدال بارزة ضمن الفترة الحالية بعد تطبيق الفلاتر.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>وحدات الاستبدال</TableHead>
                      <TableHead>القيمة</TableHead>
                      <TableHead>أبرز الأسباب</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mostExchangedItems.map((item) => (
                      <TableRow key={`exchange-${item.sku}-${item.name}`}>
                        <TableCell>
                          <p className="font-medium text-slate-900">{item.name}</p>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-slate-600">{item.sku}</TableCell>
                        <TableCell className="font-semibold text-slate-900">
                          {formatNumber(item.totalQuantity)}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatCurrency(item.totalValue)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {item.reasons.map((reason) => (
                              <span
                                key={`exchange-reason-${item.sku}-${reason}`}
                                className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-100">
          <CardHeader className="border-b border-slate-100 pb-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Search className="h-5 w-5 text-slate-500" />
                  تقرير البحث بالـ SKU
                </CardTitle>
                <CardDescription>
                  ابحث عن أي طلب إرجاع أو استبدال لمعرفة الحالة الحالية والمسار المالي
                </CardDescription>
              </div>
              <p className="text-sm text-slate-500">
                النتائج متأثرة بالفترة الزمنية الحالية وفلاتر الأسباب المختارة
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
              <div className="flex-1">
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  ابحث باستخدام رمز SKU
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-slate-400" />
                  <Input
                    value={searchSku}
                    onChange={(event) => setSearchSku(event.target.value)}
                    placeholder="مثال: DRS-4821"
                    className="rounded-2xl border-slate-200 pe-4 ps-10"
                  />
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-slate-700">الحالة</p>
                <p>
                  {filteredReports.length > 0
                    ? `${formatNumber(filteredReports.length)} نتائج مطابقة`
                    : loading
                      ? 'جاري تحميل النتائج...'
                      : 'لا يوجد نتائج للمعايير الحالية'}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {filteredReports.length === 0 ? (
              <p className="text-center text-sm text-slate-500">
                {loading
                  ? 'نقوم بتحميل بيانات المرتجعات، يرجى الانتظار لحظات.'
                  : 'لا توجد طلبات تطابق SKU أو أسباب التصفية الحالية. جرّب رمزاً آخر أو أزل بعض الفلاتر.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>الطلب</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>التاريخ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((row) => {
                    const statusLabel = STATUS_LABELS[row.status] || row.status;
                    const statusClass =
                      STATUS_COLORS[row.status] || 'border border-slate-200 bg-slate-50 text-slate-600';
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm text-slate-600">{row.sku}</TableCell>
                        <TableCell>
                          <p className="font-medium text-slate-900">{row.orderNumber}</p>
                          <p className="text-xs text-slate-500">{row.customer}</p>
                          <p className="text-xs text-slate-500">{row.resolution}</p>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.type === 'return'
                                ? 'border border-rose-100 bg-rose-50 text-rose-700'
                                : 'border border-sky-100 bg-sky-50 text-sky-700'
                            }`}
                          >
                            {row.type === 'return' ? 'إرجاع' : 'استبدال'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                            {row.reason}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium text-slate-900">
                          {formatCurrency(row.amount)}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                            {statusLabel}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{formatDate(row.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
