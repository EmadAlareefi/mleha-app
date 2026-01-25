'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, PackageSearch, RefreshCcw, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import AppNavbar from '@/components/AppNavbar';
import type {
  SallaPaginationMeta,
  SallaProductSummary,
  SallaProductVariation,
} from '@/app/lib/salla-api';

const PAGE_SIZE = 100;
const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'hidden', label: 'مخفي' },
  { value: 'sale', label: 'تخفيض' },
  { value: 'out', label: 'نافد' },
];

type NewRequestPayload = {
  requestedFrom: string;
  requestedAmount: number;
  requestedRefundAmount?: number | null;
  requestedFor?: string;
  notes?: string;
};

type QuantityRequestRecord = {
  id: string;
  productId: number;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  requestedAmount: number;
  requestedRefundAmount?: number | null;
  requestedFrom: string;
  requestedBy: string;
  requestedFor?: string | null;
  notes?: string | null;
  status: 'pending' | 'completed';
  requestedAt: string;
  fulfilledAt?: string | null;
  providedBy?: string | null;
  providedAmount?: number | null;
};

type ActionResult = { success: true } | { success: false; error: string };

function formatCurrency(value: number | null | undefined, currency?: string) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ''}`.trim();
  }
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'غير محدد';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export default function SallaProductsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [pagination, setPagination] = useState<SallaPaginationMeta | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchSku, setSearchSku] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [productRequests, setProductRequests] = useState<Record<number, QuantityRequestRecord[]>>({});
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [variationsMap, setVariationsMap] = useState<Record<number, SallaProductVariation[]>>({});
  const [productVariationErrors, setProductVariationErrors] = useState<Record<number, string>>({});
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variationsGlobalError, setVariationsGlobalError] = useState<string | null>(null);
  const [rowVariationsLoading, setRowVariationsLoading] = useState<Record<number, boolean>>({});
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const variationsRequestId = useRef(0);

  const currentUserName = useMemo(() => {
    const user = session?.user as any;
    return user?.name || user?.username || 'مستخدم';
  }, [session]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchProducts = useCallback(
    async (page: number, sku: string, statusValue: string) => {
      setLoading(true);
      setError(null);

      try {
        if (sku) {
          const encodedSku = encodeURIComponent(sku);
          const response = await fetch(`/api/salla/products/sku/${encodedSku}`, {
            cache: 'no-store',
          });
          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data?.error || 'تعذر العثور على المنتج في سلة بالرمز المحدد');
          }

          const product: SallaProductSummary | undefined = data.product;
          const normalizedFilter = statusValue ? statusValue.toLowerCase() : '';
          const normalizedProductStatus =
            typeof product?.status === 'string' ? product.status.toLowerCase() : '';
          const matchesStatus =
            !normalizedFilter || normalizedProductStatus === normalizedFilter;

          const productsList: SallaProductSummary[] = product && matchesStatus ? [product] : [];

          if (product && !matchesStatus) {
            setError('تم العثور على المنتج، لكنه لا يطابق حالة التصفية المحددة.');
          }

          const paginationMeta =
            productsList.length > 0
              ? { count: 1, total: 1, perPage: 1, currentPage: 1, totalPages: 1 }
              : { count: 0, total: 0, perPage: 1, currentPage: 0, totalPages: 0 };

          setProducts(productsList);
          setPagination(paginationMeta);
          setMerchantId(typeof data.merchantId === 'string' ? data.merchantId : null);
          setLastUpdated(new Date().toISOString());
          return;
        }

        const params = new URLSearchParams({
          page: page.toString(),
          perPage: PAGE_SIZE.toString(),
        });

        if (statusValue) {
          params.set('status', statusValue);
        }

        const response = await fetch(`/api/salla/products?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحميل منتجات سلة');
        }

        setProducts(Array.isArray(data.products) ? data.products : []);
        setPagination(data.pagination ?? null);
        setMerchantId(typeof data.merchantId === 'string' ? data.merchantId : null);
        setLastUpdated(new Date().toISOString());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء تحميل المنتجات');
        setProducts([]);
        setPagination(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchVariations = useCallback(
    async (items: SallaProductSummary[]) => {
      if (!items || items.length === 0) {
        setVariationsMap({});
        setProductVariationErrors({});
        setVariationsGlobalError(null);
        setVariationsLoading(false);
        setRowVariationsLoading({});
        return;
      }

      const ids = items.map((item) => item.id);
      const requestId = Date.now();
      variationsRequestId.current = requestId;
      setVariationsLoading(true);
      setVariationsGlobalError(null);
      setProductVariationErrors({});
      setRowVariationsLoading({});

      try {
        const response = await fetch('/api/salla/products/variations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ productIds: ids }),
        });
        const data = await response.json();

        if (variationsRequestId.current !== requestId) {
          return;
        }

        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحميل متغيرات المنتجات');
        }

        const normalized: Record<number, SallaProductVariation[]> = {};
        Object.entries(data.variations ?? {}).forEach(([key, value]) => {
          const parsed = Number.parseInt(key, 10);
          if (Number.isFinite(parsed)) {
            normalized[parsed] = Array.isArray(value) ? value : [];
          }
        });

        items.forEach((item) => {
          if (!normalized[item.id]) {
            normalized[item.id] = [];
          }
        });

        const perProductErrors: Record<number, string> = {};
        if (Array.isArray(data.failed)) {
          data.failed.forEach((entry: { productId?: number; message?: string }) => {
            if (!entry || typeof entry.productId !== 'number') {
              return;
            }
            perProductErrors[entry.productId] =
              entry.message || 'تعذر تحميل متغيرات هذا المنتج من سلة';
          });
        }

        setVariationsMap(normalized);
        setProductVariationErrors(perProductErrors);
        setVariationsGlobalError(null);
      } catch (err) {
        if (variationsRequestId.current !== requestId) {
          return;
        }
        const message =
          err instanceof Error ? err.message : 'تعذر تحميل متغيرات المنتجات';
        setVariationsMap({});
        setProductVariationErrors({});
        setVariationsGlobalError(message);
        setRowVariationsLoading({});
      } finally {
        if (variationsRequestId.current === requestId) {
          setVariationsLoading(false);
        }
      }
    },
    []
  );

  const fetchProductRequests = useCallback(async (productIds: number[]) => {
    if (!productIds || productIds.length === 0) {
      setProductRequests({});
      return;
    }

    setRequestsLoading(true);
    setRequestsError(null);

    try {
      const params = new URLSearchParams();
      productIds.forEach((id) => params.append('productId', id.toString()));
      const response = await fetch(`/api/salla/requests?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل طلبات الكميات');
      }

      const map: Record<number, QuantityRequestRecord[]> = {};
      productIds.forEach((id) => {
        map[id] = [];
      });

      if (Array.isArray(data.requests)) {
        data.requests.forEach((request: QuantityRequestRecord) => {
          if (!map[request.productId]) {
            map[request.productId] = [];
          }
          map[request.productId].push(request);
        });
      }

      Object.keys(map).forEach((key) => {
        const id = Number.parseInt(key, 10);
        map[id] = map[id].sort(
          (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
        );
      });

      setProductRequests(map);
    } catch (err) {
      setRequestsError(
        err instanceof Error ? err.message : 'تعذر تحميل طلبات الكميات لهذا المنتج'
      );
      setProductRequests({});
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchProducts(currentPage, searchSku, statusFilter);
    }
  }, [status, currentPage, searchSku, statusFilter, fetchProducts]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    if (products.length === 0) {
      setVariationsMap({});
      setProductVariationErrors({});
      setVariationsGlobalError(null);
      setVariationsLoading(false);
      return;
    }
    fetchVariations(products);
  }, [status, products, fetchVariations]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    if (products.length === 0) {
      setProductRequests({});
      return;
    }
    const ids = products.map((product) => product.id);
    fetchProductRequests(ids);
  }, [status, products, fetchProductRequests]);

  const handleRefresh = () => {
    fetchProducts(currentPage, searchSku, statusFilter);
  };

  const refreshVariationsForProduct = useCallback(
    async (productId: number) => {
      if (!productId) {
        return;
      }
      setRowVariationsLoading((prev) => ({ ...prev, [productId]: true }));
      try {
        const response = await fetch('/api/salla/products/variations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ productIds: [productId] }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحديث بيانات المتغير');
        }

        const variations = Array.isArray(data.variations?.[productId])
          ? data.variations[productId]
          : [];

        setVariationsMap((prev) => ({
          ...prev,
          [productId]: variations,
        }));

        setProductVariationErrors((prev) => {
          const next = { ...prev };
          const productError = Array.isArray(data.failed)
            ? data.failed.find((entry: { productId?: number }) => entry.productId === productId)
            : null;
          if (productError) {
            next[productId] =
              (productError as { message?: string }).message ||
              'تعذر تحميل متغيرات هذا المنتج من سلة';
          } else {
            delete next[productId];
          }
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر تحديث متغيرات هذا المنتج';
        setProductVariationErrors((prev) => ({
          ...prev,
          [productId]: message,
        }));
      } finally {
        setRowVariationsLoading((prev) => {
          const next = { ...prev };
          delete next[productId];
          return next;
        });
      }
    },
    []
  );

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = skuInput.trim();
    setCurrentPage(1);
    setSearchSku(trimmed);
  };

  const handlePageChange = (direction: 'prev' | 'next') => {
    setCurrentPage((prev) => {
      const totalPages = pagination?.totalPages ?? 1;
      if (direction === 'prev') {
        return Math.max(prev - 1, 1);
      }
      return Math.min(prev + 1, totalPages);
    });
  };

  const handleStatusChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setCurrentPage(1);
    setStatusFilter(value);
  };

  const handleCreateRequest = useCallback(
    async (product: SallaProductSummary, payload: NewRequestPayload): Promise<ActionResult> => {
      try {
        const response = await fetch('/api/salla/requests', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            productImageUrl: product.imageUrl,
            merchantId,
            requestedAmount: payload.requestedAmount,
            requestedRefundAmount: payload.requestedRefundAmount ?? undefined,
            requestedFrom: payload.requestedFrom,
            requestedFor: payload.requestedFor,
            notes: payload.notes,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر إنشاء طلب الكمية');
        }
        const created: QuantityRequestRecord = data.request;
        setProductRequests((prev) => {
          const updated = { ...prev };
          const list = updated[product.id] ? [...updated[product.id]] : [];
          list.push(created);
          list.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
          updated[product.id] = list;
          return updated;
        });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'تعذر إنشاء طلب الكمية',
        };
      }
    },
    [merchantId]
  );

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (status !== 'authenticated') {
    return null;
  }

  const totalPages = pagination?.totalPages ?? 1;
  const totalProducts = pagination?.total ?? products.length;
  const formattedLastUpdated = lastUpdated ? formatDate(lastUpdated) : 'بانتظار التحديث';
  const quickStats = [
    { label: 'النتائج المعروضة', value: formatNumber(totalProducts) },
    { label: 'الصفحة الحالية', value: `${formatNumber(currentPage)} / ${formatNumber(totalPages)}` },
    { label: 'حد الصفحة', value: `${formatNumber(PAGE_SIZE)} منتج` },
    { label: 'آخر تحديث', value: formattedLastUpdated },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50">
      <AppNavbar />
      <main className="max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8 space-y-10">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,3fr),minmax(0,2fr)]">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-900 to-indigo-700 p-8 text-white shadow-2xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_55%)]" />
            <div className="absolute -left-10 top-10 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
            <div className="relative z-10 flex flex-col gap-6">
              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.35em] text-white/70">
                <span className="rounded-full bg-white/15 px-3 py-1">سلة</span>
                <span className="rounded-full bg-white/15 px-3 py-1">الفريق التجاري</span>
              </div>
              <div>
                <h1 className="flex items-center gap-3 text-3xl font-semibold md:text-4xl">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
                    <PackageSearch className="h-6 w-6 text-white" />
                  </span>
                  لوحة منتجات سلة
                </h1>
                <p className="mt-4 text-base text-white/80">
                  اعرض كل منتجات سلة مع حالة التوفر والأسعار، ونسّق طلبات الكميات عبر فريق المستودع
                  والمتاجر مباشرة من لوحة واحدة حديثة.
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {quickStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl bg-white/10 px-4 py-3 text-white backdrop-blur"
                  >
                    <dt className="text-xs uppercase tracking-wide text-white/70">{stat.label}</dt>
                    <dd className="text-xl font-semibold">{stat.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleRefresh}
                  disabled={loading}
                  className="rounded-2xl bg-white px-6 py-5 text-slate-900 shadow-lg shadow-slate-900/20 hover:bg-white/90"
                >
                  <RefreshCcw className="h-4 w-4" />
                  تحديث البيانات
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => router.push('/returns')}
                  className="rounded-2xl border border-white/30 bg-white/10 px-6 py-5 text-white hover:bg-white/20"
                >
                  الانتقال إلى المرتجعات
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => router.push('/salla/requests')}
                  className="rounded-2xl border border-white/30 bg-white/10 px-6 py-5 text-white hover:bg-white/20"
                >
                  لوحة طلبات الكميات
                </Button>
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-indigo-100 bg-white/80 p-6 shadow-lg shadow-indigo-100/60 backdrop-blur">
            <h2 className="text-xl font-semibold text-slate-900">لماذا هذه الصفحة؟</h2>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              تزودك هذه الشاشة بنظرة فورية على المنتجات القادمة من واجهة سلة الرسمية، مع إمكانية
              البحث الفوري عن أي SKU، ومعالجة طلبات الكميات من نفس الجدول دون الحاجة للتنقل بين
              أنظمة متعددة.
            </p>
            <div className="mt-6 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/70 p-4 text-indigo-900">
              <p className="text-sm font-medium">نصيحة سريعة</p>
              <p className="text-sm text-indigo-800 mt-1">
                استخدم البحث لتحديد المنتج المطلوب ثم حرّك الطلب إلى منسق المستودع لحظياً عن طريق
                نموذج “طلب كمية”.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white/95 shadow-xl shadow-slate-200/60">
          <Card className="border-none shadow-none">
            <CardHeader className="border-b border-slate-100 pb-6">
              <CardTitle className="text-2xl flex flex-col gap-2 text-slate-900 sm:flex-row sm:items-center sm:justify-between">
                <span>فلترة المنتجات</span>
                <span className="text-base font-normal text-slate-500">
                  اعرض آخر التحديثات مباشرة من سلة
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <form
                onSubmit={handleSearchSubmit}
                className="flex flex-col gap-4 lg:flex-row lg:items-end"
              >
                <div className="flex-1">
                  <label htmlFor="sku-input" className="block text-sm font-medium text-gray-700 mb-2">
                    البحث برمز SKU
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="sku-input"
                      placeholder="أدخل SKU مثال: DRESS-XL-RED"
                      value={skuInput}
                      onChange={(event) => setSkuInput(event.target.value)}
                      className="h-12 rounded-2xl border-slate-200 bg-slate-50/80 text-base"
                    />
                    <Button
                      type="submit"
                      className="h-12 rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                    >
                      <Search className="h-4 w-4 ml-2" />
                      بحث
                    </Button>
                  </div>
                </div>
                <div className="w-full sm:w-56">
                  <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 mb-2">
                    حالة المنتج
                  </label>
                  <Select
                    id="status-filter"
                    value={statusFilter}
                    onChange={handleStatusChange}
                    className="h-12 rounded-2xl border-slate-200 bg-slate-50/80 text-base"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center shadow-inner">
                    <p className="text-sm text-slate-500">إجمالي النتائج</p>
                    <p className="text-2xl font-semibold text-slate-900">
                      {formatNumber(totalProducts)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center shadow-inner">
                    <p className="text-sm text-slate-500">الصفحة</p>
                    <p className="text-2xl font-semibold text-slate-900">
                      {formatNumber(currentPage)}
                      <span className="text-sm text-slate-500"> / {formatNumber(totalPages)}</span>
                    </p>
                  </div>
                </div>
              </form>
              {error && (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white/95 p-2 shadow-xl shadow-slate-200/60">
          <Card className="border-none shadow-none">
            <CardHeader className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-2xl text-slate-900">جدول المنتجات</CardTitle>
                <CardDescription className="text-base text-slate-500">
                  يظهر {PAGE_SIZE} منتجاً في كل صفحة مع إمكانية إرسال طلب كمية لكل عنصر.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  className="rounded-2xl border-slate-200"
                  onClick={() => handlePageChange('prev')}
                  disabled={loading || currentPage === 1}
                >
                  الصفحة السابقة
                </Button>
                <Button
                  className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                  onClick={() => handlePageChange('next')}
                  disabled={loading || currentPage >= totalPages}
                >
                  الصفحة التالية
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto rounded-3xl">
                <Table>
                  <TableHeader className="hidden lg:table-header-group">
                    <TableRow className="bg-slate-50/80 text-slate-600">
                      <TableHead className="w-72 text-slate-600">المنتج</TableHead>
                      <TableHead className="text-slate-600">SKU</TableHead>
                      <TableHead className="text-slate-600">السعر</TableHead>
                      <TableHead className="text-slate-600">المتوفر</TableHead>
                      <TableHead className="text-slate-600">الحالة</TableHead>
                      <TableHead className="w-[320px] text-slate-600">طلب كمية</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center">
                          <div className="flex flex-col items-center gap-3 text-slate-500">
                            <Loader2 className="h-6 w-6 animate-spin" />
                            <p>جاري تحميل المنتجات من سلة...</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading && products.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-slate-500">
                          لا توجد منتجات مطابقة لبحثك حالياً.
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading &&
                      products.map((product) => (
                        <ProductRow
                          key={product.id}
                          product={product}
                          requests={productRequests[product.id] ?? []}
                          requestsLoading={requestsLoading}
                          requestsError={requestsError}
                          onCreateRequest={handleCreateRequest}
                          variations={variationsMap[product.id] ?? []}
                          variationsLoading={variationsLoading}
                          rowVariationsLoading={!!rowVariationsLoading[product.id]}
                          variationError={productVariationErrors[product.id]}
                          globalVariationError={variationsGlobalError}
                          onRefreshVariations={() => refreshVariationsForProduct(product.id)}
                        />
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}

type ProductRowProps = {
  product: SallaProductSummary;
  requests: QuantityRequestRecord[];
  requestsLoading: boolean;
  requestsError?: string | null;
  onCreateRequest: (
    product: SallaProductSummary,
    payload: NewRequestPayload
  ) => Promise<ActionResult>;
  variations: SallaProductVariation[];
  variationsLoading: boolean;
  rowVariationsLoading: boolean;
  variationError?: string | null;
  globalVariationError?: string | null;
  onRefreshVariations: () => void;
};

function ProductRow({
  product,
  requests,
  requestsLoading,
  requestsError,
  onCreateRequest,
  variations,
  variationsLoading,
  rowVariationsLoading,
  variationError,
  globalVariationError,
  onRefreshVariations,
}: ProductRowProps) {
  const [requestForm, setRequestForm] = useState({
    requestedAmount: '',
    requestedRefundAmount: '',
    requestedFor: '',
    notes: '',
  });
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [variationAdjustments, setVariationAdjustments] = useState<
    Record<string, { quantity: string; mode: 'increment' | 'decrement' }>
  >({});
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const variationList = variations ?? [];
  const variationMessage = variationError || globalVariationError;
  const rowLoading = variationsLoading || rowVariationsLoading;
  const hasPendingAdjustments = Object.values(variationAdjustments).some(
    (entry) => Number.parseInt(entry.quantity, 10) > 0
  );
  const variationAdjustmentEntries = variationList.map((variation) => {
    const key = variation.id?.toString() ?? `${variation.name}-${variation.sku ?? ''}`;
    return {
      key,
      variation,
      entry: variationAdjustments[key] ?? { quantity: '', mode: 'increment' as const },
    };
  });

  useEffect(() => {
    setVariationAdjustments({});
    setUpdateFeedback(null);
  }, [product.id]);

  const handleRequestSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedFrom = 'غير محدد';
    const parsedRequestedAmount = Number.parseInt(requestForm.requestedAmount, 10);
    const hasRequestedAmount = Number.isFinite(parsedRequestedAmount) && parsedRequestedAmount > 0;
    const requestedRefundAmount =
      requestForm.requestedRefundAmount.trim().length > 0
        ? Number.parseInt(requestForm.requestedRefundAmount, 10)
        : undefined;
    const hasRequestedRefund =
      requestedRefundAmount !== undefined &&
      Number.isFinite(requestedRefundAmount) &&
      requestedRefundAmount > 0;

    if (!hasRequestedAmount && !hasRequestedRefund) {
      setRequestError('يجب إدخال كمية شراء أو كمية مرتجع واحدة على الأقل (رقم أكبر من صفر).');
      return;
    }

    if (
      requestedRefundAmount !== undefined &&
      (!Number.isFinite(requestedRefundAmount) || requestedRefundAmount <= 0)
    ) {
      setRequestError('كمية المرتجع يجب أن تكون رقماً أكبر من صفر.');
      return;
    }

    const normalizedRequestedAmount = hasRequestedAmount ? parsedRequestedAmount : 0;
    const normalizedRefundAmount = hasRequestedRefund ? requestedRefundAmount : undefined;

    setRequestSubmitting(true);
    const result = await onCreateRequest(product, {
      requestedFrom,
      requestedAmount: normalizedRequestedAmount,
      requestedRefundAmount: normalizedRefundAmount,
      requestedFor: requestForm.requestedFor || undefined,
      notes: requestForm.notes.trim() || undefined,
    });
    setRequestSubmitting(false);

    if (!result.success) {
      setRequestError(result.error);
      return;
    }

    setRequestForm({
      requestedAmount: '',
      requestedRefundAmount: '',
      requestedFor: '',
      notes: '',
    });
    setRequestError(null);
  };

  const handleAdjustmentQuantityChange = (variationKey: string, value: string) => {
    setVariationAdjustments((prev) => ({
      ...prev,
      [variationKey]: {
        quantity: value,
        mode: prev[variationKey]?.mode ?? 'increment',
      },
    }));
  };

  const handleAdjustmentModeChange = (variationKey: string, mode: 'increment' | 'decrement') => {
    setVariationAdjustments((prev) => ({
      ...prev,
      [variationKey]: {
        quantity: prev[variationKey]?.quantity ?? '',
        mode,
      },
    }));
  };

  const handleSubmitAdjustments = async () => {
    const payload = variationAdjustmentEntries
      .map(({ variation, entry }) => {
        const quantity = Number.parseInt(entry.quantity, 10);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return null;
        }
        return {
          identifer_type: 'variant_id',
          identifer: variation.id?.toString() ?? '',
          quantity,
          mode: entry.mode,
        };
      })
      .filter(
        (
          item
        ): item is {
          identifer_type: string;
          identifer: string;
          quantity: number;
          mode: 'increment' | 'decrement';
        } => {
        return Boolean(item?.identifer);
      });

    if (payload.length === 0) {
      setUpdateFeedback({ type: 'error', message: 'يرجى إدخال الكمية المطلوبة لكل متغير قبل الإرسال.' });
      return;
    }

    setUpdateLoading(true);
    setUpdateFeedback(null);

    try {
      const response = await fetch('/api/salla/products/quantities/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ products: payload }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحديث كميات المتغيرات');
      }

      setUpdateFeedback({ type: 'success', message: 'تم تحديث الكميات بنجاح.' });
      setVariationAdjustments({});
      onRefreshVariations();
    } catch (error) {
      setUpdateFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'حدث خطأ أثناء تحديث الكميات.',
      });
    } finally {
      setUpdateLoading(false);
    }
  };

  const renderQuantityRequestSection = () => (
    <div className="space-y-3 text-sm">
      <form onSubmit={handleRequestSubmit} className="space-y-2 rounded-xl border border-slate-100 bg-white/80 p-3 shadow-sm">
        <p className="text-xs text-gray-500">أضف طلب كمية جديد</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="الكمية"
            type="number"
            min={1}
            value={requestForm.requestedAmount}
            onChange={(event) =>
              setRequestForm((prev) => ({ ...prev, requestedAmount: event.target.value }))
            }
          />
          <Input
            placeholder="كمية المرتجع (اختياري)"
            type="number"
            min={1}
            value={requestForm.requestedRefundAmount}
            onChange={(event) =>
              setRequestForm((prev) => ({
                ...prev,
                requestedRefundAmount: event.target.value,
              }))
            }
          />
        </div>
        <div>
          <Input
            type="date"
            value={requestForm.requestedFor}
            onChange={(event) =>
              setRequestForm((prev) => ({ ...prev, requestedFor: event.target.value }))
            }
          />
        </div>
        <Input
          placeholder="ملاحظات (اختياري)"
          value={requestForm.notes}
          onChange={(event) => setRequestForm((prev) => ({ ...prev, notes: event.target.value }))}
        />
        <Button
          type="submit"
          className="flex w-full items-center justify-center gap-2 text-sm"
          disabled={requestSubmitting}
        >
          {requestSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          <Users className="h-4 w-4" />
          <span>طلب كمية</span>
        </Button>
        {requestError && <p className="text-xs text-red-600">{requestError}</p>}
      </form>

      {requestsError && <p className="text-xs text-red-600">تعذر تحميل الطلبات: {requestsError}</p>}

      {requestsLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          جاري تحميل الطلبات...
        </div>
      ) : requests.length === 0 ? (
        <p className="text-xs text-slate-500">لا توجد طلبات مسجلة لهذا المنتج بعد.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">
            تحديث حالة الطلبات يتم من خلال{' '}
            <Link href="/salla/requests" className="text-indigo-600 hover:underline">
              صفحة طلبات الكميات
            </Link>
            .
          </p>
          {requests.map((req) => (
            <QuantityRequestCard key={req.id} request={req} />
          ))}
        </div>
      )}
    </div>
  );

  const renderVariationSection = () => (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">
          المتغيرات ({formatNumber(variationList.length)})
        </p>
        {rowLoading && (
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            جاري تحميل المتغيرات...
          </span>
        )}
      </div>
      {variationMessage ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {variationMessage}
        </div>
      ) : variationList.length === 0 && !rowLoading ? (
        <p className="mt-3 text-sm text-slate-500">لا توجد متغيرات مسجلة لهذا المنتج.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-3">
            {variationAdjustmentEntries.map(({ variation, entry, key }) => {
              const quantity =
                typeof variation.availableQuantity === 'number'
                  ? variation.availableQuantity
                  : variation.availableQuantity != null
                    ? Number(variation.availableQuantity)
                    : null;
              const isEmpty = quantity == null || quantity <= 0;
              const quantityLabel = formatNumber(quantity);
              const subLabelClass = isEmpty ? 'text-white/80' : 'text-slate-500';
              const modeButtons: Array<'increment' | 'decrement'> = ['increment', 'decrement'];
              return (
                <div
                  key={key}
                  className={`w-28 overflow-hidden rounded-lg border shadow-sm ${
                    isEmpty
                      ? 'border-red-300 bg-gradient-to-b from-red-500/90 to-red-600/90 text-white'
                      : 'border-slate-200 bg-white/90'
                  }`}
                >
                  <div
                    className={`px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wide ${
                      isEmpty ? 'bg-red-600/80 text-white' : 'bg-white/70 text-slate-700'
                    }`}
                  >
                    {variation.name || 'متغير'}
                  </div>
                  <div className="space-y-1.5 px-2 py-2 text-center">
                    <div>
                      <p className={`text-[10px] ${subLabelClass}`}>الكمية الحالية</p>
                      <p className={`text-lg font-bold ${isEmpty ? 'text-white' : 'text-slate-900'}`}>
                        {quantityLabel}
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={entry.quantity}
                      onChange={(event) => handleAdjustmentQuantityChange(key, event.target.value)}
                      className="w-full rounded-md border border-slate-200 bg-white/80 px-2 py-1 text-[11px] text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                      placeholder="0"
                    />
                    <div className="flex gap-1">
                      {modeButtons.map((modeOption) => {
                        const isActive = entry.mode === modeOption;
                        return (
                          <button
                            key={modeOption}
                            type="button"
                            onClick={() => handleAdjustmentModeChange(key, modeOption)}
                            className={`flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition ${
                              isActive
                                ? modeOption === 'increment'
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : 'border-amber-500 bg-amber-500 text-white'
                                : 'border-white/50 bg-white/40 text-slate-700 hover:bg-white/60'
                            }`}
                          >
                            {modeOption === 'increment' ? 'زيادة' : 'تخفيض'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
              onClick={handleSubmitAdjustments}
              disabled={!hasPendingAdjustments || updateLoading}
            >
              {updateLoading && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              تحديث كميات المتغيرات
            </Button>
            {updateFeedback && (
              <p className={`text-sm ${updateFeedback.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                {updateFeedback.message}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <Fragment>
      <TableRow className="hidden lg:table-row">
        <TableCell>
          <div className="flex items-center gap-3">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                className="h-12 w-12 rounded-md border object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-gray-100 text-sm text-gray-500">
                لا صورة
              </div>
            )}
            <div>
              <p className="text-sm font-medium">{product.name}</p>
              <p className="mt-0.5 text-xs text-gray-500">#{product.id}</p>
              {product.lastUpdatedAt && (
                <p className="text-xs text-gray-400">آخر تحديث: {formatDate(product.lastUpdatedAt)}</p>
              )}
            </div>
          </div>
        </TableCell>
        <TableCell>
          <p className="font-medium">{product.sku || '—'}</p>
        </TableCell>
        <TableCell>
          <p>{formatCurrency(product.priceAmount ?? null, product.currency)}</p>
        </TableCell>
        <TableCell>
          <p className="font-semibold">{formatNumber(product.availableQuantity ?? null)}</p>
        </TableCell>
        <TableCell>
          <span className="inline-flex items-center rounded-full border bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {product.status || 'غير محدد'}
          </span>
        </TableCell>
        <TableCell>{renderQuantityRequestSection()}</TableCell>
      </TableRow>
      <TableRow className="hidden bg-slate-50/60 lg:table-row">
        <TableCell colSpan={6}>{renderVariationSection()}</TableCell>
      </TableRow>
      <TableRow className="lg:hidden">
        <TableCell colSpan={6} className="border-0 p-0 align-top">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="h-14 w-14 rounded-xl border object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border bg-gray-100 text-sm text-gray-500">
                  لا صورة
                </div>
              )}
              <div>
                <p className="text-base font-semibold text-slate-900">{product.name}</p>
                <p className="text-xs text-gray-500">#{product.id}</p>
                {product.lastUpdatedAt && (
                  <p className="text-xs text-gray-400">آخر تحديث: {formatDate(product.lastUpdatedAt)}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs text-slate-500">SKU</p>
                <p className="font-medium text-slate-900">{product.sku || '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs text-slate-500">السعر</p>
                <p className="font-medium text-slate-900">
                  {formatCurrency(product.priceAmount ?? null, product.currency)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs text-slate-500">المتوفر</p>
                <p className="font-semibold text-slate-900">
                  {formatNumber(product.availableQuantity ?? null)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs text-slate-500">الحالة</p>
                <p className="font-medium text-slate-900">{product.status || 'غير محدد'}</p>
              </div>
            </div>
            {renderQuantityRequestSection()}
            {renderVariationSection()}
          </div>
        </TableCell>
      </TableRow>
    </Fragment>
  );
}

type QuantityRequestCardProps = {
  request: QuantityRequestRecord;
};

function QuantityRequestCard({ request }: QuantityRequestCardProps) {
  const statusLabel = request.status === 'completed' ? 'تم التنفيذ' : 'بانتظار التوفير';
  const statusClasses =
    request.status === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-amber-200 bg-amber-50 text-amber-700';

  return (
    <div className="rounded-xl border border-slate-100 bg-white/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            طلب {formatNumber(request.requestedAmount)}
          </p>
          <p className="text-xs text-slate-500">أضيف بواسطة {request.requestedBy}</p>
        </div>
        <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${statusClasses}`}>
          {statusLabel}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        <p>تاريخ الطلب: {formatDate(request.requestedAt)}</p>
        {request.requestedFor && <p>موعد التوريد المطلوب: {formatDate(request.requestedFor)}</p>}
        {request.notes && <p className="text-slate-500">ملاحظات: {request.notes}</p>}
        {request.requestedRefundAmount && request.requestedRefundAmount > 0 && (
          <p className="text-slate-600">
            كمية المرتجع المطلوبة: {formatNumber(request.requestedRefundAmount)}
          </p>
        )}
        {request.status === 'completed' && (
          <p className="text-emerald-700">
            اكتمل بواسطة {request.providedBy} بتوفير {formatNumber(request.providedAmount ?? null)} في{' '}
            {formatDate(request.fulfilledAt)}
          </p>
        )}
        {request.status === 'pending' && (
          <p className="text-[11px] text-slate-500">
            لتحديث حالة الطلب، انتقل إلى{' '}
            <Link href="/salla/requests" className="text-indigo-600 hover:underline">
              صفحة طلبات الكميات
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
  
