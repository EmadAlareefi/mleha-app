'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, PackageSearch, RefreshCcw, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SallaPaginationMeta, SallaProductSummary } from '@/app/lib/salla-api';

const PAGE_SIZE = 100;

type QuantityRequest = {
  productId: number;
  requestedBy: string;
  requestedFrom: string;
  requestedAmount: number;
  notes?: string;
  status: 'pending' | 'completed';
  requestedAt: string;
  fulfilledAt?: string;
  providedBy?: string;
  providedAmount?: number;
};

type NewRequestPayload = {
  requestedFrom: string;
  requestedAmount: number;
  notes?: string;
};

type FulfillPayload = {
  providedBy: string;
  providedAmount: number;
};

function formatCurrency(value: number | null | undefined, currency?: string) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }

  try {
    return new Intl.NumberFormat('ar-SA', {
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
  return date.toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const [requests, setRequests] = useState<Record<number, QuantityRequest>>({});

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

  useEffect(() => {
    if (status === 'authenticated') {
      fetchProducts(currentPage, searchSku);
    }
  }, [status, currentPage, searchSku, fetchProducts]);

  const handleRefresh = () => {
    fetchProducts(currentPage, searchSku);
  };

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

  const handleCreateRequest = useCallback(
    (product: SallaProductSummary, payload: NewRequestPayload) => {
      setRequests((prev) => ({
        ...prev,
        [product.id]: {
          productId: product.id,
          requestedBy: currentUserName,
          requestedFrom: payload.requestedFrom,
          requestedAmount: payload.requestedAmount,
          notes: payload.notes,
          status: 'pending',
          requestedAt: new Date().toISOString(),
        },
      }));
    },
    [currentUserName]
  );

  const handleFulfillRequest = useCallback((productId: number, payload: FulfillPayload) => {
    setRequests((prev) => {
      const existing = prev[productId];
      if (!existing) {
        return prev;
      }
      return {
        ...prev,
        [productId]: {
          ...existing,
          status: 'completed',
          providedBy: payload.providedBy,
          providedAmount: payload.providedAmount,
          fulfilledAt: new Date().toISOString(),
        },
      };
    });
  }, []);

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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-2xl flex items-center gap-2">
                <PackageSearch className="h-6 w-6 text-blue-600" />
                قائمة منتجات سلة
              </CardTitle>
              <CardDescription>
                راجع آخر 100 منتج في كل صفحة، وابحث باستخدام SKU لعرض نتائج دقيقة، ثم نسق طلبات الكميات مع فريقك.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <RefreshCcw className="h-4 w-4" />
              <span>تحديث</span>
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <label htmlFor="sku-input" className="block text-sm font-medium text-gray-700 mb-1">
                  البحث برمز SKU
                </label>
                <div className="flex gap-2">
                  <Input
                    id="sku-input"
                    placeholder="أدخل SKU مثال: DRESS-XL-RED"
                    value={skuInput}
                    onChange={(event) => setSkuInput(event.target.value)}
                  />
                  <Button type="submit" className="flex items-center gap-2 whitespace-nowrap">
                    <Search className="h-4 w-4" />
                    <span>بحث</span>
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-lg border p-3 bg-white shadow-sm">
                  <p className="text-sm text-muted-foreground">إجمالي النتائج</p>
                  <p className="text-xl font-semibold">{totalProducts}</p>
                </div>
                <div className="rounded-lg border p-3 bg-white shadow-sm">
                  <p className="text-sm text-muted-foreground">صفحة</p>
                  <p className="text-xl font-semibold">
                    {currentPage} <span className="text-sm text-gray-500">/{totalPages}</span>
                  </p>
                </div>
              </div>
            </form>

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl">جدول المنتجات</CardTitle>
              <CardDescription>
                يعرض {PAGE_SIZE} منتجاً كحد أقصى في كل صفحة، ويمكنك التنقل بين الصفحات أو إرسال طلب كمية لكل منتج.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handlePageChange('prev')}
                disabled={loading || currentPage === 1}
              >
                الصفحة السابقة
              </Button>
              <Button
                onClick={() => handlePageChange('next')}
                disabled={loading || currentPage >= totalPages}
              >
                الصفحة التالية
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="w-72">المنتج</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>السعر</TableHead>
                    <TableHead>المتوفر</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="w-[320px]">طلب كمية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center">
                        <div className="flex flex-col items-center gap-3 text-gray-600">
                          <Loader2 className="h-6 w-6 animate-spin" />
                          <p>جاري تحميل المنتجات من سلة...</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading && products.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-gray-500">
                        لا توجد منتجات مطابقة لبحثك حالياً.
                      </TableCell>
                    </TableRow>
                  )}
                  {!loading &&
                    products.map((product) => (
                      <ProductRow
                        key={product.id}
                        product={product}
                        request={requests[product.id] ?? null}
                        onCreateRequest={handleCreateRequest}
                        onFulfillRequest={handleFulfillRequest}
                      />
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type ProductRowProps = {
  product: SallaProductSummary;
  request: QuantityRequest | null;
  onCreateRequest: (product: SallaProductSummary, payload: NewRequestPayload) => void;
  onFulfillRequest: (productId: number, payload: FulfillPayload) => void;
};

function ProductRow({ product, request, onCreateRequest, onFulfillRequest }: ProductRowProps) {
  const [requestForm, setRequestForm] = useState({ requestedFrom: '', requestedAmount: '', notes: '' });
  const [fulfillForm, setFulfillForm] = useState({ providedBy: '', providedAmount: '' });
  const [requestError, setRequestError] = useState<string | null>(null);
  const [fulfillError, setFulfillError] = useState<string | null>(null);

  const handleRequestSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requestedFrom = requestForm.requestedFrom.trim();
    const requestedAmount = Number.parseInt(requestForm.requestedAmount, 10);

    if (!requestedFrom || !Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      setRequestError('يرجى إدخال اسم الشخص المطلوب منه والكمية المطلوبة (رقم أكبر من صفر).');
      return;
    }

    onCreateRequest(product, {
      requestedFrom,
      requestedAmount,
      notes: requestForm.notes.trim() || undefined,
    });
    setRequestForm({ requestedFrom: '', requestedAmount: '', notes: '' });
    setRequestError(null);
  };

  const handleFulfillSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const providedBy = fulfillForm.providedBy.trim();
    const providedAmount = Number.parseInt(fulfillForm.providedAmount, 10);

    if (!providedBy || !Number.isFinite(providedAmount) || providedAmount <= 0) {
      setFulfillError('يرجى إدخال اسمك والكمية التي وفرتها (رقم أكبر من صفر).');
      return;
    }

    onFulfillRequest(product.id, {
      providedBy,
      providedAmount,
    });
    setFulfillForm({ providedBy: '', providedAmount: '' });
    setFulfillError(null);
  };

  const statusColor =
    request?.status === 'completed'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
      : 'bg-amber-100 text-amber-700 border-amber-200';

  return (
    <TableRow>
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
            <div className="h-12 w-12 rounded-md border bg-gray-100 flex items-center justify-center text-gray-500 text-sm">
              لا صورة
            </div>
          )}
          <div>
            <p className="font-medium text-sm">{product.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">#{product.id}</p>
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
        <p className="font-semibold">{product.availableQuantity ?? '—'}</p>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100">
          {product.status || 'غير محدد'}
        </span>
      </TableCell>
      <TableCell>
        <div className="space-y-3 text-sm">
          {!request && (
            <form onSubmit={handleRequestSubmit} className="space-y-2">
              <p className="text-xs text-gray-500">أرسل طلب كمية لزميلك:</p>
              <Input
                placeholder="اطلب من..."
                value={requestForm.requestedFrom}
                onChange={(event) => setRequestForm((prev) => ({ ...prev, requestedFrom: event.target.value }))}
              />
              <div className="flex gap-2">
                <Input
                  placeholder="الكمية"
                  type="number"
                  min={1}
                  value={requestForm.requestedAmount}
                  onChange={(event) => setRequestForm((prev) => ({ ...prev, requestedAmount: event.target.value }))}
                />
                <Input
                  placeholder="ملاحظات (اختياري)"
                  value={requestForm.notes}
                  onChange={(event) => setRequestForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </div>
              <Button type="submit" className="w-full text-sm flex items-center justify-center gap-2">
                <Users className="h-4 w-4" />
                <span>طلب كمية</span>
              </Button>
              {requestError && <p className="text-xs text-red-600">{requestError}</p>}
            </form>
          )}

          {request && (
            <div className="rounded-lg border px-3 py-2 bg-white shadow-sm space-y-2">
              <div className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-xs ${statusColor}`}>
                {request.status === 'completed' ? 'تم التنفيذ' : 'بانتظار التوفير'}
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                <p>
                  تم طلب <span className="font-semibold">{request.requestedAmount}</span> من{' '}
                  <span className="font-semibold">{request.requestedFrom}</span> بواسطة{' '}
                  <span className="font-semibold">{request.requestedBy}</span>
                </p>
                <p>تاريخ الطلب: {formatDate(request.requestedAt)}</p>
                {request.notes && <p className="text-gray-500">ملاحظة: {request.notes}</p>}
                {request.status === 'completed' && (
                  <p className="text-emerald-700">
                    وفّر {request.providedBy} كمية {request.providedAmount} في {formatDate(request.fulfilledAt)}
                  </p>
                )}
              </div>

              {request.status === 'pending' && (
                <form onSubmit={handleFulfillSubmit} className="space-y-2">
                  <Input
                    placeholder="اسم الموفّر"
                    value={fulfillForm.providedBy}
                    onChange={(event) => setFulfillForm((prev) => ({ ...prev, providedBy: event.target.value }))}
                  />
                  <Input
                    placeholder="الكمية الموفّرة"
                    type="number"
                    min={1}
                    value={fulfillForm.providedAmount}
                    onChange={(event) => setFulfillForm((prev) => ({ ...prev, providedAmount: event.target.value }))}
                  />
                  <Button type="submit" variant="outline" className="w-full text-sm">
                    تم توفير الكمية
                  </Button>
                  {fulfillError && <p className="text-xs text-red-600">{fulfillError}</p>}
                </form>
              )}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
