'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, PackageSearch, RefreshCcw, Search, Users } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

type ProductOptionSnapshot = {
  id: string | number | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  availableQuantity: number | null;
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
  productOptions?: ProductOptionSnapshot[] | null;
  requestedBy: string;
  requestedFor?: string | null;
  notes?: string | null;
  status: 'pending' | 'completed';
  requestedAt: string;
  fulfilledAt?: string | null;
  providedBy?: string | null;
  providedAmount?: number | null;
};

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
  const { status } = useSession();
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
  const variationsRequestId = useRef(0);

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
        const params = new URLSearchParams({
          page: page.toString(),
          perPage: PAGE_SIZE.toString(),
        });

        if (statusValue) {
          params.set('status', statusValue);
        }

        if (sku) {
          params.set('sku', sku);
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

  if (status === 'loading') {
    return (
      <AppPageShell title="لوحة منتجات سلة" subtitle="عرض منتجات سلة وطلبات الكميات">
        <LoadingState label="جاري تحميل الجلسة..." />
      </AppPageShell>
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
    <AppPageShell
      title="لوحة منتجات سلة"
      subtitle="اعرض منتجات سلة مع حالة التوفر والأسعار، ونسّق طلبات الكميات من لوحة واحدة"
    >
        <section className="space-y-6">
          <Card>
            <CardContent className="space-y-6 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                    <PackageSearch className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">منتجات سلة</p>
                    <p className="text-sm text-muted-foreground">آخر تحديث: {formattedLastUpdated}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleRefresh}
                  disabled={loading}
                >
                  <RefreshCcw className="h-4 w-4" />
                  تحديث البيانات
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push('/salla/requests')}
                >
                  لوحة طلبات الكميات
                </Button>
              </div>
              </div>
              <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {quickStats.map((stat) => (
                  <div key={stat.label} className="rounded-md border bg-muted/30 px-4 py-3">
                    <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                    <dd className="text-xl font-semibold text-foreground">{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
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
                  <NativeSelect
                    id="status-filter"
                    value={statusFilter}
                    onChange={handleStatusChange}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <NativeSelectOption key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
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
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
                          <LoadingState label="جاري تحميل المنتجات من سلة..." />
                        </TableCell>
                      </TableRow>
                    )}
                    {!loading && products.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-slate-500">
                          <EmptyState title="لا توجد منتجات مطابقة لبحثك حالياً" />
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
    </AppPageShell>
  );
}

type ProductRowProps = {
  product: SallaProductSummary;
  requests: QuantityRequestRecord[];
  requestsLoading: boolean;
  requestsError?: string | null;
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
  variations,
  variationsLoading,
  rowVariationsLoading,
  variationError,
  globalVariationError,
  onRefreshVariations,
}: ProductRowProps) {
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
    <div className="space-y-4 text-sm">
      <div className="space-y-2 rounded-xl border border-slate-100 bg-white/80 p-3 shadow-sm">
        <p className="text-xs text-slate-500">إنشاء طلب كمية انتقل إلى الصفحة المخصصة.</p>
        <Button asChild className="w-full text-sm">
          <Link href="/salla/quantity-request">
            <Users className="h-4 w-4" />
            <span>فتح طلب الكميات</span>
          </Link>
        </Button>
      </div>

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
        <Alert className="mt-3">
          <AlertDescription>{variationMessage}</AlertDescription>
        </Alert>
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
          <Badge variant="secondary">
            {product.status || 'غير محدد'}
          </Badge>
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

function ProductOptionLine({ option }: { option: ProductOptionSnapshot }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-800">{option.name}</p>
        <p className="truncate text-[11px] text-slate-500">
          {option.sku ? `SKU: ${option.sku}` : 'SKU غير محدد'}
          {option.barcode ? ` · باركود: ${option.barcode}` : ''}
        </p>
      </div>
      <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
        {formatNumber(option.availableQuantity)}
      </span>
    </div>
  );
}

function QuantityRequestCard({ request }: QuantityRequestCardProps) {
  const statusLabel = request.status === 'completed' ? 'تم التنفيذ' : 'بانتظار التوفير';
  const requestOptions = Array.isArray(request.productOptions) ? request.productOptions : [];

  return (
    <div className="rounded-xl border border-slate-100 bg-white/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            طلب {formatNumber(request.requestedAmount)}
          </p>
          <p className="text-xs text-slate-500">أضيف بواسطة {request.requestedBy}</p>
        </div>
        <Badge variant={request.status === 'completed' ? 'default' : 'secondary'}>
          {statusLabel}
        </Badge>
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
        {requestOptions.length > 0 && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-2">
            <p className="mb-1 text-[11px] font-semibold text-slate-600">خيارات المنتج وقت الطلب</p>
            <div className="space-y-1">
              {requestOptions.map((option) => (
                <ProductOptionLine
                  key={`${option.id ?? option.name}-${option.sku ?? ''}`}
                  option={option}
                />
              ))}
            </div>
          </div>
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

  
