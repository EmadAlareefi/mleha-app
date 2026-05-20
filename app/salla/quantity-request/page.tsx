'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, PackageSearch, RefreshCcw, Search, Send } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SallaProductSummary, SallaProductVariation } from '@/app/lib/salla-api';

const PAGE_SIZE = 50;

type ProductOptionSnapshot = {
  id: string | number | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  availableQuantity: number | null;
};

type ActionResult = { success: true } | { success: false; error: string };

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCurrency(value: number | null | undefined, currency?: string) {
  if (value == null || Number.isNaN(value)) {
    return '-';
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

function buildProductOptionSnapshots(variations: SallaProductVariation[]): ProductOptionSnapshot[] {
  return variations
    .map((variation) => {
      const name = variation.name?.trim();
      if (!name) {
        return null;
      }

      const quantity =
        typeof variation.availableQuantity === 'number' && Number.isFinite(variation.availableQuantity)
          ? variation.availableQuantity
          : null;

      const option: ProductOptionSnapshot = {
        id: variation.id ?? null,
        name,
        sku: variation.sku?.trim() || null,
        barcode: variation.barcode?.trim() || null,
        availableQuantity: quantity,
      };

      return option;
    })
    .filter((option): option is ProductOptionSnapshot => option !== null);
}

export default function SallaQuantityRequestPage() {
  const router = useRouter();
  const { status } = useSession();
  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skuInput, setSkuInput] = useState('');
  const [searchSku, setSearchSku] = useState('');
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [variationsMap, setVariationsMap] = useState<Record<number, SallaProductVariation[]>>({});
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variationErrors, setVariationErrors] = useState<Record<number, string>>({});
  const [globalVariationError, setGlobalVariationError] = useState<string | null>(null);
  const variationsRequestId = useRef(0);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchProducts = useCallback(async (sku: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: '1',
        perPage: PAGE_SIZE.toString(),
      });

      if (sku) {
        params.set('sku', sku);
      }

      const response = await fetch(`/api/salla/products?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل منتجات سلة');
      }

      setProducts(Array.isArray(data.products) ? data.products : []);
      setMerchantId(typeof data.merchantId === 'string' ? data.merchantId : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل المنتجات');
      setProducts([]);
      setMerchantId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVariations = useCallback(async (items: SallaProductSummary[]) => {
    if (items.length === 0) {
      setVariationsMap({});
      setVariationErrors({});
      setGlobalVariationError(null);
      setVariationsLoading(false);
      return;
    }

    const requestId = Date.now();
    variationsRequestId.current = requestId;
    setVariationsLoading(true);
    setVariationErrors({});
    setGlobalVariationError(null);

    try {
      const response = await fetch('/api/salla/products/variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds: items.map((item) => item.id) }),
      });
      const data = await response.json();

      if (variationsRequestId.current !== requestId) {
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل خيارات المنتجات');
      }

      const normalized: Record<number, SallaProductVariation[]> = {};
      Object.entries(data.variations ?? {}).forEach(([key, value]) => {
        const productId = Number.parseInt(key, 10);
        if (Number.isFinite(productId)) {
          normalized[productId] = Array.isArray(value) ? value : [];
        }
      });
      items.forEach((item) => {
        normalized[item.id] = normalized[item.id] ?? [];
      });

      const perProductErrors: Record<number, string> = {};
      if (Array.isArray(data.failed)) {
        data.failed.forEach((entry: { productId?: number; message?: string }) => {
          if (typeof entry?.productId === 'number') {
            perProductErrors[entry.productId] = entry.message || 'تعذر تحميل خيارات هذا المنتج';
          }
        });
      }

      setVariationsMap(normalized);
      setVariationErrors(perProductErrors);
    } catch (err) {
      if (variationsRequestId.current !== requestId) {
        return;
      }
      setVariationsMap({});
      setVariationErrors({});
      setGlobalVariationError(err instanceof Error ? err.message : 'تعذر تحميل خيارات المنتجات');
    } finally {
      if (variationsRequestId.current === requestId) {
        setVariationsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchProducts(searchSku);
    }
  }, [status, searchSku, fetchProducts]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchVariations(products);
    }
  }, [status, products, fetchVariations]);

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchSku(skuInput.trim());
  };

  const handleCreateRequest = async (
    product: SallaProductSummary,
    payload: {
      requestedAmount: number;
      requestedRefundAmount?: number;
      requestedFor?: string;
      notes?: string;
      productOptions: ProductOptionSnapshot[];
    }
  ): Promise<ActionResult> => {
    try {
      const response = await fetch('/api/salla/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          productImageUrl: product.imageUrl,
          merchantId,
          requestedAmount: payload.requestedAmount,
          requestedRefundAmount: payload.requestedRefundAmount,
          requestedFrom: 'طلب الكميات',
          requestedFor: payload.requestedFor,
          notes: payload.notes,
          productOptions: payload.productOptions,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر إنشاء طلب الكمية');
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'تعذر إنشاء طلب الكمية',
      };
    }
  };

  if (status === 'loading') {
    return (
      <AppPageShell title="طلب الكميات" subtitle="جاري تحميل الجلسة">
        <LoadingState label="جاري تحميل الجلسة..." />
      </AppPageShell>
    );
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <AppPageShell
      title="طلب الكميات"
      subtitle="أنشئ طلب كمية لمنتجات سلة مع إرفاق خيارات المنتج الحالية داخل الطلب"
    >
      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <PackageSearch className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-foreground">منتجات سلة</p>
                  <p className="text-sm text-muted-foreground">ابحث عن المنتج ثم أرسل طلب الكمية من نفس السطر.</p>
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => fetchProducts(searchSku)} disabled={loading}>
                <RefreshCcw className="h-4 w-4" />
                تحديث
              </Button>
            </div>
            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={skuInput}
                onChange={(event) => setSkuInput(event.target.value)}
                placeholder="ابحث باسم المنتج أو SKU"
                className="h-11"
              />
              <Button type="submit" className="h-11">
                <Search className="h-4 w-4" />
                بحث
              </Button>
            </form>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>إرسال طلبات الكميات</CardTitle>
            <CardDescription>
              الخيارات المعروضة هنا سيتم حفظها مع الطلب حتى تبقى تفاصيل المنتج واضحة عند المتابعة.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-80">المنتج</TableHead>
                    <TableHead>السعر</TableHead>
                    <TableHead>المتوفر</TableHead>
                    <TableHead className="w-[340px]">خيارات المنتج</TableHead>
                    <TableHead className="w-[320px]">طلب الكمية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center">
                        <LoadingState label="جاري تحميل المنتجات..." />
                      </TableCell>
                    </TableRow>
                  ) : products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10">
                        <EmptyState title="لا توجد منتجات مطابقة حالياً" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => {
                      const variations = variationsMap[product.id] ?? [];
                      const options = buildProductOptionSnapshots(variations);
                      const optionsError = variationErrors[product.id] || globalVariationError;

                      return (
                        <TableRow key={product.id} className="align-top">
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
                                <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                                  لا صورة
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
                                <p className="text-xs text-muted-foreground">SKU: {product.sku || '-'}</p>
                                <p className="text-xs text-muted-foreground">#{product.id}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{formatCurrency(product.priceAmount ?? null, product.currency)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{formatNumber(product.availableQuantity ?? null)}</Badge>
                          </TableCell>
                          <TableCell>
                            <ProductOptionsPreview
                              options={options}
                              loading={variationsLoading}
                              error={optionsError}
                            />
                          </TableCell>
                          <TableCell>
                            <QuantityRequestForm
                              product={product}
                              productOptions={options}
                              onSubmit={(payload) => handleCreateRequest(product, payload)}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}

function ProductOptionsPreview({
  options,
  loading,
  error,
}: {
  options: ProductOptionSnapshot[];
  loading: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        جاري تحميل الخيارات...
      </p>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }

  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">لا توجد خيارات مسجلة.</p>;
  }

  return (
    <div className="max-h-36 space-y-1 overflow-y-auto">
      {options.map((option) => (
        <div
          key={`${option.id ?? option.name}-${option.sku ?? ''}`}
          className="rounded-md border bg-muted/30 px-2 py-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-foreground">{option.name}</p>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatNumber(option.availableQuantity)}
            </span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            {option.sku ? `SKU: ${option.sku}` : 'SKU غير محدد'}
            {option.barcode ? ` · باركود: ${option.barcode}` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}

function QuantityRequestForm({
  productOptions,
  onSubmit,
}: {
  product: SallaProductSummary;
  productOptions: ProductOptionSnapshot[];
  onSubmit: (payload: {
    requestedAmount: number;
    requestedRefundAmount?: number;
    requestedFor?: string;
    notes?: string;
    productOptions: ProductOptionSnapshot[];
  }) => Promise<ActionResult>;
}) {
  const [requestedAmount, setRequestedAmount] = useState('');
  const [requestedRefundAmount, setRequestedRefundAmount] = useState('');
  const [requestedFor, setRequestedFor] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number.parseInt(requestedAmount, 10);
    const refundAmount =
      requestedRefundAmount.trim().length > 0 ? Number.parseInt(requestedRefundAmount, 10) : undefined;
    const hasAmount = Number.isFinite(amount) && amount > 0;
    const hasRefund = refundAmount !== undefined && Number.isFinite(refundAmount) && refundAmount > 0;

    if (!hasAmount && !hasRefund) {
      setFeedback({ type: 'error', message: 'أدخل كمية شراء أو كمية مرتجع واحدة على الأقل.' });
      return;
    }

    if (refundAmount !== undefined && (!Number.isFinite(refundAmount) || refundAmount <= 0)) {
      setFeedback({ type: 'error', message: 'كمية المرتجع يجب أن تكون أكبر من صفر.' });
      return;
    }

    setLoading(true);
    const result = await onSubmit({
      requestedAmount: hasAmount ? amount : 0,
      requestedRefundAmount: hasRefund ? refundAmount : undefined,
      requestedFor: requestedFor || undefined,
      notes: notes.trim() || undefined,
      productOptions,
    });
    setLoading(false);

    if (!result.success) {
      setFeedback({ type: 'error', message: result.error });
      return;
    }

    setRequestedAmount('');
    setRequestedRefundAmount('');
    setRequestedFor('');
    setNotes('');
    setFeedback({ type: 'success', message: 'تم إنشاء طلب الكمية.' });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={1}
          placeholder="كمية شراء"
          value={requestedAmount}
          onChange={(event) => setRequestedAmount(event.target.value)}
        />
        <Input
          type="number"
          min={1}
          placeholder="كمية مرتجع"
          value={requestedRefundAmount}
          onChange={(event) => setRequestedRefundAmount(event.target.value)}
        />
      </div>
      <Input type="date" value={requestedFor} onChange={(event) => setRequestedFor(event.target.value)} />
      <Input placeholder="ملاحظات" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        إرسال الطلب
      </Button>
      {feedback && (
        <p className={`text-xs ${feedback.type === 'success' ? 'text-emerald-600' : 'text-destructive'}`}>
          {feedback.message}
        </p>
      )}
    </form>
  );
}
