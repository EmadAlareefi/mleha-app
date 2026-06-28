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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  ManufacturerLinkedProductStats,
  PurchaseRequestRecord,
} from '@/app/lib/salla-purchase-requests';
import type { SallaProductSummary, SallaProductVariation } from '@/app/lib/salla-api';

type PurchaseRequestsBoardProps = {
  initialRequests: PurchaseRequestRecord[];
  loadManufacturerProducts: boolean;
  canManage: boolean;
};

type PurchaseRequestsTab = 'requested' | 'on_the_way' | 'manufacturer_products';

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

type GroupedPurchaseRequest = {
  key: string;
  primary: PurchaseRequestRecord;
  requests: PurchaseRequestRecord[];
  quantity: number;
  notes: Array<{ id: string; text: string; requestedBy: string; requestedAt: string | Date }>;
};

function groupPurchaseRequests(requests: PurchaseRequestRecord[]): GroupedPurchaseRequest[] {
  const groups = new Map<string, PurchaseRequestRecord[]>();

  requests.forEach((request) => {
    const key = `${request.status}:${request.productId}`;
    groups.set(key, [...(groups.get(key) ?? []), request]);
  });

  return Array.from(groups.entries())
    .map(([key, groupRequests]) => {
      const sorted = [...groupRequests].sort(
        (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
      );
      return {
        key,
        primary: sorted[0],
        requests: sorted,
        quantity: sorted.reduce((sum, request) => sum + request.quantity, 0),
        notes: sorted
          .filter((request) => request.notes && request.notes.trim().length > 0)
          .map((request) => ({
            id: request.id,
            text: request.notes as string,
            requestedBy: request.requestedBy,
            requestedAt: request.requestedAt,
          })),
      };
    })
    .sort((a, b) => new Date(b.primary.requestedAt).getTime() - new Date(a.primary.requestedAt).getTime());
}

export function PurchaseRequestsBoard({
  initialRequests,
  loadManufacturerProducts,
  canManage,
}: PurchaseRequestsBoardProps) {
  const [requests, setRequests] = useState<PurchaseRequestRecord[]>(initialRequests);
  const [manufacturerProducts, setManufacturerProducts] = useState<ManufacturerLinkedProductStats[] | null>(
    null
  );
  const [manufacturerLoading, setManufacturerLoading] = useState(loadManufacturerProducts);
  const [manufacturerError, setManufacturerError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PurchaseRequestsTab>('requested');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);

  // The manufacturer "منتجاتي" sales stats are intentionally loaded client-side:
  // computing them scans the full orders table, so blocking the server render on
  // it makes the page hang for manufacturer users. Fetch it asynchronously instead.
  useEffect(() => {
    if (!loadManufacturerProducts) {
      return;
    }
    let cancelled = false;
    setManufacturerLoading(true);
    setManufacturerError(null);
    (async () => {
      try {
        const response = await fetch('/api/salla/purchase-requests', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحميل منتجاتي');
        }
        if (cancelled) {
          return;
        }
        if (Array.isArray(data.manufacturerProducts) || data.manufacturerProducts === null) {
          setManufacturerProducts(data.manufacturerProducts);
        }
        if (Array.isArray(data.requests)) {
          setRequests(data.requests);
        }
      } catch (error) {
        if (!cancelled) {
          setManufacturerError(error instanceof Error ? error.message : 'تعذر تحميل منتجاتي');
        }
      } finally {
        if (!cancelled) {
          setManufacturerLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadManufacturerProducts]);

  const requested = useMemo(
    () => requests.filter((request) => request.status === 'requested'),
    [requests]
  );
  const onTheWay = useMemo(
    () => requests.filter((request) => request.status === 'on_the_way'),
    [requests]
  );
  const groupedRequested = useMemo(() => groupPurchaseRequests(requested), [requested]);
  const groupedOnTheWay = useMemo(() => groupPurchaseRequests(onTheWay), [onTheWay]);
  const addProductTargetStatus = activeTab === 'on_the_way' ? 'on_the_way' : 'requested';

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
      if (Array.isArray(data.manufacturerProducts) || data.manufacturerProducts === null) {
        setManufacturerProducts(data.manufacturerProducts);
      }
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

  const removeRequests = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setRequests((prev) => prev.filter((request) => !idSet.has(request.id)));
  }, []);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">المطلوب شراؤها</p>
            <p className="text-3xl font-semibold text-amber-600">{formatNumber(groupedRequested.length)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">قيد الشراء</p>
            <p className="text-3xl font-semibold text-emerald-600">{formatNumber(groupedOnTheWay.length)}</p>
          </CardContent>
        </Card>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AddProductDialog targetStatus={addProductTargetStatus} onCreated={upsertRequest} />
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
          <TabsTrigger value="requested">المطلوب شراؤها ({formatNumber(groupedRequested.length)})</TabsTrigger>
          <TabsTrigger value="on_the_way">قيد الشراء ({formatNumber(groupedOnTheWay.length)})</TabsTrigger>
          {loadManufacturerProducts && (
            <TabsTrigger value="manufacturer_products" className="flex items-center gap-1">
              منتجاتي
              {manufacturerProducts ? (
                ` (${formatNumber(manufacturerProducts.length)})`
              ) : manufacturerLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="requested">
          <RequestGrid
            groups={groupedRequested}
            emptyTitle="لا توجد طلبات شراء حالياً"
            canManage={canManage}
            onUpdated={upsertRequest}
            onRemoved={removeRequests}
          />
        </TabsContent>

        <TabsContent value="on_the_way">
          <RequestGrid
            groups={groupedOnTheWay}
            emptyTitle="لا توجد منتجات قيد الشراء حالياً"
            canManage={canManage}
            onUpdated={upsertRequest}
            onRemoved={removeRequests}
          />
        </TabsContent>

        {loadManufacturerProducts && (
          <TabsContent value="manufacturer_products">
            {!manufacturerProducts && manufacturerLoading ? (
              <Card>
                <CardContent className="p-6">
                  <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل منتجاتي...
                  </p>
                </CardContent>
              </Card>
            ) : !manufacturerProducts && manufacturerError ? (
              <Alert variant="destructive">
                <AlertDescription>{manufacturerError}</AlertDescription>
              </Alert>
            ) : (
              <ManufacturerProductsTab products={manufacturerProducts ?? []} requests={requests} />
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

type ManufacturerProductsTabProps = {
  products: ManufacturerLinkedProductStats[];
  requests: PurchaseRequestRecord[];
};

function ManufacturerProductsTab({ products, requests }: ManufacturerProductsTabProps) {
  const requestQuantities = useMemo(() => {
    const map = new Map<number, { requestedQuantity: number; onTheWayQuantity: number }>();
    requests.forEach((request) => {
      if (request.status !== 'requested' && request.status !== 'on_the_way') {
        return;
      }
      const entry = map.get(request.productId) ?? { requestedQuantity: 0, onTheWayQuantity: 0 };
      if (request.status === 'requested') {
        entry.requestedQuantity += request.quantity;
      } else {
        entry.onTheWayQuantity += request.quantity;
      }
      map.set(request.productId, entry);
    });
    return map;
  }, [requests]);

  const rows = useMemo(
    () =>
      products
        .map((product) => {
          const quantities = requestQuantities.get(product.productId);
          const requestedQuantity = quantities?.requestedQuantity ?? product.requestedQuantity;
          const onTheWayQuantity = quantities?.onTheWayQuantity ?? product.onTheWayQuantity;
          return {
            ...product,
            requestedQuantity,
            onTheWayQuantity,
            totalPurchaseQuantity: requestedQuantity + onTheWayQuantity,
          };
        })
        .sort((a, b) => {
          if (b.soldQuantity !== a.soldQuantity) {
            return b.soldQuantity - a.soldQuantity;
          }
          return b.soldAmount - a.soldAmount;
        }),
    [products, requestQuantities]
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState title="لا توجد منتجات مرتبطة بهذا المصنع" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المنتج</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>مطلوب</TableHead>
              <TableHead>قيد الشراء</TableHead>
              <TableHead>الإجمالي</TableHead>
              <TableHead>الكمية المباعة</TableHead>
              <TableHead>إجمالي المبيعات</TableHead>
              <TableHead>آخر بيع</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((product) => (
              <TableRow key={product.productId}>
                <TableCell>
                  <div className="min-w-48">
                    <p className="font-medium text-slate-900">
                      {product.productName || `#${product.productId}`}
                    </p>
                    <p className="text-xs text-muted-foreground">#{product.productId}</p>
                  </div>
                </TableCell>
                <TableCell>{product.productSku || '—'}</TableCell>
                <TableCell>{formatNumber(product.requestedQuantity)}</TableCell>
                <TableCell>{formatNumber(product.onTheWayQuantity)}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{formatNumber(product.totalPurchaseQuantity)}</Badge>
                </TableCell>
                <TableCell className="font-semibold">{formatNumber(product.soldQuantity)}</TableCell>
                <TableCell>{formatCurrency(product.soldAmount, product.currency)}</TableCell>
                <TableCell>{product.lastSoldAt ? formatDay(product.lastSoldAt) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type RequestGridProps = {
  groups: GroupedPurchaseRequest[];
  emptyTitle: string;
  canManage: boolean;
  onUpdated: (request: PurchaseRequestRecord) => void;
  onRemoved: (ids: string[]) => void;
};

function RequestGrid({ groups, emptyTitle, canManage, onUpdated, onRemoved }: RequestGridProps) {
  if (groups.length === 0) {
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
      {groups.map((group) => (
        <RequestCard
          key={group.key}
          group={group}
          canManage={canManage}
          onUpdated={onUpdated}
          onRemoved={onRemoved}
        />
      ))}
    </div>
  );
}

type RequestCardProps = {
  group: GroupedPurchaseRequest;
  canManage: boolean;
  onUpdated: (request: PurchaseRequestRecord) => void;
  onRemoved: (ids: string[]) => void;
};

function RequestCard({ group, canManage, onUpdated, onRemoved }: RequestCardProps) {
  const [increaseOpen, setIncreaseOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = group.primary;
  const variantOptions = getVariantOptions(request.variantOptions);
  const hasMultipleRows = group.requests.length > 1;

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
    const removedIds: string[] = [];
    try {
      for (const groupedRequest of group.requests) {
        const response = await fetch(`/api/salla/purchase-requests/${groupedRequest.id}`, {
          method: 'DELETE',
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر إزالة الطلب');
        }
        removedIds.push(groupedRequest.id);
      }
      onRemoved(removedIds);
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
              آخر طلب بواسطة {request.requestedBy} · {formatDate(request.requestedAt)}
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

        {hasMultipleRows && (
          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-700">
              تم تجميع {formatNumber(group.requests.length)} طلب لنفس المنتج
            </p>
            <div className="space-y-1">
              {group.requests.map((groupedRequest) => (
                <div key={groupedRequest.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <Badge variant="outline">{formatNumber(groupedRequest.quantity)}</Badge>
                  <span>{groupedRequest.variantName || 'المنتج الأساسي'}</span>
                  {groupedRequest.variantSku && <span>SKU: {groupedRequest.variantSku}</span>}
                  <span className="text-slate-400">·</span>
                  <span>{groupedRequest.requestedBy}</span>
                  <span>{formatDate(groupedRequest.requestedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {group.notes.length > 0 && (
          <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-medium text-slate-700">الملاحظات</p>
            {group.notes.map((note) => (
              <p key={note.id}>
                <span className="font-medium">{note.requestedBy}:</span> {note.text}
              </p>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary" className="text-sm">
            الكمية المطلوبة: <span className="ms-1 font-bold">{formatNumber(group.quantity)}</span>
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
        message={`سيتم زيادة الكمية المطلوبة من ${formatNumber(group.quantity)} إلى ${formatNumber(
          group.quantity + 1
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
