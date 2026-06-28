'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, RefreshCcw, Search, ShoppingCart } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { PurchaseRequestRecord } from '@/app/lib/salla-purchase-requests';
import type { SallaProductSummary } from '@/app/lib/salla-api';

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
        <AddProductDialog onCreated={upsertRequest} />
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

  const handleMoveOnTheWay = async () => {
    await patch({ action: 'move_on_the_way' });
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
            <p className="text-xs text-muted-foreground">#{request.productId}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              طلب بواسطة {request.requestedBy} · {formatDate(request.requestedAt)}
            </p>
          </div>
        </div>

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
                className="flex items-center gap-1"
                onClick={handleMoveOnTheWay}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                نقل إلى قيد الشراء
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
        title="تأكيد إتمام الشراء"
        message={`سيتم تأكيد شراء «${request.productName}» وإزالته من القائمة (مع حفظه في السجل).`}
        confirmLabel="تأكيد الإزالة"
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
  onCreated: (request: PurchaseRequestRecord) => void;
};

function AddProductDialog({ onCreated }: AddProductDialogProps) {
  const [open, setOpen] = useState(false);
  const [skuInput, setSkuInput] = useState('');
  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);

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
      setProducts(Array.isArray(data.products) ? data.products : []);
      setMerchantId(typeof data.merchantId === 'string' ? data.merchantId : null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('استغرق البحث وقتاً طويلاً، حاول مجدداً.');
      } else {
        setError(err instanceof Error ? err.message : 'تعذر تحميل المنتجات');
      }
      setProducts([]);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  const addProduct = async (product: SallaProductSummary) => {
    setAddingId(product.id);
    setError(null);
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
          quantity: 1,
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
          إضافة منتج
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>إضافة طلب شراء</DialogTitle>
          <DialogDescription>ابحث عن منتج سلة باسمه أو SKU ثم أضفه إلى قائمة الطلبات.</DialogDescription>
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
          قد يستغرق البحث برمز SKU بضع ثوانٍ.
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
            products.map((product) => (
              <div
                key={product.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 p-2"
              >
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
                <Button
                  type="button"
                  size="sm"
                  onClick={() => addProduct(product)}
                  disabled={addingId === product.id}
                >
                  {addingId === product.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  إضافة
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PurchaseRequestsBoard;
