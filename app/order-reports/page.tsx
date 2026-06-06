'use client';

import Link from 'next/link';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import {
  Calendar,
  Package,
  TrendingUp,
  User,
  Phone,
  CreditCard,
  MapPin,
  LoaderCircle,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Megaphone,
  FileSpreadsheet,
} from 'lucide-react';
import {
  getERPOrderSyncError,
  hasSuccessfulERPSync,
} from '@/lib/erp-order-sync';

interface OrderShipmentInfo {
  id: string | null;
  company: string | null;
  trackingNumber: string | null;
  statusSlug: string | null;
  statusLabel: string | null;
  shippingType: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

interface OrderRecord {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  statusSlug: string | null;
  statusName: string | null;
  fulfillmentStatus: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  shippingAmount: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
  customerId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  customerCity: string | null;
  customerCountry: string | null;
  fulfillmentCompany: string | null;
  trackingNumber: string | null;
  placedAt: string | null;
  updatedAtRemote: string | null;
  rawOrder: any;
  erpSyncedAt: string | null;
  erpInvoiceId: string | null;
  erpSyncError: string | null;
  campaignSource: string | null;
  campaignMedium: string | null;
  campaignName: string | null;
  shipments?: OrderShipmentInfo[];
}

type OrderReportRow = Record<string, string | number | null | undefined>;

interface Stats {
  total: number;
  completed: number;
  cancelled: number;
  inProgress: number;
  totalAmount: number;
  averageAmount: number;
}

interface StatusStats {
  slug: string;
  name: string;
  count: number;
  percentage: number;
}

const HISTORY_PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 200;
const DEFAULT_STATUS_OPTIONS = [
  { slug: 'completed', name: 'تم التنفيذ' },
  { slug: 'delivered', name: 'تم التوصيل' },
  { slug: 'in_progress', name: 'قيد التنفيذ' },
  { slug: 'payment_pending', name: 'في انتظار الدفع' },
  { slug: 'canceled', name: 'ملغي' },
];
const STATUS_BADGE_MAP: Record<string, string> = {
  completed: 'bg-green-50 border-green-200 text-green-700',
  delivered: 'bg-green-50 border-green-200 text-green-700',
  ready_for_pickup: 'bg-green-50 border-green-200 text-green-700',
  fulfilled: 'bg-green-50 border-green-200 text-green-700',
  canceled: 'bg-red-50 border-red-200 text-red-700',
  cancelled: 'bg-red-50 border-red-200 text-red-700',
  restored: 'bg-red-50 border-red-200 text-red-700',
  removed: 'bg-red-50 border-red-200 text-red-700',
  payment_pending: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  under_review: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  in_progress: 'bg-blue-50 border-blue-200 text-blue-700',
  processing: 'bg-blue-50 border-blue-200 text-blue-700',
  delivering: 'bg-purple-50 border-purple-200 text-purple-700',
  delivered_pending: 'bg-purple-50 border-purple-200 text-purple-700',
};

export default function OrderReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusStats, setStatusStats] = useState<StatusStats[]>([]);
  const [statusOptions, setStatusOptions] = useState<{ slug: string; name: string }[]>(DEFAULT_STATUS_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCampaignSource, setFilterCampaignSource] = useState('');
  const [filterCampaignName, setFilterCampaignName] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [filterErpSync, setFilterErpSync] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'stats'>('stats');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [pageMessage, setPageMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<{ value: string; label: string; count: number }[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // Check if user is accountant
  const userRole = (session?.user as any)?.role;
  const userRoles = (session?.user as any)?.roles || [];
  const isAccountant = userRole === 'accountant' || userRoles.includes('accountant');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const buildQueryParams = useCallback((pageToLoad: number, limit: number) => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (filterStatus) params.append('status', filterStatus);
    if (filterCampaignSource) params.append('campaignSource', filterCampaignSource);
    if (filterCampaignName) params.append('campaignName', filterCampaignName);
    if (filterPaymentMethod) params.append('paymentMethod', filterPaymentMethod);
    if (filterErpSync) params.append('erpSynced', filterErpSync);
    params.append('page', pageToLoad.toString());
    params.append('limit', limit.toString());
    params.append('sortDirection', sortDirection);
    return params;
  }, [startDate, endDate, filterStatus, filterCampaignSource, filterCampaignName, filterPaymentMethod, filterErpSync, sortDirection]);

  const fetchOrders = useCallback(async (pageToLoad = 1, append = false) => {
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setLoading(true);
        setHasMore(false);
      }
      const query = buildQueryParams(pageToLoad, HISTORY_PAGE_SIZE).toString();
      const response = await fetch(
        `/api/order-history/admin${query ? `?${query}` : ''}`
      );
      const data = await response.json();
      if (data.success) {
        const fetchedOrders: OrderRecord[] = data.orders ?? [];
        setOrders((prev) => (append ? [...prev, ...fetchedOrders] : fetchedOrders));
        setStats(data.stats);
        setStatusStats(data.statusStats ?? []);
        setStatusOptions(
          data.filters?.statuses?.length ? data.filters.statuses : DEFAULT_STATUS_OPTIONS
        );
        setPaymentMethodOptions(data.filters?.paymentMethods || []);
        setHasMore(Boolean(data.pagination?.hasMore));
        setPage(data.pagination?.page ?? pageToLoad);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [buildQueryParams]);

  useEffect(() => {
    if (session?.user) {
      fetchOrders(1);
    }
  }, [session, fetchOrders]);

  const getStatusColor = (slug: string | null) => {
    const normalized = slug ? slug.toLowerCase() : 'default';
    return STATUS_BADGE_MAP[normalized] ?? 'bg-gray-50 border-gray-200 text-gray-700';
  };

  const formatStatusText = (name: string | null, slug: string | null) => {
    return name ?? slug ?? 'غير معروف';
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return 'غير متوفر';
    const parsed = typeof date === 'string' ? new Date(date) : date;
    if (Number.isNaN(parsed.getTime())) return 'غير متوفر';
    return parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrencyValue = (amount: number | null, currency?: string | null): ReactNode => {
    if (amount === null || amount === undefined) return 'غير متوفر';
    const formatted = amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return (
      <span className="inline-flex items-center gap-1">
        <span>{formatted}</span>
        {currency ? (
          <span className="text-xs uppercase text-gray-500">{currency}</span>
        ) : (
          <svg className="h-5 w-5 text-gray-600" viewBox="0 0 1124.14 1256.39" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z"/>
            <path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z"/>
          </svg>
        )}
      </span>
    );
  };

  const formatNumber = (value: number) => {
    return value.toLocaleString('en-US');
  };

  const translatePaymentMethod = (method: string): string => {
    const translations: Record<string, string> = {
      'cash': 'الدفع عند الاستلام',
      'cod': 'الدفع عند الاستلام',
      'credit_card': 'بطاقة ائتمان',
      'bank': 'تحويل بنكي',
      'bank_transfer': 'تحويل بنكي',
      'mada': 'مدى',
      'visa': 'فيزا',
      'mastercard': 'ماستركارد',
      'apple_pay': 'آبل باي',
      'stc_pay': 'STC Pay',
      'tabby': 'تابي',
      'tabby_installment': 'تابي',
      'tamara': 'تمارا',
      'tamara_installment': 'تمارا',
      'wallet': 'محفظة إلكترونية',
      'free': 'مجاني',
      'waiting': 'بانتظار الدفع',
    };
    return translations[method.toLowerCase()] || method;
  };

  const formatShipmentDetails = (shipments?: OrderShipmentInfo[]) => {
    if (!shipments || shipments.length === 0) return '';
    return shipments
      .map((shipment, index) => {
        const status = formatStatusText(shipment.statusLabel, shipment.statusSlug);
        const parts = [
          `${index + 1})`,
          shipment.company || 'غير معروف',
          shipment.trackingNumber || 'بدون تتبع',
        ];
        if (status && status !== 'غير معروف') {
          parts.push(status);
        }
        return parts.join(' - ');
      })
      .join(' | ');
  };

  const handleExportToExcel = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setPageMessage(null);

    try {
      const allOrders: OrderRecord[] = [];
      let exportPage = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const query = buildQueryParams(exportPage, EXPORT_PAGE_SIZE).toString();
        const response = await fetch(`/api/order-history/admin${query ? `?${query}` : ''}`);
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || data.message || 'فشل في جلب بيانات الطلبات');
        }

        const fetchedOrders: OrderRecord[] = data.orders ?? [];
        allOrders.push(...fetchedOrders);

        const pagination = data.pagination;
        if (pagination?.hasMore && fetchedOrders.length > 0) {
          exportPage = (pagination.page ?? exportPage) + 1;
        } else {
          hasMorePages = false;
        }

        if (!fetchedOrders.length) {
          hasMorePages = false;
        }
      }

      if (allOrders.length === 0) {
        setPageMessage({
          type: 'error',
          text: 'لا توجد بيانات مطابقة للفلاتر الحالية لتصديرها',
        });
        setTimeout(() => setPageMessage(null), 5000);
        return;
      }

      const rows = allOrders.map<OrderReportRow>((order, index) => {
        const hasSuccessfulSync = hasSuccessfulERPSync(order);
        const erpSyncError = getERPOrderSyncError(order);
        const shipments = order.shipments ?? [];
        return {
          '#': index + 1,
          'رقم الطلب': order.orderNumber ?? order.orderId,
          'معرف الطلب': order.orderId,
          'تاريخ الطلب': formatDate(order.placedAt ?? order.updatedAtRemote),
          'الحالة': formatStatusText(order.statusName, order.statusSlug),
          'حالة الدفع': order.paymentStatus ?? '',
          'طريقة الدفع': order.paymentMethod ? translatePaymentMethod(order.paymentMethod) : '',
          'القيمة الإجمالية': order.totalAmount ?? '',
          'العملة': order.currency ?? '',
          'اسم العميل': !isAccountant ? order.customerName ?? '' : '',
          'جوال العميل': !isAccountant ? order.customerMobile ?? '' : '',
          'المدينة': !isAccountant ? order.customerCity ?? '' : '',
          'مصدر الحملة': order.campaignSource ?? '',
          'Medium الحملة': order.campaignMedium ?? '',
          'اسم الحملة': order.campaignName ?? '',
          'شركة الشحن': order.fulfillmentCompany ?? '',
          'رقم التتبع': order.trackingNumber ?? '',
          'عدد الشحنات من API': shipments.length ? shipments.length : '',
          'تفاصيل الشحنات من API': formatShipmentDetails(shipments),
          'متزامن مع ERP': hasSuccessfulSync ? 'نعم' : 'لا',
          'تاريخ المزامنة': hasSuccessfulSync ? formatDate(order.erpSyncedAt) : '',
          'فاتورة ERP': order.erpInvoiceId ?? '',
          'خطأ المزامنة': erpSyncError ?? '',
        };
      });

      const columnKeys = rows.length > 0 ? Object.keys(rows[0]) : [];
      const columnsWithData = columnKeys.filter(key =>
        rows.some(row => {
          const value = row[key];
          return value !== '' && value !== null && value !== undefined;
        })
      );
      const trimmedRows = rows.map(row => {
        const trimmedRow: Record<string, any> = {};
        columnsWithData.forEach(key => {
          trimmedRow[key] = row[key];
        });
        return trimmedRow;
      });

      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(trimmedRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Order Reports');
      const timestamp = new Date().toISOString().split('T')[0];
      XLSX.writeFile(workbook, `order-reports-${timestamp}.xlsx`);

      setPageMessage({
        type: 'success',
        text: `تم تصدير ${allOrders.length} طلب في ملف Excel`,
      });
      setTimeout(() => setPageMessage(null), 5000);
    } catch (error) {
      console.error('Error exporting orders:', error);
      setPageMessage({
        type: 'error',
        text: 'حدث خطأ أثناء تصدير الملف، حاول مرة أخرى',
      });
      setTimeout(() => setPageMessage(null), 5000);
    } finally {
      setIsExporting(false);
    }
  };

  if (loading && orders.length === 0) {
    return (
      <AppPageShell title="تقارير الطلبات" subtitle="جاري تحميل بيانات الطلبات">
        <Card>
          <LoadingState />
        </Card>
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      title="تقارير الطلبات"
      subtitle="عرض وتحليل بيانات الطلبات مع متابعة حالة مزامنة ERP"
    >
      <div className="mx-auto w-full max-w-7xl">

        {/* Page Message */}
        {pageMessage && (
          <Alert
            variant={pageMessage.type === 'error' ? 'destructive' : 'default'}
            className="mb-4"
          >
            <AlertDescription>{pageMessage.text}</AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="mb-6 grid gap-2 sm:grid-cols-2">
          <Button
            onClick={() => setViewMode('stats')}
            variant={viewMode === 'stats' ? 'default' : 'outline'}
          >
            <TrendingUp className="ml-2 h-4 w-4" />
            الإحصائيات
          </Button>
          <Button
            onClick={() => setViewMode('list')}
            variant={viewMode === 'list' ? 'default' : 'outline'}
          >
            <Package className="ml-2 h-4 w-4" />
            قائمة الطلبات
          </Button>
        </div>

        {/* Overall Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <Card className="p-4">
              <div className="text-sm text-gray-600">إجمالي الطلبات</div>
              <div className="text-2xl font-bold text-gray-900">{formatNumber(stats.total)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">طلبات مكتملة/مستلمة</div>
              <div className="text-2xl font-bold text-green-600">{formatNumber(stats.completed)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">طلبات جارية</div>
              <div className="text-2xl font-bold text-blue-600">{formatNumber(stats.inProgress)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">طلبات ملغاة/مسترجعة</div>
              <div className="text-2xl font-bold text-red-600">{formatNumber(stats.cancelled)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">إجمالي المبيعات المقدرة</div>
              <div className="text-2xl font-bold text-purple-600 flex items-center gap-2">
                {formatCurrencyValue(stats.totalAmount)}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-gray-600">متوسط قيمة الطلب</div>
              <div className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
                {formatCurrencyValue(stats.averageAmount)}
              </div>
            </Card>
          </div>
        )}

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field>
              <FieldLabel>حالة الطلب</FieldLabel>
              <NativeSelect
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full"
              >
                <option value="">الكل</option>
                {statusOptions.map((statusOption, index) => (
                  <option key={`${statusOption.slug ?? 'status'}-${index}`} value={statusOption.slug ?? ''}>
                    {statusOption.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>من تاريخ</FieldLabel>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>إلى تاريخ</FieldLabel>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>ترتيب العرض</FieldLabel>
              <NativeSelect
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}
                className="w-full"
              >
                <option value="desc">من الأحدث إلى الأقدم</option>
                <option value="asc">من الأقدم إلى الأحدث</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>مصدر الحملة</FieldLabel>
              <Input
                type="text"
                value={filterCampaignSource}
                onChange={(e) => setFilterCampaignSource(e.target.value)}
                placeholder="مثال: coupon"
              />
            </Field>
            <Field>
              <FieldLabel>اسم الحملة</FieldLabel>
              <Input
                type="text"
                value={filterCampaignName}
                onChange={(e) => setFilterCampaignName(e.target.value)}
                placeholder="مثال: ml"
              />
            </Field>
            <Field>
              <FieldLabel>طريقة الدفع</FieldLabel>
              <NativeSelect
                value={filterPaymentMethod}
                onChange={(e) => setFilterPaymentMethod(e.target.value)}
                className="w-full"
              >
                <option value="">الكل</option>
                {paymentMethodOptions.map((pm, index) => (
                  <option key={`${pm.value}-${index}`} value={pm.value}>
                    {translatePaymentMethod(pm.value)} ({pm.count})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel>حالة مزامنة ERP</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={filterErpSync === '' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 min-w-[120px]"
                  onClick={() => setFilterErpSync('')}
                >
                  جميع الطلبات
                </Button>
                <Button
                  type="button"
                  variant={filterErpSync === 'true' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 min-w-[120px]"
                  onClick={() => setFilterErpSync(filterErpSync === 'true' ? '' : 'true')}
                >
                  المتزامنة مع ERP
                </Button>
                <Button
                  type="button"
                  variant={filterErpSync === 'false' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 min-w-[120px]"
                  onClick={() => setFilterErpSync(filterErpSync === 'false' ? '' : 'false')}
                >
                  غير المتزامنة
                </Button>
              </div>
            </Field>
            <div className="md:col-span-2 lg:col-span-1 flex items-end">
              <Button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setFilterStatus('');
                  setFilterCampaignSource('');
                  setFilterCampaignName('');
                  setFilterPaymentMethod('');
                  setFilterErpSync('');
                  setSortDirection('desc');
                }}
                variant="outline"
                className="w-full"
              >
                مسح الفلاتر
              </Button>
            </div>
          </div>
        </Card>

        <Card className="mb-6 border border-sky-100 bg-gradient-to-r from-sky-50 to-white p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-sky-900">تم نقل مزامنة ERP إلى صفحة مستقلة</h2>
              <p className="text-sm text-sky-800">
                استخدم صفحة مزامنة ERP لإرسال طلبات يوم كامل أو نطاق زمني كامل إلى ERP، مع
                مزامنة المرتجعات أيضاً بدون الحاجة إلى تحميل المزيد من الطلبات هنا.
              </p>
            </div>
            <Button asChild className="w-full bg-sky-600 hover:bg-sky-700 md:w-auto">
              <Link href="/erp-sync" className="shrink-0">
                <ArrowUpRight className="ml-2 h-4 w-4" />
                فتح صفحة مزامنة ERP
              </Link>
            </Button>
          </div>
        </Card>

        {/* Content based on view mode */}
        {viewMode === 'stats' ? (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-6 w-6" />
              إحصائيات حالات الطلبات
            </h2>
            {statusStats.length === 0 ? (
              <EmptyState
                title="لا توجد بيانات"
                description="غيّر الفلاتر أو نطاق التاريخ لعرض إحصائيات الطلبات."
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {statusStats.map((statusStat, index) => (
                  <Card key={`${statusStat.slug ?? 'statusStat'}-${index}`} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-lg">{statusStat.name}</h3>
                        <p className="text-sm text-gray-500">الحالة: {statusStat.slug}</p>
                      </div>
                      <div className="text-3xl font-bold text-blue-600">{formatNumber(statusStat.count)}</div>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <span>النسبة من الإجمالي</span>
                      <span className="font-semibold text-gray-900">
                        {statusStat.percentage.toFixed(1)}%
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Orders List */
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Package className="h-6 w-6" />
                قائمة الطلبات
              </h2>
              <div className="flex items-center gap-3">
                {stats && (
                  <p className="text-sm text-gray-600">
                    عرض {formatNumber(orders.length)} من {formatNumber(stats.total)} طلب
                  </p>
                )}
                <Button asChild variant="outline" size="sm">
                  <Link href="/erp-sync">
                    <ArrowUpRight className="ml-2 h-4 w-4" />
                    مزامنة ERP
                  </Link>
                </Button>
                <Button
                  onClick={handleExportToExcel}
                  disabled={isExporting}
                  variant="outline"
                  size="sm"
                >
                  {isExporting ? (
                    <>
                      <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />
                      جاري التصدير...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="ml-2 h-4 w-4" />
                      تصدير إلى Excel
                    </>
                  )}
                </Button>
              </div>
            </div>
            {orders.length === 0 ? (
              <EmptyState
                title="لا توجد طلبات في السجل"
                description="لا توجد طلبات مطابقة للفلاتر الحالية."
              />
            ) : (
              <>
                {orders.map((order, index) => {
                  const cardKey = order.id ?? order.orderNumber ?? order.orderId ?? 'order';
                  return (
                    <Card key={`${cardKey}-${index}`} className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-lg">
                              #{order.orderNumber ?? order.orderId}
                            </h3>
                            <Badge variant="outline" className={getStatusColor(order.statusSlug)}>
                              {formatStatusText(order.statusName, order.statusSlug)}
                            </Badge>
                          </div>
                          <div className="text-sm text-gray-600 space-y-1">
                            {!isAccountant && order.customerName && (
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4" />
                                <span className="font-medium">{order.customerName}</span>
                              </div>
                            )}
                            {!isAccountant && order.customerMobile && (
                              <div className="flex items-center gap-2">
                                <Phone className="h-4 w-4" />
                                <span>{order.customerMobile}</span>
                              </div>
                            )}
                            {!isAccountant && order.customerCity && (
                              <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4" />
                                <span>{order.customerCity}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span>تاريخ الطلب: {formatDate(order.placedAt ?? order.updatedAtRemote)}</span>
                            </div>
                            {order.fulfillmentCompany && (
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4" />
                                <span>شركة الشحن: {order.fulfillmentCompany}</span>
                              </div>
                            )}
                            {(order.campaignSource || order.campaignMedium || order.campaignName) && (
                              <div className="flex items-center gap-2">
                                <Megaphone className="h-4 w-4" />
                                <span>
                                  الحملة: {order.campaignName || 'غير محدد'}
                                  {order.campaignSource && ` (${order.campaignSource}`}
                                  {order.campaignMedium && ` / ${order.campaignMedium}`}
                                  {(order.campaignSource || order.campaignMedium) && ')'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-left space-y-2">
                        <div className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          <span>{formatCurrencyValue(order.totalAmount, order.currency)}</span>
                        </div>
                        {order.paymentStatus && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <CreditCard className="h-4 w-4" />
                            <span>الدفع: {order.paymentStatus}</span>
                          </div>
                        )}
                        {order.paymentMethod && (
                          <div className="text-sm text-gray-500">
                            طريقة الدفع: {order.paymentMethod}
                          </div>
                        )}
                        {order.trackingNumber && (
                          <div className="text-sm text-gray-500">
                            رقم التتبع: {order.trackingNumber}
                          </div>
                        )}

                        {/* ERP Sync Status */}
                        <div className="mt-3 pt-3 border-t space-y-2">
                          {hasSuccessfulERPSync(order) ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle2 className="h-4 w-4" />
                                <span>مزامن مع ERP</span>
                              </div>
                              {order.erpInvoiceId && (
                                <div className="bg-green-50 p-2 rounded">
                                  <p className="text-xs text-gray-600">رقم الفاتورة:</p>
                                  <p className="text-sm font-bold text-green-700">{order.erpInvoiceId}</p>
                                </div>
                              )}
                            </div>
                          ) : getERPOrderSyncError(order) ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm text-red-600">
                                <XCircle className="h-4 w-4" />
                                <span>فشل المزامنة</span>
                              </div>
                              <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                                {getERPOrderSyncError(order)}
                              </div>
                              <p className="text-xs text-sky-700">
                                أعد المحاولة من{' '}
                                <Link href="/erp-sync" className="font-medium underline underline-offset-2">
                                  صفحة مزامنة ERP
                                </Link>
                                .
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Package className="h-4 w-4" />
                                <span>لم تتم المزامنة</span>
                              </div>
                              <p className="text-xs text-sky-700">
                                نفّذ المزامنة من{' '}
                                <Link href="/erp-sync" className="font-medium underline underline-offset-2">
                                  صفحة مزامنة ERP
                                </Link>
                                .
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    </Card>
                  );
                })}
                {hasMore && (
                  <div className="flex justify-center">
                    <Button
                      onClick={() => fetchOrders(page + 1, true)}
                      disabled={isLoadingMore}
                      className="min-w-[200px]"
                    >
                      {isLoadingMore ? 'جاري التحميل...' : 'تحميل المزيد'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </AppPageShell>
  );
}
