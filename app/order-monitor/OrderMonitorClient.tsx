'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Clock3, Loader2, RefreshCcw, Search, Truck, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select } from '@/components/ui/select';

interface MonitorRecord {
  merchantId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderReference: string | null;
  assignmentId: string | null;
  prepStatus: string | null;
  preparedById: string | null;
  preparedByName: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  waitingAt: string | null;
  shippedById: string | null;
  shippedByName: string | null;
  shippedAt: string | null;
  shippingStatus: string | null;
  courierName: string | null;
  courierCode: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  labelPrinted: boolean | null;
  labelPrintCount: number | null;
  latestActivityAt: string | null;
}

interface MonitorMeta {
  query: string | null;
  limit: number;
  days: number | null;
  counts: {
    assignments: number;
    shipments: number;
    records: number;
  };
  lastRefreshedAt: string | null;
}

const TIME_FILTERS = [
  { label: 'آخر 24 ساعة', value: '1' },
  { label: 'آخر 3 أيام', value: '3' },
  { label: 'آخر 7 أيام', value: '7' },
] as const;

const PREP_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  assigned: { label: 'بانتظار البدء', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  preparing: { label: 'قيد التحضير', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  waiting: { label: 'قيد الانتظار', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  completed: { label: 'مكتمل', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'ملغي', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const ORDER_STATUS_FILTERS = [
  { label: 'كل الحالات', value: '' },
  ...Object.entries(PREP_STATUS_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
] as const;

const SHIPPING_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  created: { label: 'تم إنشاء شحنة', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  ready: { label: 'جاهز للشحن', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  shipped: { label: 'تم الشحن', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  delivered: { label: 'تم التسليم', className: 'bg-purple-50 text-purple-700 border-purple-200' },
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('ar-SA', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatRelative = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return null;
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return `منذ ${diffMinutes} دقيقة`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `منذ ${diffHours} ساعة`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `منذ ${diffDays} أيام`;
};

const getPrepStatusMeta = (status: string | null) => {
  if (!status) {
    return { label: 'غير محدد', className: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
  return PREP_STATUS_META[status] ?? {
    label: status,
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  };
};

const getShippingStatusMeta = (status: string | null) => {
  if (!status) {
    return { label: 'لا يوجد بوليصة', className: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
  return SHIPPING_STATUS_META[status] ?? {
    label: status,
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  };
};

export default function OrderMonitorClient() {
  const [records, setRecords] = useState<MonitorRecord[]>([]);
  const [meta, setMeta] = useState<MonitorMeta | null>(null);
  const [filterDays, setFilterDays] = useState<string>(TIME_FILTERS[1].value);
  const [statusFilter, setStatusFilter] = useState<string>(ORDER_STATUS_FILTERS[0].value);
  const [missingShipmentOnly, setMissingShipmentOnly] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [activeQuery, setActiveQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [violationDialog, setViolationDialog] = useState<{
    open: boolean;
    userId: string | null;
    userName: string | null;
  }>({
    open: false,
    userId: null,
    userName: null,
  });
  const [violationForm, setViolationForm] = useState({
    title: '',
    description: '',
    points: '-5',
  });
  const [violationError, setViolationError] = useState<string | null>(null);
  const [violationSubmitting, setViolationSubmitting] = useState(false);
  const { toast } = useToast();

  const fetchRecords = useCallback(
    async (
      options?: {
        query?: string;
        days?: string;
        status?: string;
        missingShipment?: boolean;
        startDate?: string;
        endDate?: string;
        silent?: boolean;
      },
    ) => {
      const queryToUse =
        options?.query !== undefined ? options.query.trim() : activeQuery.trim();
      const daysToUse =
        options?.days !== undefined ? options.days : filterDays;
      const statusToUse =
        options?.status !== undefined ? options.status : statusFilter;
      const missingShipmentToUse =
        options?.missingShipment !== undefined
          ? options.missingShipment
          : missingShipmentOnly;
      const startDateToUse =
        options?.startDate !== undefined ? options.startDate : dateRange.start;
      const endDateToUse =
        options?.endDate !== undefined ? options.endDate : dateRange.end;
      const hasDateFilter = Boolean(startDateToUse || endDateToUse);

      const params = new URLSearchParams();
      if (queryToUse) {
        params.set('query', queryToUse);
      } else if (!hasDateFilter) {
        params.set('days', daysToUse);
      }
      params.set('limit', '80');
      if (statusToUse) {
        params.set('prepStatus', statusToUse);
      }
      if (missingShipmentToUse) {
        params.set('missingShipment', '1');
      }
      if (startDateToUse) {
        params.set('startDate', startDateToUse);
      }
      if (endDateToUse) {
        params.set('endDate', endDateToUse);
      }

      if (!options?.silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const response = await fetch(`/api/order-monitor?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'تعذر تحميل بيانات المتابعة');
        }
        setRecords(Array.isArray(data.records) ? data.records : []);
        setMeta(data.meta || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
      } finally {
        setLoading(false);
      }
    },
    [activeQuery, dateRange.end, dateRange.start, filterDays, missingShipmentOnly, statusFilter],
  );

  useEffect(() => {
    if (!activeQuery) {
      fetchRecords({ silent: true });
    }
  }, [
    activeQuery,
    dateRange.end,
    dateRange.start,
    fetchRecords,
    filterDays,
    missingShipmentOnly,
    statusFilter,
  ]);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = searchDraft.trim();
      setActiveQuery(trimmed);
      fetchRecords({ query: trimmed });
    },
    [fetchRecords, searchDraft],
  );

  const handleClearSearch = useCallback(() => {
    setSearchDraft('');
    setActiveQuery('');
    fetchRecords({ query: '' });
  }, [fetchRecords]);

  const handleRefresh = useCallback(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleFilterChange = useCallback(
    (value: string) => {
      setFilterDays(value);
      if (!activeQuery) {
        fetchRecords({ days: value });
      }
    },
    [activeQuery, fetchRecords],
  );

  const handleStatusChange = useCallback(
    (value: string) => {
      setStatusFilter(value);
      if (activeQuery) {
        fetchRecords({ status: value });
      }
    },
    [activeQuery, fetchRecords],
  );

  const handleMissingShipmentChange = useCallback(() => {
    const nextValue = !missingShipmentOnly;
    setMissingShipmentOnly(nextValue);
    if (activeQuery) {
      fetchRecords({ missingShipment: nextValue });
    }
  }, [activeQuery, fetchRecords, missingShipmentOnly]);

  const handleDateChange = useCallback(
    (field: 'start' | 'end', value: string) => {
      setDateRange((prev) => ({
        ...prev,
        [field]: value,
      }));
      if (activeQuery) {
        fetchRecords(
          field === 'start'
            ? { startDate: value }
            : { endDate: value },
        );
      }
    },
    [activeQuery, fetchRecords],
  );

  const handleClearDates = useCallback(() => {
    setDateRange({ start: '', end: '' });
    if (activeQuery) {
      fetchRecords({ startDate: '', endDate: '' });
    }
  }, [activeQuery, fetchRecords]);

  const isDateFilterActive = Boolean(dateRange.start || dateRange.end);

  const lastUpdatedLabel = useMemo(() => {
    if (!meta?.lastRefreshedAt) {
      return 'غير محدث';
    }
    const relative = formatRelative(meta.lastRefreshedAt);
    return relative || formatDateTime(meta.lastRefreshedAt);
  }, [meta?.lastRefreshedAt]);

  const hasRecords = records.length > 0;

  const openViolationDialog = useCallback((userId: string, userName?: string | null) => {
    setViolationDialog({
      open: true,
      userId,
      userName: userName || null,
    });
    setViolationForm({
      title: '',
      description: '',
      points: '-5',
    });
    setViolationError(null);
  }, []);

  const closeViolationDialog = useCallback(() => {
    setViolationDialog({
      open: false,
      userId: null,
      userName: null,
    });
    setViolationError(null);
  }, []);

  const handleViolationSubmit = useCallback(async () => {
    if (!violationDialog.userId) {
      setViolationError('لا يمكن تحديد المستخدم المطلوب');
      return;
    }

    const title = violationForm.title.trim();
    if (!title) {
      setViolationError('يرجى إدخال عنوان للمخالفة');
      return;
    }

    const description = violationForm.description.trim();
    const numericPoints = Number(violationForm.points || '-5');
    const points = Number.isFinite(numericPoints) ? Math.round(numericPoints) : -5;

    setViolationSubmitting(true);
    setViolationError(null);
    try {
      const response = await fetch('/api/user-recognition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: violationDialog.userId,
          kind: 'PENALTY',
          title,
          description: description || undefined,
          points,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'تعذر إنشاء المخالفة');
      }
      toast({
        description: `تم تسجيل مخالفة لـ ${violationDialog.userName || 'المستخدم'}`,
      });
      closeViolationDialog();
    } catch (err) {
      setViolationError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setViolationSubmitting(false);
    }
  }, [closeViolationDialog, toast, violationDialog.userId, violationDialog.userName, violationForm.description, violationForm.points, violationForm.title]);

  const renderUserWithActions = useCallback(
    (userId: string | null, userName: string | null) => {
      if (!userName) {
        return <span className="text-slate-400">غير محدد</span>;
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{userName}</span>
          {userId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openViolationDialog(userId, userName)}
              className="rounded-full border-amber-200 bg-amber-50 px-3 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
            >
              إضافة مخالفة
            </Button>
          )}
        </div>
      );
    },
    [openViolationDialog],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar title="متابعة التحضير والشحن" subtitle="راقب سير الطلبات" />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-slate-100 bg-white/90 p-4 shadow-sm shadow-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-slate-500">وضع التحديث</p>
            <p className="text-base font-semibold text-slate-900">آخر تحديث: {lastUpdatedLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleRefresh}
              className="rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              <RefreshCcw className="ml-2 h-4 w-4" />
              تحديث الآن
            </Button>
            {activeQuery && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleClearSearch}
                className="rounded-2xl border border-slate-100"
              >
                مسح البحث
              </Button>
            )}
          </div>
        </div>

        <form
          onSubmit={handleSearchSubmit}
          className="mb-6 flex flex-col gap-3 rounded-3xl border border-slate-100 bg-white/90 p-4 shadow-sm shadow-slate-200 sm:flex-row sm:items-center"
        >
          <div className="flex-1">
            <label htmlFor="monitor-search" className="mb-2 block text-sm font-medium text-slate-600">
              ابحث برقم الطلب، المرجع أو رقم التتبع
            </label>
            <div className="flex gap-2">
              <Input
                id="monitor-search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="مثال: 112233 أو #A123"
                className="rounded-2xl border-slate-200 px-4 py-6 text-base"
              />
              <Button
                type="submit"
                className="rounded-2xl bg-slate-900 px-6 py-6 text-base font-semibold"
              >
                <Search className="ml-2 h-4 w-4" />
                بحث
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {TIME_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                onClick={() => handleFilterChange(filter.value)}
                disabled={isDateFilterActive}
                className={cn(
                  'rounded-2xl border px-4 py-3 text-sm font-semibold transition',
                  filterDays === filter.value && !activeQuery
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700',
                )}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </form>

        <div className="mb-6 grid gap-4 rounded-3xl border border-slate-100 bg-white/90 p-4 shadow-sm shadow-slate-200 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label htmlFor="status-filter" className="mb-2 block text-sm font-medium text-slate-600">
                حالة التحضير
              </label>
              <Select
                id="status-filter"
                value={statusFilter}
                onChange={(event) => handleStatusChange(event.target.value)}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
              >
                {ORDER_STATUS_FILTERS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={missingShipmentOnly}
                onChange={handleMissingShipmentChange}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              عرض الطلبات التي لا تحتوي على شحنة
            </label>
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-600">فلترة بالتاريخ</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1 space-y-1">
                <span className="text-xs text-slate-500">من</span>
                <Input
                  type="date"
                  value={dateRange.start}
                  onChange={(event) => handleDateChange('start', event.target.value)}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex-1 space-y-1">
                <span className="text-xs text-slate-500">إلى</span>
                <Input
                  type="date"
                  value={dateRange.end}
                  onChange={(event) => handleDateChange('end', event.target.value)}
                  className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClearDates}
                disabled={!isDateFilterActive}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold"
              >
                مسح التاريخ
              </Button>
              <p className="text-xs text-slate-500">
                عند اختيار تاريخ يتم تجاهل فلتر الأيام أعلاه تلقائياً.
              </p>
            </div>
          </div>
        </div>

        {meta && (
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <Card className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
              <p className="text-sm text-slate-500">السجلات المعروضة</p>
              <p className="text-2xl font-semibold text-slate-900">{meta.counts.records}</p>
            </Card>
            <Card className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
              <p className="text-sm text-slate-500">طلبات التحضير المطابقة</p>
              <p className="text-2xl font-semibold text-slate-900">{meta.counts.assignments}</p>
            </Card>
            <Card className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
              <p className="text-sm text-slate-500">شحنات مطابقة</p>
              <p className="text-2xl font-semibold text-slate-900">{meta.counts.shipments}</p>
            </Card>
          </div>
        )}

        {error && (
          <Card className="mb-6 flex items-center gap-3 rounded-3xl border border-rose-100 bg-rose-50/60 p-4 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
            <p className="text-sm font-semibold">{error}</p>
          </Card>
        )}

        {loading && (
          <div className="mb-6 flex items-center gap-3 rounded-3xl border border-slate-100 bg-white p-6">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            <p className="text-slate-600">جاري تحميل البيانات...</p>
          </div>
        )}

        {!loading && !hasRecords && (
          <Card className="rounded-3xl border border-slate-100 bg-white p-8 text-center text-slate-500">
            لا توجد سجلات مطابقة حالياً. جرّب تغيير الفلتر أو البحث برقم محدد.
          </Card>
        )}

        <div className="space-y-4">
          {records.map((record) => {
            const prepMeta = getPrepStatusMeta(record.prepStatus);
            const shippingMeta = getShippingStatusMeta(record.shippingStatus);
            const latestRelative = formatRelative(record.latestActivityAt);
            return (
              <Card
                key={`${record.orderId}-${record.assignmentId || 'shipment'}`}
                className="rounded-3xl border border-slate-100 bg-white/95 p-5 shadow-sm shadow-slate-200"
              >
                <div className="mb-4 flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-500">رقم الطلب</p>
                    <p className="text-xl font-semibold text-slate-900">
                      {record.orderNumber || 'غير متوفر'}
                    </p>
                    <div className="mt-1 text-xs text-slate-500">
                      <span>معرف سلة: {record.orderId}</span>
                      {record.orderReference && (
                        <span className="ml-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                          مرجع: {record.orderReference}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <Clock3 className="h-4 w-4 text-slate-500" />
                    <span>
                      آخر نشاط:{' '}
                      {record.latestActivityAt
                        ? formatDateTime(record.latestActivityAt)
                        : 'غير محدد'}
                    </span>
                    {latestRelative && <span className="text-slate-400">({latestRelative})</span>}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                    <div className="mb-3 flex items-center gap-2 text-slate-600">
                      <UserCheck className="h-4 w-4 text-indigo-600" />
                      <span className="text-sm font-semibold">تحضير الطلب</span>
                    </div>
                    <div className="mb-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold',
                          prepMeta.className,
                        )}
                      >
                        {prepMeta.label}
                      </span>
                    </div>
                    <dl className="space-y-2 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <dt>المسؤول</dt>
                        <dd>{renderUserWithActions(record.preparedById, record.preparedByName)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt>وقت التعيين</dt>
                        <dd>{formatDateTime(record.assignedAt)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt>بداية التحضير</dt>
                        <dd>{formatDateTime(record.startedAt)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt>وقت الإكمال</dt>
                        <dd>{formatDateTime(record.completedAt)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="mb-3 flex items-center gap-2 text-slate-600">
                      <Truck className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm font-semibold">الشحن والبوليصة</span>
                    </div>
                    <div className="mb-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold',
                          shippingMeta.className,
                        )}
                      >
                        {shippingMeta.label}
                      </span>
                    </div>
                    <dl className="space-y-2 text-sm text-slate-600">
                      <div className="flex items-center justify-between">
                        <dt>مسؤول الشحن</dt>
                        <dd>{renderUserWithActions(record.shippedById, record.shippedByName)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt>وقت طباعة البوليصة</dt>
                        <dd>{formatDateTime(record.shippedAt)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt>شركة الشحن</dt>
                        <dd>{record.courierName || '—'}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt>رقم التتبع</dt>
                        <dd className="font-mono text-xs text-slate-900">
                          {record.trackingNumber || '—'}
                        </dd>
                      </div>
                      {record.labelUrl && (
                        <div className="flex items-center justify-between">
                          <dt>رابط البوليصة</dt>
                          <dd>
                            <a
                              href={record.labelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 underline"
                            >
                              فتح
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
      <ConfirmationDialog
        open={violationDialog.open}
        title="تسجيل مخالفة"
        message={
          violationDialog.userName
            ? `سيتم إنشاء مخالفة للمستخدم ${violationDialog.userName}`
            : 'يرجى إدخال تفاصيل المخالفة'
        }
        onCancel={closeViolationDialog}
        onConfirm={handleViolationSubmit}
        confirmVariant="danger"
        confirmLabel={violationSubmitting ? 'جاري الحفظ...' : 'حفظ المخالفة'}
        confirmDisabled={
          violationSubmitting || !violationDialog.userId || !violationForm.title.trim()
        }
        content={
          <div className="mt-4 space-y-3">
            {violationError && (
              <p className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {violationError}
              </p>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600" htmlFor="violation-title">
                عنوان المخالفة
              </label>
              <Input
                id="violation-title"
                value={violationForm.title}
                onChange={(event) =>
                  setViolationForm((prev) => ({ ...prev, title: event.target.value }))
                }
                className="rounded-2xl"
                placeholder="مثال: تأخير في تحضير الطلب"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600" htmlFor="violation-points">
                النقاط
              </label>
              <Input
                id="violation-points"
                type="number"
                inputMode="numeric"
                value={violationForm.points}
                onChange={(event) =>
                  setViolationForm((prev) => ({ ...prev, points: event.target.value }))
                }
                className="rounded-2xl"
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-xs font-semibold text-slate-600"
                htmlFor="violation-description"
              >
                تفاصيل إضافية
              </label>
              <textarea
                id="violation-description"
                rows={4}
                value={violationForm.description}
                onChange={(event) =>
                  setViolationForm((prev) => ({ ...prev, description: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                placeholder="أضف تفاصيل يمكن للإداري مراجعتها"
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
