'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Factory, Loader2, RefreshCcw, Search } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { SallaPaginationMeta, SallaProductSummary } from '@/app/lib/salla-api';

const PAGE_SIZE = 100;

// Special sentinel values for the filter <select> (factories use `factory:<id>`).
const FILTER_ALL = 'all';
const FILTER_LINKED = 'linked';
const FILTER_UNLINKED = 'unlinked';
const FACTORY_PREFIX = 'factory:';

type ManufacturerUserOption = {
  id: string;
  name: string;
  username: string;
};

type LinkedRecord = {
  productId: string;
  sku: string | null;
  productName: string | null;
  imageUrl: string | null;
  userId: string;
  userName: string | null;
  username: string | null;
};

// Unified shape rendered by the card grid, whatever the source.
type ProductCardItem = {
  productId: number;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  priceAmount?: number | null;
  currency?: string;
  availableQuantity?: number | null;
  manufacturerId: string;
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

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

async function readJsonResponse(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (response.redirected || response.url.includes('/login')) {
      throw new Error('انتهت الجلسة أو لا تملك صلاحية الوصول. يرجى تسجيل الدخول مجدداً.');
    }
    throw new Error(fallbackMessage);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(fallbackMessage);
  }
}

export default function SallaManufacturerLinksPage() {
  const router = useRouter();
  const { status } = useSession();

  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [pagination, setPagination] = useState<SallaPaginationMeta | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [skuInput, setSkuInput] = useState('');
  const [searchSku, setSearchSku] = useState('');
  const [filter, setFilter] = useState<string>(FILTER_ALL);

  const [manufacturers, setManufacturers] = useState<ManufacturerUserOption[]>([]);
  const [manufacturersError, setManufacturersError] = useState<string | null>(null);

  const [linkedRecords, setLinkedRecords] = useState<LinkedRecord[]>([]);
  const [linkedLoading, setLinkedLoading] = useState(false);

  // Full catalog, loaded only for the "unlinked" view so we can subtract the
  // linked products and paginate the remainder locally.
  const [allProducts, setAllProducts] = useState<SallaProductSummary[]>([]);
  const [allProductsLoading, setAllProductsLoading] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);

  const [savingMap, setSavingMap] = useState<Record<number, boolean>>({});
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});

  const isLinkedMode = filter === FILTER_LINKED || filter.startsWith(FACTORY_PREFIX);
  // "Unlinked" needs the whole catalog; an active SKU search instead narrows the
  // browse list, so only treat it as unlinked-mode when not searching.
  const isUnlinkedMode = filter === FILTER_UNLINKED && !searchSku;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchManufacturers = useCallback(async () => {
    setManufacturersError(null);
    try {
      const response = await fetch('/api/product-suppliers?mode=factories', { cache: 'no-store' });
      const data = await readJsonResponse(response, 'تعذر تحميل قائمة المصانع');
      if (response.ok && data.success && Array.isArray(data.users)) {
        setManufacturers(
          data.users.map((user: ManufacturerUserOption) => ({
            id: user.id,
            name: user.name,
            username: user.username,
          }))
        );
        return;
      }
      throw new Error(data?.error || 'تعذر تحميل قائمة المصانع');
    } catch (err) {
      setManufacturers([]);
      setManufacturersError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المصانع');
    }
  }, []);

  // Loads every linked product. Powers both the linked/by-factory view and the
  // "already linked" overlay shown while browsing.
  const fetchLinkedRecords = useCallback(async () => {
    setLinkedLoading(true);
    try {
      const response = await fetch('/api/product-suppliers', { cache: 'no-store' });
      const data = await readJsonResponse(response, 'تعذر تحميل المنتجات المرتبطة');
      if (response.ok && data.success && Array.isArray(data.productSuppliers)) {
        setLinkedRecords(
          data.productSuppliers.map((row: any) => ({
            productId: String(row.productId),
            sku: row.sku ?? null,
            productName: row.productName ?? null,
            imageUrl: row.imageUrl ?? null,
            userId: row.userId,
            userName: row.userName ?? row.user?.name ?? null,
            username: row.username ?? row.user?.username ?? null,
          }))
        );
        return;
      }
      throw new Error(data?.error || 'تعذر تحميل المنتجات المرتبطة');
    } catch {
      setLinkedRecords([]);
    } finally {
      setLinkedLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async (page: number, sku: string) => {
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
      const response = await fetch(`/api/salla/products?${params.toString()}`, { cache: 'no-store' });
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
  }, []);

  const fetchAllProducts = useCallback(async () => {
    setAllProductsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/salla/products?all=1', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل منتجات سلة');
      }
      setAllProducts(Array.isArray(data.products) ? data.products : []);
      setCatalogTotal(typeof data.pagination?.total === 'number' ? data.pagination.total : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء تحميل المنتجات');
      setAllProducts([]);
    } finally {
      setAllProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchManufacturers();
      fetchLinkedRecords();
    }
  }, [status, fetchManufacturers, fetchLinkedRecords]);

  // Browse-mode products are paged server-side; skip it for linked/unlinked
  // views, which work off fully-loaded lists instead.
  useEffect(() => {
    if (status === 'authenticated' && !isLinkedMode && !isUnlinkedMode) {
      fetchProducts(currentPage, searchSku);
    }
  }, [status, isLinkedMode, isUnlinkedMode, currentPage, searchSku, fetchProducts]);

  // Load the whole catalog once when entering the unlinked view.
  useEffect(() => {
    if (status === 'authenticated' && isUnlinkedMode && allProducts.length === 0 && !allProductsLoading) {
      fetchAllProducts();
    }
  }, [status, isUnlinkedMode, allProducts.length, allProductsLoading, fetchAllProducts]);

  const linkedByProductId = useMemo(() => {
    const map = new Map<number, LinkedRecord>();
    linkedRecords.forEach((record) => {
      const id = Number.parseInt(record.productId, 10);
      if (Number.isFinite(id)) {
        map.set(id, record);
      }
    });
    return map;
  }, [linkedRecords]);

  const handleSave = useCallback(
    async (item: ProductCardItem, userId: string) => {
      setSavingMap((prev) => ({ ...prev, [item.productId]: true }));
      setSaveErrors((prev) => {
        const next = { ...prev };
        delete next[item.productId];
        return next;
      });
      try {
        if (userId) {
          const response = await fetch('/api/product-suppliers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: item.productId.toString(),
              userId,
              sku: item.sku ?? undefined,
              productName: item.name ?? undefined,
              imageUrl: item.imageUrl ?? undefined,
            }),
          });
          const data = await readJsonResponse(response, 'تعذر حفظ مصنع المنتج');
          if (!response.ok || !data.success) {
            throw new Error(data?.error || 'تعذر حفظ مصنع المنتج');
          }
          // Optimistically upsert into the single source of truth — avoids a
          // full refetch that would flash the whole grid into a loading state.
          const manufacturer = manufacturers.find((option) => option.id === userId);
          setLinkedRecords((prev) => [
            {
              productId: item.productId.toString(),
              sku: item.sku ?? null,
              productName: item.name ?? null,
              imageUrl: item.imageUrl ?? null,
              userId,
              userName: manufacturer?.name ?? null,
              username: manufacturer?.username ?? null,
            },
            ...prev.filter((record) => record.productId !== item.productId.toString()),
          ]);
        } else {
          const response = await fetch('/api/product-suppliers', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: item.productId.toString() }),
          });
          if (!response.ok && response.status !== 404) {
            const data = await readJsonResponse(response, 'تعذر حذف مصنع المنتج').catch(() => null);
            throw new Error(data?.error || 'تعذر حذف مصنع المنتج');
          }
          setLinkedRecords((prev) =>
            prev.filter((record) => record.productId !== item.productId.toString())
          );
        }
      } catch (err) {
        setSaveErrors((prev) => ({
          ...prev,
          [item.productId]: err instanceof Error ? err.message : 'تعذر حفظ التغيير',
        }));
      } finally {
        setSavingMap((prev) => {
          const next = { ...prev };
          delete next[item.productId];
          return next;
        });
      }
    },
    [manufacturers]
  );

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = skuInput.trim();
    // A search only makes sense over the browse list, so leave linked-only views.
    if (isLinkedMode) {
      setFilter(FILTER_ALL);
    }
    setCurrentPage(1);
    setSearchSku(trimmed);
  };

  const handleRefresh = () => {
    fetchLinkedRecords();
    if (isUnlinkedMode) {
      fetchAllProducts();
    } else if (!isLinkedMode) {
      fetchProducts(currentPage, searchSku);
    }
  };

  // Build the full list of cards for the active filter (before local paging).
  const cardItems = useMemo<ProductCardItem[]>(() => {
    let items: ProductCardItem[];

    if (isLinkedMode) {
      const factoryId = filter.startsWith(FACTORY_PREFIX)
        ? filter.slice(FACTORY_PREFIX.length)
        : null;
      items = linkedRecords
        .filter((record) => (factoryId ? record.userId === factoryId : true))
        .map((record) => ({
          productId: Number.parseInt(record.productId, 10),
          name: record.productName || record.sku || `#${record.productId}`,
          sku: record.sku,
          imageUrl: record.imageUrl,
          manufacturerId: record.userId,
        }))
        .filter((item) => Number.isFinite(item.productId));
    } else if (isUnlinkedMode) {
      // Whole catalog minus anything already linked.
      items = allProducts
        .filter((product) => !linkedByProductId.has(product.id))
        .map((product) => ({
          productId: product.id,
          name: product.name,
          sku: product.sku ?? null,
          imageUrl: product.imageUrl ?? null,
          priceAmount: product.priceAmount,
          currency: product.currency,
          availableQuantity: product.availableQuantity,
          manufacturerId: '',
        }));
    } else {
      items = products
        .map((product) => {
          const linked = linkedByProductId.get(product.id);
          return {
            productId: product.id,
            name: product.name,
            sku: product.sku ?? null,
            imageUrl: product.imageUrl ?? null,
            priceAmount: product.priceAmount,
            currency: product.currency,
            availableQuantity: product.availableQuantity,
            manufacturerId: linked?.userId ?? '',
          };
        })
        .filter((item) => (filter === FILTER_UNLINKED ? !item.manufacturerId : true));
    }

    // Salla's products endpoint can return the same product more than once, so
    // collapse by productId to keep one card per product (and stable React keys).
    const seen = new Set<number>();
    return items.filter((item) => {
      if (seen.has(item.productId)) {
        return false;
      }
      seen.add(item.productId);
      return true;
    });
  }, [isLinkedMode, isUnlinkedMode, filter, linkedRecords, products, allProducts, linkedByProductId]);

  // The unlinked view paginates the full filtered list client-side; other
  // browse views are already paged by the server.
  const unlinkedTotalPages = Math.max(1, Math.ceil(cardItems.length / PAGE_SIZE));
  const effectiveTotalPages = isUnlinkedMode ? unlinkedTotalPages : pagination?.totalPages ?? 1;
  const visibleCardItems = isUnlinkedMode
    ? cardItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : cardItems;

  const handlePageChange = (direction: 'prev' | 'next') => {
    setCurrentPage((prev) => {
      if (direction === 'prev') {
        return Math.max(prev - 1, 1);
      }
      return Math.min(prev + 1, effectiveTotalPages);
    });
  };

  // Linking a product shrinks the unlinked list, so keep the page in range.
  useEffect(() => {
    if (currentPage > effectiveTotalPages) {
      setCurrentPage(effectiveTotalPages);
    }
  }, [currentPage, effectiveTotalPages]);

  if (status === 'loading') {
    return (
      <AppPageShell title="ربط المنتجات بالمصانع" subtitle="ربط منتجات سلة بالمصانع">
        <LoadingState label="جاري تحميل الجلسة..." />
      </AppPageShell>
    );
  }

  if (status !== 'authenticated') {
    return null;
  }

  const totalPages = effectiveTotalPages;
  const showGridLoading = isLinkedMode
    ? linkedLoading
    : isUnlinkedMode
      ? allProductsLoading
      : loading;
  const linkedCount = linkedRecords.length;
  // `pagination.total` is the store-wide catalog size only while browsing the
  // full list; during an SKU search it holds the match count, so ignore it then.
  const storeTotal = searchSku ? null : pagination?.total ?? null;
  // In the unlinked view the displayed list is exactly what we managed to load,
  // so report counts from that list to stay consistent with the pager. Show the
  // gap against Salla's reported catalog size when enumeration came up short.
  const unlinkedListCount = cardItems.length;
  const remainingCount =
    isUnlinkedMode && allProducts.length > 0
      ? unlinkedListCount
      : storeTotal != null
        ? Math.max(storeTotal - linkedCount, 0)
        : null;
  const catalogShortfall =
    isUnlinkedMode && catalogTotal != null
      ? Math.max(catalogTotal - allProducts.length, 0)
      : 0;

  return (
    <AppPageShell
      title="ربط المنتجات بالمصانع"
      subtitle="اربط منتجات سلة بالمصانع مع صور أوضح وفلترة سريعة للمنتجات المرتبطة"
    >
      <section className="space-y-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <Factory className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-foreground">ربط المنتجات بالمصانع</p>
                  <p className="text-sm text-muted-foreground">
                    المرتبطة: {formatNumber(linkedCount)}
                    {storeTotal != null && (
                      <>
                        {' · '}إجمالي المنتجات: {formatNumber(storeTotal)}
                        {' · '}المتبقية: {formatNumber(remainingCount)}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <Button onClick={handleRefresh} disabled={loading || linkedLoading || allProductsLoading}>
                <RefreshCcw className="h-4 w-4" />
                تحديث
              </Button>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <form onSubmit={handleSearchSubmit} className="flex-1">
                <label htmlFor="sku-input" className="mb-2 block text-sm font-medium text-gray-700">
                  البحث برمز SKU
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="sku-input"
                    placeholder="أدخل SKU مثال: DRESS-XL-RED"
                    value={skuInput}
                    onChange={(event) => setSkuInput(event.target.value)}
                    className="h-11"
                  />
                  <Button type="submit" className="h-11">
                    <Search className="h-4 w-4 ml-2" />
                    بحث
                  </Button>
                </div>
              </form>

              <div className="w-full sm:w-72">
                <label htmlFor="link-filter" className="mb-2 block text-sm font-medium text-gray-700">
                  فلترة
                </label>
                <NativeSelect
                  id="link-filter"
                  value={filter}
                  onChange={(event) => {
                    setCurrentPage(1);
                    setFilter(event.target.value);
                  }}
                  className="h-11"
                >
                  <NativeSelectOption value={FILTER_ALL}>كل المنتجات</NativeSelectOption>
                  <NativeSelectOption value={FILTER_LINKED}>المرتبطة فقط</NativeSelectOption>
                  <NativeSelectOption value={FILTER_UNLINKED}>غير المرتبطة</NativeSelectOption>
                  {manufacturers.map((option) => (
                    <NativeSelectOption key={option.id} value={`${FACTORY_PREFIX}${option.id}`}>
                      مصنع: {option.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {(error || manufacturersError) && (
              <Alert variant="destructive">
                <AlertDescription>{error || manufacturersError}</AlertDescription>
              </Alert>
            )}

            {isUnlinkedMode && !allProductsLoading && catalogShortfall > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  أبلغت سلة عن {formatNumber(catalogTotal)} منتج، لكن واجهتها أعادت{' '}
                  {formatNumber(allProducts.length)} منتجاً مميّزاً فقط، لذلك تعذّر عرض{' '}
                  {formatNumber(catalogShortfall)} منتج. قد يكون بعضها بسبب أخطاء مؤقتة من سلة — اضغط
                  «تحديث» لإعادة المحاولة.
                </AlertDescription>
              </Alert>
            )}

            {!isLinkedMode && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  الصفحة {formatNumber(currentPage)} من {formatNumber(totalPages)}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => handlePageChange('prev')}
                    disabled={showGridLoading || currentPage === 1}
                  >
                    السابقة
                  </Button>
                  <Button
                    onClick={() => handlePageChange('next')}
                    disabled={showGridLoading || currentPage >= totalPages}
                  >
                    التالية
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <section>
          {showGridLoading ? (
            <LoadingState label="جاري التحميل..." />
          ) : cardItems.length === 0 ? (
            <EmptyState title="لا توجد منتجات مطابقة لهذا الفلتر حالياً" />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {visibleCardItems.map((item) => (
                <ProductLinkCard
                  key={item.productId}
                  item={item}
                  manufacturers={manufacturers}
                  saving={!!savingMap[item.productId]}
                  saveError={saveErrors[item.productId]}
                  onSave={(userId) => handleSave(item, userId)}
                />
              ))}
            </div>
          )}
        </section>
      </section>
    </AppPageShell>
  );
}

type ProductLinkCardProps = {
  item: ProductCardItem;
  manufacturers: ManufacturerUserOption[];
  saving: boolean;
  saveError?: string;
  onSave: (userId: string) => void;
};

function ProductLinkCard({ item, manufacturers, saving, saveError, onSave }: ProductLinkCardProps) {
  const isLinked = Boolean(item.manufacturerId);

  return (
    <Card className="overflow-hidden">
      <div className="relative flex aspect-square w-full items-center justify-center bg-slate-50">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        ) : (
          <span className="text-sm text-slate-400">لا صورة</span>
        )}
        {isLinked && (
          <Badge className="absolute right-2 top-2 bg-emerald-600 text-white hover:bg-emerald-600">
            مرتبط
          </Badge>
        )}
      </div>
      <CardContent className="space-y-2 p-3">
        <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-slate-900" title={item.name}>
          {item.name}
        </p>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate" title={item.sku ?? undefined}>
            {item.sku || '—'}
          </span>
          {item.priceAmount != null && (
            <span className="shrink-0">{formatCurrency(item.priceAmount, item.currency)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect
            value={item.manufacturerId}
            onChange={(event) => onSave(event.target.value)}
            disabled={saving}
            aria-label={`المصنع - ${item.name}`}
            className="h-9 text-sm"
          >
            <NativeSelectOption value="">— بدون مصنع —</NativeSelectOption>
            {manufacturers.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.name} (@{option.username})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {saving && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
        </div>
        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
      </CardContent>
    </Card>
  );
}
