'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarCheck,
  ExternalLink,
  Loader2,
  PackageSearch,
  RefreshCcw,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { SallaProductSummary, SallaProductVariation } from '@/app/lib/salla-api';
import type { PurchaseRequestRecord } from '@/app/lib/salla-purchase-requests';

type ProductSearchResult = {
  product: SallaProductSummary & { variations?: SallaProductVariation[] };
  stats: {
    requestedQuantity: number;
    onTheWayQuantity: number;
    activePurchaseRequests: number;
  };
  purchaseRequests: PurchaseRequestRecord[];
};

type ProductSearchResponse = {
  success: boolean;
  merchantId: string;
  query: string;
  products: ProductSearchResult[];
  variationErrors?: Array<{ productId: number; message: string }>;
  error?: string;
};

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCurrency(value: number | null | undefined, currency?: string | null) {
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

function formatDate(value?: string | Date | null) {
  if (!value) {
    return 'غير محدد';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(value?: string | Date | null) {
  if (!value) {
    return '—';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function variationKey(variation: SallaProductVariation) {
  return String(variation.id ?? variation.sku ?? variation.name);
}

function getVariantOptions(value: PurchaseRequestRecord['variantOptions']): string[] {
  return Array.isArray(value)
    ? value.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
    : [];
}

function statusLabel(status: string) {
  if (status === 'on_the_way') {
    return 'قيد الشراء';
  }
  if (status === 'purchased') {
    return 'تم الشراء';
  }
  return 'مطلوب شراؤه';
}

export default function SallaProductSearchPage() {
  const router = useRouter();
  const { status } = useSession();
  const [queryInput, setQueryInput] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const selectedResult = useMemo(
    () => results.find((entry) => entry.product.id === selectedProductId) ?? results[0] ?? null,
    [results, selectedProductId]
  );

  const search = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setError('أدخل اسم المنتج أو SKU للبحث.');
      return;
    }

    setLoading(true);
    setError(null);
    setLastQuery(trimmed);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const params = new URLSearchParams({ q: trimmed });
      const response = await fetch(`/api/salla/product-search?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = (await response.json()) as ProductSearchResponse;
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر البحث عن المنتجات');
      }
      const productResults = Array.isArray(data.products) ? data.products : [];
      setResults(productResults);
      setMerchantId(data.merchantId ?? null);
      setSelectedProductId(productResults[0]?.product.id ?? null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('استغرق البحث وقتاً طويلاً، حاول مجدداً.');
      } else {
        setError(err instanceof Error ? err.message : 'تعذر البحث عن المنتجات');
      }
      setResults([]);
      setSelectedProductId(null);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(queryInput);
  };

  const handleRefresh = () => {
    if (lastQuery) {
      void search(lastQuery);
    }
  };

  if (status === 'loading') {
    return (
      <AppPageShell title="البحث عن منتجات" subtitle="جاري تحميل الجلسة">
        <LoadingState label="جاري تحميل الجلسة..." />
      </AppPageShell>
    );
  }

  if (status !== 'authenticated') {
    return null;
  }

  return (
    <AppPageShell
      title="البحث عن منتجات"
      subtitle="ابحث في منتجات سلة واعرض تفاصيل المنتج وطلبات الشراء وتواريخ الطلبات المرتبطة به"
    >
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <Card>
          <CardContent className="space-y-4 p-4 md:p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                <PackageSearch className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-foreground">بحث منتجات سلة</p>
                <p className="text-sm text-muted-foreground">
                  ابحث باسم المنتج أو SKU ثم راجع الطلبات وطلبات الشراء من نفس الصفحة.
                </p>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="اسم المنتج أو SKU"
                className="h-11"
              />
              <Button type="submit" className="h-11" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                بحث
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={loading || !lastQuery}
                onClick={handleRefresh}
              >
                <RefreshCcw className="h-4 w-4" />
                تحديث
              </Button>
            </form>
          </CardContent>
        </Card>

        <Button asChild variant="outline" className="h-11">
          <Link href="/salla/purchase-requests">
            <ExternalLink className="h-4 w-4" />
            طلبات الشراء
          </Link>
        </Button>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <LoadingState label="جاري البحث في المنتجات والطلبات..." />
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              title={lastQuery ? 'لا توجد منتجات مطابقة' : 'ابدأ بالبحث عن منتج'}
              description="ستظهر تفاصيل المنتج وتواريخ الطلبات وطلبات الشراء بعد البحث."
            />
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <ProductResultsList
            results={results}
            selectedProductId={selectedResult?.product.id ?? null}
            onSelect={setSelectedProductId}
          />

          {selectedResult && (
            <ProductDetailsPanel
              result={selectedResult}
              merchantId={merchantId}
              onCreated={(request) => {
                setResults((current) =>
                  current.map((entry) => {
                    if (entry.product.id !== request.productId) {
                      return entry;
                    }
                    const nextRequests = [request, ...entry.purchaseRequests];
                    return {
                      ...entry,
                      purchaseRequests: nextRequests,
                      stats: {
                        ...entry.stats,
                        requestedQuantity: entry.stats.requestedQuantity + request.quantity,
                        activePurchaseRequests: nextRequests.length,
                      },
                    };
                  })
                );
              }}
            />
          )}
        </section>
      )}
    </AppPageShell>
  );
}

type ProductResultsListProps = {
  results: ProductSearchResult[];
  selectedProductId: number | null;
  onSelect: (productId: number) => void;
};

function ProductResultsList({ results, selectedProductId, onSelect }: ProductResultsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>المنتجات</span>
          <Badge variant="secondary">{formatNumber(results.length)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {results.map((entry) => {
          const selected = entry.product.id === selectedProductId;
          return (
            <button
              key={entry.product.id}
              type="button"
              onClick={() => onSelect(entry.product.id)}
              className={`flex w-full items-center gap-3 rounded-md border p-3 text-start transition ${
                selected ? 'border-slate-900 bg-slate-50' : 'hover:bg-muted/60'
              }`}
            >
              {entry.product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.product.imageUrl}
                  alt={entry.product.name}
                  className="h-14 w-14 shrink-0 rounded-md border object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">
                  لا صورة
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{entry.product.name}</p>
                <p className="text-xs text-muted-foreground">SKU: {entry.product.sku || '—'}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="secondary">{formatNumber(entry.stats.activePurchaseRequests)} طلب شراء</Badge>
                </div>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

type ProductDetailsPanelProps = {
  result: ProductSearchResult;
  merchantId: string | null;
  onCreated: (request: PurchaseRequestRecord) => void;
};

function ProductDetailsPanel({ result, merchantId, onCreated }: ProductDetailsPanelProps) {
  const product = result.product;
  const currency = product.currency || 'SAR';
  const quickStats = [
    { label: 'الكمية المتاحة', value: formatNumber(product.availableQuantity) },
    { label: 'طلبات الشراء النشطة', value: formatNumber(result.stats.activePurchaseRequests) },
    { label: 'مطلوب شراؤه', value: formatNumber(result.stats.requestedQuantity) },
    { label: 'قيد الشراء', value: formatNumber(result.stats.onTheWayQuantity) },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5 p-4 md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                className="h-32 w-32 rounded-md border object-cover"
              />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                لا صورة
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <h2 className="text-xl font-semibold text-foreground">{product.name}</h2>
                <p className="text-sm text-muted-foreground">
                  SKU: {product.sku || '—'} · #{product.id}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{formatCurrency(product.priceAmount, currency)}</Badge>
                <Badge variant="outline">الحالة: {product.status || 'غير محدد'}</Badge>
              </div>
            </div>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quickStats.map((stat) => (
              <div key={stat.label} className="rounded-md border bg-muted/30 px-4 py-3">
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className="text-xl font-semibold text-foreground">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <PurchaseRequestForm product={product} merchantId={merchantId} onCreated={onCreated} />
      <ProductPurchaseRequestsTable requests={result.purchaseRequests} />
      <ProductVariationsTable variations={product.variations ?? []} currency={currency} />
    </div>
  );
}

type PurchaseRequestFormProps = {
  product: SallaProductSummary & { variations?: SallaProductVariation[] };
  merchantId: string | null;
  onCreated: (request: PurchaseRequestRecord) => void;
};

function PurchaseRequestForm({ product, merchantId, onCreated }: PurchaseRequestFormProps) {
  const [selectedVariationKey, setSelectedVariationKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const variations = product.variations ?? [];
  const selectedVariation =
    variations.find((variation) => variationKey(variation) === selectedVariationKey) ?? null;
  const parsedQuantity = Number.parseInt(quantity, 10);

  useEffect(() => {
    setSelectedVariationKey('');
    setQuantity('1');
    setNotes('');
    setMessage(null);
    setError(null);
  }, [product.id]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError('الكمية يجب أن تكون أكبر من صفر.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch('/api/salla/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          productImageUrl: product.imageUrl,
          merchantId,
          quantity: parsedQuantity,
          status: 'requested',
          notes,
          variantId: selectedVariation ? String(selectedVariation.id) : undefined,
          variantName: selectedVariation?.name,
          variantSku: selectedVariation?.sku,
          variantBarcode: selectedVariation?.barcode,
          variantOptions: selectedVariation?.name ? [selectedVariation.name] : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر إنشاء طلب الشراء');
      }
      onCreated(data.request as PurchaseRequestRecord);
      setMessage('تم إنشاء طلب الشراء.');
      setQuantity('1');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء طلب الشراء');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShoppingCart className="h-4 w-4" />
          طلب شراء من هذا المنتج
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_120px_auto]">
          <NativeSelect
            value={selectedVariationKey}
            onChange={(event) => setSelectedVariationKey(event.target.value)}
            className="h-11"
            aria-label="اختيار المقاس أو المتغير"
          >
            <NativeSelectOption value="">المنتج الأساسي</NativeSelectOption>
            {variations.map((variation) => (
              <NativeSelectOption key={variationKey(variation)} value={variationKey(variation)}>
                {variation.name}
                {variation.sku ? ` - ${variation.sku}` : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-11"
            aria-label="كمية طلب الشراء"
          />
          <Button type="submit" className="h-11" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
            طلب شراء
          </Button>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="ملاحظات اختيارية"
            className="lg:col-span-3"
            rows={2}
          />
        </form>
        {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function getSoonestArrival(requests: PurchaseRequestRecord[]): Date | null {
  let soonest: Date | null = null;
  for (const request of requests) {
    if (!request.expectedArrivalAt) {
      continue;
    }
    const date = new Date(request.expectedArrivalAt);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    if (!soonest || date.getTime() < soonest.getTime()) {
      soonest = date;
    }
  }
  return soonest;
}

function ProductPurchaseRequestsTable({ requests }: { requests: PurchaseRequestRecord[] }) {
  const soonestArrival = getSoonestArrival(requests);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">طلبات الشراء لهذا المنتج</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {soonestArrival && (
          <div className="flex flex-col items-center gap-2 border-b bg-gradient-to-b from-emerald-50 to-transparent px-6 py-8 text-center">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CalendarCheck className="h-4 w-4 animate-pulse" />
              تاريخ الوصول المتوقع
            </div>
            <p className="animate-pulse bg-gradient-to-l from-emerald-600 to-teal-500 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
              {formatDay(soonestArrival)}
            </p>
          </div>
        )}
        {requests.length === 0 ? (
          <div className="p-6">
            <EmptyState title="لا توجد طلبات شراء نشطة لهذا المنتج" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحالة</TableHead>
                <TableHead>المتغير</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>طلب بواسطة</TableHead>
                <TableHead>تاريخ الطلب</TableHead>
                <TableHead>الوصول المتوقع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => {
                const variantOptions = getVariantOptions(request.variantOptions);
                return (
                  <TableRow key={request.id}>
                    <TableCell>
                      <Badge variant={request.status === 'on_the_way' ? 'secondary' : 'outline'}>
                        {statusLabel(request.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-40">
                        <p>{request.variantName || 'المنتج الأساسي'}</p>
                        {variantOptions.length > 0 && (
                          <p className="text-xs text-muted-foreground">{variantOptions.join(' · ')}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatNumber(request.quantity)}</TableCell>
                    <TableCell>{request.requestedBy}</TableCell>
                    <TableCell>{formatDate(request.requestedAt)}</TableCell>
                    <TableCell>{formatDay(request.expectedArrivalAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ProductVariationsTable({
  variations,
  currency,
}: {
  variations: SallaProductVariation[];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">المقاسات والمتغيرات</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {variations.length === 0 ? (
          <div className="p-6">
            <EmptyState title="لا توجد متغيرات محملة لهذا المنتج" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المتغير</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>الباركود</TableHead>
                <TableHead>السعر</TableHead>
                <TableHead>المتوفر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variations.map((variation) => (
                <TableRow key={variationKey(variation)}>
                  <TableCell>{variation.name}</TableCell>
                  <TableCell>{variation.sku || '—'}</TableCell>
                  <TableCell>{variation.barcode || '—'}</TableCell>
                  <TableCell>{formatCurrency(variation.priceAmount, variation.currency || currency)}</TableCell>
                  <TableCell>{formatNumber(variation.availableQuantity)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
