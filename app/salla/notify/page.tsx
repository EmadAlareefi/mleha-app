'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { BellRing, Loader2, PackageSearch, Search } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type {
  SallaPaginationMeta,
  SallaProductSummary,
  SallaProductVariation,
} from '@/app/lib/salla-api';

const PAGE_SIZE = 60;

type AvailabilityRequestRecord = {
  id: string;
  productId: number;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  variationId?: string | null;
  variationName?: string | null;
  requestedSize?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone: string;
  notes?: string | null;
  status: 'pending' | 'notified' | 'cancelled';
  requestedBy: string;
  requestedByUser?: string | null;
  createdAt: string;
};

type NewAvailabilityRequestPayload = {
  variationId?: string;
  variationName?: string;
  requestedSize?: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string;
  customerPhone: string;
  notes?: string;
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

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
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

export default function SallaNotifyPage() {
  const router = useRouter();
  const { status } = useSession();
  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [pagination, setPagination] = useState<SallaPaginationMeta | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchSku, setSearchSku] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variationsMap, setVariationsMap] = useState<Record<number, SallaProductVariation[]>>({});
  const [productVariationErrors, setProductVariationErrors] = useState<Record<number, string>>({});
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variationsGlobalError, setVariationsGlobalError] = useState<string | null>(null);
  const [rowVariationsLoading, setRowVariationsLoading] = useState<Record<number, boolean>>({});
  const [availabilityRequests, setAvailabilityRequests] = useState<
    Record<number, AvailabilityRequestRecord[]>
  >({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const variationsRequestId = useRef(0);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchProducts = useCallback(
    async (page: number, sku: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: page.toString(),
          perPage: PAGE_SIZE.toString(),
        });
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
        setMerchantId(typeof data.merchantId === 'string' ? data.merchantId : null);
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
          headers: { 'Content-Type': 'application/json' },
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

  const fetchAvailabilityRequests = useCallback(async (productIds: number[]) => {
    if (!productIds || productIds.length === 0) {
      setAvailabilityRequests({});
      return;
    }

    setAvailabilityLoading(true);
    setAvailabilityError(null);

    try {
      const params = new URLSearchParams();
      productIds.forEach((id) => params.append('productId', id.toString()));
      const response = await fetch(`/api/salla/availability-requests?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل طلبات الإشعار');
      }

      const map: Record<number, AvailabilityRequestRecord[]> = {};
      productIds.forEach((id) => {
        map[id] = [];
      });

      if (Array.isArray(data.requests)) {
        data.requests.forEach((request: AvailabilityRequestRecord) => {
          if (!map[request.productId]) {
            map[request.productId] = [];
          }
          map[request.productId].push(request);
        });
      }

      Object.keys(map).forEach((key) => {
        const id = Number.parseInt(key, 10);
        map[id] = map[id].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });

      setAvailabilityRequests(map);
    } catch (err) {
      setAvailabilityError(
        err instanceof Error ? err.message : 'تعذر تحميل طلبات الإشعار لهذا المنتج'
      );
      setAvailabilityRequests({});
    } finally {
      setAvailabilityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchProducts(currentPage, searchSku);
    }
  }, [status, currentPage, searchSku, fetchProducts]);

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
      setAvailabilityRequests({});
      return;
    }
    const ids = products.map((product) => product.id);
    fetchAvailabilityRequests(ids);
  }, [status, products, fetchAvailabilityRequests]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
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

  const handleCreateAvailabilityRequest = useCallback(
    async (
      product: SallaProductSummary,
      payload: NewAvailabilityRequestPayload
    ): Promise<ActionResult> => {
      try {
        const response = await fetch('/api/salla/availability-requests', {
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
            variationId: payload.variationId,
            variationName: payload.variationName,
            requestedSize: payload.requestedSize,
            customerFirstName: payload.customerFirstName,
            customerLastName: payload.customerLastName,
            customerEmail: payload.customerEmail,
            customerPhone: payload.customerPhone,
            notes: payload.notes,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر حفظ طلب الإشعار');
        }
        const created: AvailabilityRequestRecord = data.request;
        setAvailabilityRequests((prev) => {
          const updated = { ...prev };
          const list = updated[product.id] ? [created, ...updated[product.id]] : [created];
          updated[product.id] = list;
          return updated;
        });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'تعذر حفظ طلب الإشعار',
        };
      }
    },
    [merchantId]
  );

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
      } catch (err) {
        const message = err instanceof Error ? err.message : 'تعذر تحديث متغيرات هذا المنتج';
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

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (status !== 'authenticated') {
    return null;
  }

  const totalPages = pagination?.totalPages ?? 1;
  const totalProducts = pagination?.total ?? products.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50">
      <AppNavbar />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-slate-100 bg-white/95 shadow-xl shadow-slate-200/60">
          <Card className="border-none bg-transparent shadow-none">
            <CardHeader className="space-y-6">
              <div className="flex flex-col gap-4 text-slate-900 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.35em] text-indigo-500">
                    سلة — الفريق التجاري
                  </p>
                  <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100">
                      <BellRing className="h-6 w-6 text-indigo-600" />
                    </span>
                    ابلغني عند التوفر
                  </h1>
                  <p className="mt-4 text-base text-slate-600">
                    دوّن طلبات العملاء للتواصل معهم فور توفر المقاس المطلوب. هذه الصفحة مخصصة لموظفي
                    المتاجر لتسجيل بيانات “أبلغني”.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-6 py-4 text-center">
                  <p className="text-sm text-slate-500">عدد المنتجات المعروضة</p>
                  <p className="text-3xl font-semibold text-slate-900">{formatNumber(totalProducts)}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 border-t border-slate-100 pt-6">
              <form
                onSubmit={handleSearchSubmit}
                className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 md:flex-row md:items-end"
              >
                <div className="flex-1">
                  <label htmlFor="sku-search" className="mb-2 block text-sm font-medium text-slate-600">
                    ابحث برمز SKU
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="sku-search"
                      placeholder="مثل: DRESS-XL-RED"
                      value={skuInput}
                      onChange={(event) => setSkuInput(event.target.value)}
                      className="h-12 rounded-2xl border-slate-200 bg-white/80 text-base"
                    />
                    <Button
                      type="submit"
                      className="h-12 rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                    >
                      <Search className="mr-2 h-4 w-4" />
                      بحث
                    </Button>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-2xl border-slate-200"
                    disabled={loading || currentPage === 1}
                    onClick={() => handlePageChange('prev')}
                    type="button"
                  >
                    الصفحة السابقة
                  </Button>
                  <Button
                    className="flex-1 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-500"
                    disabled={loading || currentPage >= totalPages}
                    onClick={() => handlePageChange('next')}
                    type="button"
                  >
                    الصفحة التالية
                  </Button>
                </div>
              </form>
              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-100 bg-white/80 p-6 text-slate-600">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
              <p>جاري تحميل المنتجات من سلة...</p>
            </div>
          )}
          {!loading && products.length === 0 && (
            <Card className="border-slate-100 shadow-none">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-slate-600">
                <PackageSearch className="h-10 w-10 text-slate-400" />
                <p>لا توجد منتجات مطابقة لبحثك.</p>
              </CardContent>
            </Card>
          )}

          {products.map((product) => (
            <ProductNotifyCard
              key={product.id}
              product={product}
              variations={variationsMap[product.id] ?? []}
              variationError={productVariationErrors[product.id] || variationsGlobalError}
              rowLoading={!!rowVariationsLoading[product.id] || variationsLoading}
              onRefreshVariations={() => refreshVariationsForProduct(product.id)}
              requests={availabilityRequests[product.id] ?? []}
              availabilityLoading={availabilityLoading}
              availabilityError={availabilityError}
              onCreateRequest={handleCreateAvailabilityRequest}
            />
          ))}
        </section>
      </main>
    </div>
  );
}

type ProductNotifyCardProps = {
  product: SallaProductSummary;
  variations: SallaProductVariation[];
  variationError?: string | null;
  rowLoading: boolean;
  onRefreshVariations: () => void;
  requests: AvailabilityRequestRecord[];
  availabilityLoading: boolean;
  availabilityError?: string | null;
  onCreateRequest: (
    product: SallaProductSummary,
    payload: NewAvailabilityRequestPayload
  ) => Promise<ActionResult>;
};

function ProductNotifyCard({
  product,
  variations,
  variationError,
  rowLoading,
  onRefreshVariations,
  requests,
  availabilityLoading,
  availabilityError,
  onCreateRequest,
}: ProductNotifyCardProps) {
  const [form, setForm] = useState({
    variationKey: '',
    customSize: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      variationKey: '',
      customSize: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: '',
    });
    setFormError(null);
  }, [product.id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setFormError(null);

    const trimmedPhone = form.phone.trim();
    if (!trimmedPhone) {
      setFormError('رقم الجوال مطلوب.');
      return;
    }

    const selectedVariation =
      form.variationKey && variations.length > 0
        ? variations.find(
            (variation) => variation.id != null && String(variation.id) === form.variationKey
          )
        : undefined;

    const sizeInput = form.customSize.trim();
    if (!selectedVariation && sizeInput.length === 0) {
      setFormError('يرجى اختيار المقاس أو إدخاله يدوياً.');
      return;
    }

    setSubmitting(true);
    const result = await onCreateRequest(product, {
      variationId:
        selectedVariation && selectedVariation.id != null
          ? String(selectedVariation.id)
          : undefined,
      variationName: selectedVariation?.name,
      requestedSize: sizeInput || selectedVariation?.name,
      customerFirstName: form.firstName.trim() || undefined,
      customerLastName: form.lastName.trim() || undefined,
      customerEmail: form.email.trim() || undefined,
      customerPhone: trimmedPhone,
      notes: form.notes.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    setForm({
      variationKey: '',
      customSize: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: '',
    });
  };

  const selectLabel =
    variations.length > 0 ? 'اختر المقاس من المتغيرات (اختياري)' : 'لا يوجد متغيرات لهذا المنتج';

  return (
    <Card className="border border-slate-100 shadow-lg shadow-slate-200/40">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-4">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-20 w-20 rounded-2xl border object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border bg-gray-100 text-sm text-gray-500">
              لا صورة
            </div>
          )}
          <div>
            <CardTitle className="text-xl text-slate-900">{product.name}</CardTitle>
            <CardDescription className="text-sm">
              SKU: <span className="font-semibold text-slate-700">{product.sku || '—'}</span>
            </CardDescription>
            <p className="text-sm text-slate-600">
              السعر: {formatCurrency(product.priceAmount ?? null, product.currency)}
            </p>
            <p className="text-sm text-slate-500">رقم المنتج: #{product.id}</p>
          </div>
        </div>
        <div className="space-y-1 text-right text-sm text-slate-500">
          <p>المتوفر حالياً: {formatNumber(product.availableQuantity ?? null)}</p>
          {product.lastUpdatedAt && (
            <p>آخر تحديث: {formatDate(product.lastUpdatedAt)}</p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
          <p className="text-sm font-semibold text-slate-900">بيانات إشعار العميل</p>
          <p className="text-xs text-slate-600">أدخل المقاس وبيانات الاتصال لحجز طلب “أبلغني”.</p>
          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <div>
              <label className="text-xs text-slate-500">{selectLabel}</label>
              <Select
                disabled={variations.length === 0}
                value={form.variationKey}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, variationKey: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {variations.map((variation) => {
                  const rawQuantity =
                    typeof variation.availableQuantity === 'number'
                      ? variation.availableQuantity
                      : variation.availableQuantity != null
                        ? Number(variation.availableQuantity)
                        : null;
                  const quantitySuffix =
                    rawQuantity != null && Number.isFinite(rawQuantity)
                      ? ` - متوفر ${formatNumber(rawQuantity)}`
                      : '';
                  return (
                    <option key={String(variation.id)} value={String(variation.id)}>
                      {variation.name || 'متغير'}
                      {quantitySuffix}
                    </option>
                  );
                })}
              </Select>
            </div>
            <Input
              placeholder="المقاس المطلوب (في حال لم يكن متوفر في القائمة)"
              value={form.customSize}
              onChange={(event) => setForm((prev) => ({ ...prev, customSize: event.target.value }))}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="الاسم الأول (اختياري)"
                value={form.firstName}
                onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
              />
              <Input
                placeholder="اسم العائلة (اختياري)"
                value={form.lastName}
                onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="البريد الإلكتروني (اختياري)"
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              />
              <Input
                placeholder="رقم الجوال *"
                type="tel"
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                required
              />
            </div>
            <Input
              placeholder="ملاحظات إضافية (اختياري)"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
            <Button
              type="submit"
              className="flex w-full items-center justify-center gap-2 text-sm"
              disabled={submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <BellRing className="h-4 w-4" />
              <span>حفظ طلب الإشعار</span>
            </Button>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
          </form>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white/60 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">المقاسات والمتغيرات</p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-slate-200"
              onClick={onRefreshVariations}
              disabled={rowLoading}
            >
              {rowLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              تحديث
            </Button>
          </div>
          {variationError && (
            <p className="mt-2 text-xs text-red-600">{variationError}</p>
          )}
          {!variationError && variations.length === 0 && !rowLoading && (
            <p className="mt-2 text-sm text-slate-500">لا توجد متغيرات متاحة لهذا المنتج.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {variations.map((variation) => {
              const rawQuantity =
                typeof variation.availableQuantity === 'number'
                  ? variation.availableQuantity
                  : variation.availableQuantity != null
                    ? Number(variation.availableQuantity)
                    : null;
              const isLow = rawQuantity == null || rawQuantity <= 0;
              return (
                <div
                  key={String(variation.id)}
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    isLow
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <p className="font-semibold">{variation.name || 'متغير'}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    الكمية: {rawQuantity != null ? formatNumber(rawQuantity) : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white/70 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">طلبات “أبلغني” المسجلة</p>
            {availabilityLoading && (
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                جاري التحديث
              </span>
            )}
          </div>
          {availabilityError && (
            <p className="mt-2 text-xs text-red-600">تعذر تحميل الإشعارات: {availabilityError}</p>
          )}
          {!availabilityError && requests.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">لم يتم تسجيل أي إشعار لهذا المنتج بعد.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {requests.map((request) => (
                <AvailabilityRequestCard key={request.id} request={request} />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type AvailabilityRequestCardProps = {
  request: AvailabilityRequestRecord;
};

function AvailabilityRequestCard({ request }: AvailabilityRequestCardProps) {
  const statusLabelMap: Record<AvailabilityRequestRecord['status'], string> = {
    pending: 'بانتظار التوفر',
    notified: 'تم إشعار العميل',
    cancelled: 'ملغي',
  };
  const statusClassMap: Record<AvailabilityRequestRecord['status'], string> = {
    pending: 'border-amber-200 bg-amber-50 text-amber-700',
    notified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    cancelled: 'border-slate-200 bg-slate-50 text-slate-600',
  };

  const fullName = [request.customerFirstName, request.customerLastName]
    .filter((part) => part && part.trim().length > 0)
    .join(' ')
    .trim();
  const sizeLabel = request.requestedSize || request.variationName || request.productSku || 'غير محدد';

  return (
    <div className="rounded-2xl border border-slate-100 bg-white/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{fullName || 'عميل'}</p>
          <p className="text-xs text-slate-500">المقاس المطلوب: {sizeLabel}</p>
        </div>
        <span
          className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${statusClassMap[request.status]}`}
        >
          {statusLabelMap[request.status]}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        <p>
          رقم الجوال:{' '}
          <span className="font-semibold text-slate-900 ltr:font-mono rtl:font-mono">
            {request.customerPhone}
          </span>
        </p>
        {request.customerEmail && <p>البريد الإلكتروني: {request.customerEmail}</p>}
        {request.notes && <p className="text-slate-500">ملاحظات: {request.notes}</p>}
        <p>
          أضيف بواسطة {request.requestedBy} بتاريخ {formatDate(request.createdAt)}
        </p>
      </div>
    </div>
  );
}
