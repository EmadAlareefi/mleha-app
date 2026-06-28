'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PurchaseRequestRecord } from '@/app/lib/salla-purchase-requests';
import type { SallaProductSummary, SallaProductVariation } from '@/app/lib/salla-api';

type PurchaseRequestsBoardProps = {
  initialRequests: PurchaseRequestRecord[];
  canManage: boolean;
};

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
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
    return 'غير محدد';
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

export function PurchaseRequestsBoard({ initialRequests, canManage }: PurchaseRequestsBoardProps) {
  const [requests, setRequests] = useState<PurchaseRequestRecord[]>(initialRequests);
  const [activeTab, setActiveTab] = useState<'requested' | 'on_the_way'>('requested');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);

  const requested = useMemo(
    () => requests.filter((request) => request.status === 'requested'),
    [requests]
  );
  const onTheWay = useMemo(
    () => requests.filter((request) => request.status === 'on_the_way'),
    [requests]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch('/api/salla/purchase-requests', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحديث قائمة الطلبات');
      }
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'تعذر تحديث قائمة الطلبات');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const upsertRequest = useCallback((updated: PurchaseRequestRecord) => {
    setRequests((prev) => {
      const exists = prev.some((request) => request.id === updated.id);
      if (exists) {
        return prev.map((request) => (request.id === updated.id ? updated : request));
      }
      return [updated, ...prev];
    });
  }, []);

  const removeRequest = useCallback((id: string) => {
    setRequests((prev) => prev.filter((request) => request.id !== id));
  }, []);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">المطلوب شراؤها</p>
            <p className="text-3xl font-semibold text-amber-600">{formatNumber(requested.length)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">قيد الشراء</p>
            <p className="text-3xl font-semibold text-emerald-600">{formatNumber(onTheWay.length)}</p>
          </CardContent>
        </Card>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AddProductDialog targetStatus={activeTab} onCreated={upsertRequest} />
        <Button
          type="button"
          variant="outline"
          className="flex items-center gap-2"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCcw className="h-4 w-4" />
          {refreshing ? 'جاري التحديث...' : 'تحديث القائمة'}
        </Button>
      </div>

      {refreshError && (
        <Alert variant="destructive">
          <AlertDescription>{refreshError}</AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="requested">المطلوب شراؤها ({formatNumber(requested.length)})</TabsTrigger>
          <TabsTrigger value="on_the_way">قيد الشراء ({formatNumber(onTheWay.length)})</TabsTrigger>
        </TabsList>

        <TabsContent value="requested">
          <RequestGrid
            requests={requested}
            emptyTitle="لا توجد طلبات شراء حالياً"
            canManage={canManage}
            onUpdated={upsertRequest}
            onRemoved={removeRequest}
          />
        </TabsContent>

        <TabsContent value="on_the_way">
          <RequestGrid
            requests={onTheWay}
            emptyTitle="لا توجد منتجات قيد الشراء حالياً"
            canManage={canManage}
            onUpdated={upsertRequest}
            onRemoved={removeRequest}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type RequestGridProps = {
  requests: PurchaseRequestRecord[];
  emptyTitle: string;
  canManage: boolean;
  onUpdated: (request: PurchaseRequestRecord) => void;
  onRemoved: (id: string) => void;
};

function RequestGrid({ requests, emptyTitle, canManage, onUpdated, onRemoved }: RequestGridProps) {
  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState title={emptyTitle} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {requests.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          canManage={canManage}
          onUpdated={onUpdated}
          onRemoved={onRemoved}
        />
      ))}
    </div>
  );
}

type RequestCardProps = {
  request: PurchaseRequestRecord;
  canManage: boolean;
  onUpdated: (request: PurchaseRequestRecord) => void;
  onRemoved: (id: string) => void;
};

function RequestCard({ request, canManage, onUpdated, onRemoved }: RequestCardProps) {
  const [increaseOpen, setIncreaseOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const variantOptions = getVariantOptions(request.variantOptions);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/salla/purchase-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحديث الطلب');
      }
      onUpdated(data.request as PurchaseRequestRecord);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث الطلب');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleIncrease = async () => {
    const ok = await patch({ action: 'increment', by: 1 });
    if (ok) {
      setIncreaseOpen(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/salla/purchase-requests/${request.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر إزالة الطلب');
      }
      onRemoved(request.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إزالة الطلب');
    } finally {
      setBusy(false);
      setRemoveOpen(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            {request.productImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={request.productImageUrl}
                alt={request.productName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                لا صورة
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-slate-900">{request.productName}</p>
            <p className="text-xs text-muted-foreground">SKU: {request.productSku || '—'}</p>
            {request.variantName && (
              <p className="text-xs text-muted-foreground">
                المقاس/المتغير: {request.variantName}
                {request.variantSku ? ` · SKU: ${request.variantSku}` : ''}
              </p>
            )}
            <p className="text-xs text-muted-foreground">#{request.productId}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              طلب بواسطة {request.requestedBy} · {formatDate(request.requestedAt)}
            </p>
            {request.status === 'on_the_way' && (
              <p className="mt-1 text-xs font-medium text-emerald-700">
                تاريخ الوصول المتوقع: {formatDay(request.expectedArrivalAt)}
              </p>
            )}
          </div>
        </div>

        {variantOptions.length > 0 && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            خيارات المتغير: {variantOptions.join(' · ')}
          </div>
        )}

        {request.notes && (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{request.notes}</p>
        )}

        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="text-sm">
            الكمية المطلوبة: <span className="ms-1 font-bold">{formatNumber(request.quantity)}</span>
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex items-center gap-1"
            onClick={() => setIncreaseOpen(true)}
            disabled={busy}
          >
            <Plus className="h-4 w-4" />
            زيادة الكمية
          </Button>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {request.status === 'requested' && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="flex items-center gap-1"
                onClick={() => setRemoveOpen(true)}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" />
                حذف الطلب
              </Button>
            )}
            {request.status === 'on_the_way' && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="flex items-center gap-1"
                onClick={() => setRemoveOpen(true)}
                disabled={busy}
              >
                <Check className="h-4 w-4" />
                تم الشراء (إزالة)
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>

      <ConfirmationDialog
        open={increaseOpen}
        title="تأكيد زيادة الكمية"
        message={`سيتم زيادة الكمية المطلوبة من ${formatNumber(request.quantity)} إلى ${formatNumber(
          request.quantity + 1
        )} لمنتج «${request.productName}».`}
        confirmLabel="زيادة"
        confirmDisabled={busy}
        onConfirm={handleIncrease}
        onCancel={() => setIncreaseOpen(false)}
      />

      <ConfirmationDialog
        open={removeOpen}
        title={request.status === 'requested' ? 'تأكيد حذف الطلب' : 'تأكيد إتمام الشراء'}
        message={
          request.status === 'requested'
            ? `سيتم حذف طلب شراء «${request.productName}» من قائمة المطلوب شراؤه.`
            : `سيتم تأكيد شراء «${request.productName}» وإزالته من القائمة (مع حفظه في السجل).`
        }
        confirmLabel={request.status === 'requested' ? 'حذف' : 'تأكيد الإزالة'}
        cancelLabel="إلغاء"
        confirmVariant="danger"
        confirmDisabled={busy}
        onConfirm={handleRemove}
        onCancel={() => setRemoveOpen(false)}
      />
    </Card>
  );
}

type AddProductDialogProps = {
  targetStatus: 'requested' | 'on_the_way';
  onCreated: (request: PurchaseRequestRecord) => void;
};

function AddProductDialog({ targetStatus, onCreated }: AddProductDialogProps) {
  const [open, setOpen] = useState(false);
  const [skuInput, setSkuInput] = useState('');
  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [variationsByProductId, setVariationsByProductId] = useState<Record<number, SallaProductVariation[]>>({});
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);
  const isOnTheWay = targetStatus === 'on_the_way';
  const triggerLabel = isOnTheWay ? 'إضافة منتج قيد الشراء' : 'إضافة مطلوب شراؤه';
  const dialogTitle = isOnTheWay ? 'إضافة منتج قيد الشراء' : 'إضافة طلب شراء';

  const loadVariations = async (productList: SallaProductSummary[], resolvedMerchantId: string | null) => {
    const productIds = productList.map((product) => product.id).filter((id) => Number.isFinite(id));
    if (productIds.length === 0) {
      return;
    }

    setVariationsLoading(true);
    try {
      const response = await fetch('/api/salla/products/variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds, merchantId: resolvedMerchantId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل مقاسات المنتجات');
      }
      const fetched = data.variations && typeof data.variations === 'object' ? data.variations : {};
      setVariationsByProductId((current) => ({
        ...current,
        ...Object.fromEntries(
          Object.entries(fetched).map(([productId, variations]) => [
            Number(productId),
            Array.isArray(variations) ? variations as SallaProductVariation[] : [],
          ])
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل مقاسات المنتجات');
    } finally {
      setVariationsLoading(false);
    }
  };

  const search = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    const sku = skuInput.trim();
    if (!sku) {
      setError('أدخل اسم المنتج أو SKU للبحث.');
      return;
    }

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const params = new URLSearchParams({ page: '1', perPage: '50', sku });
      const response = await fetch(`/api/salla/products?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل منتجات سلة');
      }
      const productList = Array.isArray(data.products) ? data.products as SallaProductSummary[] : [];
      const resolvedMerchantId = typeof data.merchantId === 'string' ? data.merchantId : null;
      setProducts(productList);
      setMerchantId(resolvedMerchantId);
      setVariationsByProductId(
        Object.fromEntries(
          productList.map((product) => [product.id, Array.isArray(product.variations) ? product.variations : []])
        )
      );
      void loadVariations(productList, resolvedMerchantId);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('استغرق البحث وقتاً طويلاً، حاول مجدداً.');
      } else {
        setError(err instanceof Error ? err.message : 'تعذر تحميل المنتجات');
      }
      setProducts([]);
      setVariationsByProductId({});
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  const addProduct = async (
    product: SallaProductSummary,
    options: {
      quantity: number;
      variation?: SallaProductVariation | null;
      expectedArrivalAt?: string;
    }
  ) => {
    if (isOnTheWay && !options.expectedArrivalAt) {
      setError('تاريخ الوصول المتوقع مطلوب لمنتجات قيد الشراء.');
      return;
    }

    setAddingId(product.id);
    setError(null);
    try {
      const variation = options.variation;
      const response = await fetch('/api/salla/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          productImageUrl: product.imageUrl,
          merchantId,
          quantity: options.quantity,
          status: targetStatus,
          expectedArrivalAt: options.expectedArrivalAt,
          variantId: variation ? String(variation.id) : undefined,
          variantName: variation?.name,
          variantSku: variation?.sku,
          variantBarcode: variation?.barcode,
          variantOptions: variation?.name ? [variation.name] : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر إنشاء طلب الشراء');
      }
      onCreated(data.request as PurchaseRequestRecord);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء طلب الشراء');
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            ابحث عن منتج سلة باسمه أو SKU ثم اختر المقاس والكمية قبل إضافته.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={skuInput}
            onChange={(event) => setSkuInput(event.target.value)}
            placeholder="ابحث باسم المنتج أو SKU"
            className="h-11"
          />
          <Button type="submit" className="h-11" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            بحث
          </Button>
        </form>

        <p className="text-[11px] text-muted-foreground">
          قد يستغرق البحث برمز SKU وتحميل المقاسات بضع ثوانٍ.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل المنتجات...
            </p>
          ) : products.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد منتجات مطابقة.</p>
          ) : (
            <>
              {variationsLoading && (
                <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  جاري تحميل المقاسات...
                </p>
              )}
              {products.map((product) => (
                <ProductResultRow
                  key={product.id}
                  product={product}
                  variations={variationsByProductId[product.id] ?? product.variations ?? []}
                  targetStatus={targetStatus}
                  adding={addingId === product.id}
                  onAdd={addProduct}
                />
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ProductResultRowProps = {
  product: SallaProductSummary;
  variations: SallaProductVariation[];
  targetStatus: 'requested' | 'on_the_way';
  adding: boolean;
  onAdd: (
    product: SallaProductSummary,
    options: {
      quantity: number;
      variation?: SallaProductVariation | null;
      expectedArrivalAt?: string;
    }
  ) => void;
};

function ProductResultRow({ product, variations, targetStatus, adding, onAdd }: ProductResultRowProps) {
  const [selectedVariationKey, setSelectedVariationKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [expectedArrivalAt, setExpectedArrivalAt] = useState('');
  const selectedVariation =
    variations.find((variation) => variationKey(variation) === selectedVariationKey) ?? null;
  const parsedQuantity = Number.parseInt(quantity, 10);
  const canAdd =
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (targetStatus !== 'on_the_way' || expectedArrivalAt.length > 0);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-3">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={product.name}
            className="h-12 w-12 rounded-md border object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">
            لا صورة
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
          <p className="text-xs text-muted-foreground">SKU: {product.sku || '—'} · #{product.id}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_96px]">
        <NativeSelect
          value={selectedVariationKey}
          onChange={(event) => setSelectedVariationKey(event.target.value)}
          className="h-10 w-full"
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
          placeholder="الكمية"
          className="h-10"
        />
      </div>

      {targetStatus === 'on_the_way' && (
        <Input
          type="date"
          value={expectedArrivalAt}
          onChange={(event) => setExpectedArrivalAt(event.target.value)}
          className="h-10"
          aria-label="تاريخ الوصول المتوقع"
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {variations.length > 0 ? `${formatNumber(variations.length)} مقاس/متغير متاح` : 'لا توجد مقاسات محملة'}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() =>
            onAdd(product, {
              quantity: parsedQuantity,
              variation: selectedVariation,
              expectedArrivalAt,
            })
          }
          disabled={adding || !canAdd}
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          إضافة
        </Button>
      </div>
    </div>
  );
}

export default PurchaseRequestsBoard;
