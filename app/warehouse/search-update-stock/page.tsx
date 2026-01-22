'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Barcode,
  CheckCircle2,
  ClipboardList,
  Info,
  Loader2,
  MapPin,
  RefreshCcw,
  Search,
  Target,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type StockSearchResult = {
  product: {
    id: number;
    name: string;
    sku?: string | null;
    imageUrl?: string | null;
    lastUpdatedAt?: string | null;
    availableQuantity?: number | null;
    location?: {
      sku: string;
      location: string;
      updatedAt: string;
      updatedBy?: string | null;
    } | null;
  };
  variations: Array<{
    id: string;
    name: string;
    sku?: string;
    barcode?: string | null;
    sallaStock: number;
    pendingQuantity: number;
  }>;
};

type UpdateFeedback = { type: 'success' | 'error'; message: string };

type StockUpdateMode = 'override' | 'increment';

const stockModeOptions: Array<{
  value: StockUpdateMode;
  label: string;
  description: string;
}> = [
  {
    value: 'override',
    label: 'تحديث كلي (Override)',
    description: 'يضبط مخزون سلة على العدد الفعلي بعد خصم الطلبات الجارية.',
  },
  {
    value: 'increment',
    label: 'زيادة تدريجية (Increment)',
    description: 'يزيد مخزون سلة بمقدار الكمية المدخلة دون المساس بالمخزون الحالي.',
  },
];

const inputClasses =
  'w-full rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

async function parseJsonResponse(response: Response, fallbackMessage: string) {
  const clone = response.clone();
  try {
    return await response.json();
  } catch {
    const text = await clone.text();
    if (text.trim().startsWith('<!DOCTYPE')) {
      throw new Error(`${fallbackMessage}. يرجى التأكد من تسجيل الدخول ثم إعادة المحاولة.`);
    }
    if (text.trim()) {
      throw new Error(text.trim());
    }
    throw new Error(fallbackMessage);
  }
}

function formatDateLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ar-SA', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: 'numeric',
  }).format(date);
}

function normalizeSku(value?: string | null) {
  if (!value) return '';
  return value.trim().toUpperCase();
}

export default function SearchAndUpdateStockPage() {
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [countInputs, setCountInputs] = useState<Record<string, string>>({});
  const [locationInput, setLocationInput] = useState('');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateFeedback, setUpdateFeedback] = useState<UpdateFeedback | null>(null);
  const [overlayMessage, setOverlayMessage] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [stockMode, setStockMode] = useState<StockUpdateMode>('override');

  const activeResult = results[selectedIndex] ?? null;
  const isIncrementMode = stockMode === 'increment';

  useEffect(() => {
    if (activeResult?.product.location) {
      setLocationInput(activeResult.product.location.location);
    } else {
      setLocationInput('');
    }
    setCountInputs({});
    setUpdateFeedback(null);
  }, [activeResult?.product.id]);

  useEffect(() => {
    setCountInputs({});
    setUpdateFeedback(null);
  }, [stockMode]);

  const handleSearch = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      const trimmed = searchInput.trim();
      if (!trimmed) {
        setSearchError('يرجى إدخال رمز SKU أو الباركود للبحث.');
        return;
      }

      setSearching(true);
      setSearchError(null);
      setUpdateFeedback(null);

      try {
        const response = await fetch('/api/warehouse/stock-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku: trimmed }),
        });
        const data = await parseJsonResponse(response, 'تعذر تحميل بيانات المنتج من الخادم');
        if (!response.ok || data?.error) {
          throw new Error(data?.error || 'تعذر العثور على منتج مطابق');
        }
        const list: StockSearchResult[] = Array.isArray(data?.results) ? data.results : [];
        if (list.length === 0) {
          setSearchError('لا توجد منتجات مطابقة لرمز البحث المدخل.');
        }
        setResults(list);
        setSelectedIndex(0);
        setLastQuery(trimmed);
      } catch (error) {
        setResults([]);
        setSearchError(error instanceof Error ? error.message : 'حدث خطأ غير متوقع أثناء البحث.');
      } finally {
        setSearching(false);
      }
    },
    [searchInput]
  );

  const handleVariantInputChange = (variantId: string, value: string) => {
    setCountInputs((prev) => ({
      ...prev,
      [variantId]: value,
    }));
  };

  const handleResetCounts = () => {
    setCountInputs({});
    setUpdateFeedback(null);
  };

  const derivedEntries = useMemo(() => {
    if (!activeResult) {
      return {};
    }
    return activeResult.variations.reduce<Record<
      string,
      { counted: number | null; pending: number; derived: number | null; delta: number }
    >>((acc, variant) => {
      const rawValue = countInputs[variant.id];
      if (rawValue == null || rawValue.trim() === '') {
        acc[variant.id] = {
          counted: null,
          pending: variant.pendingQuantity,
          derived: null,
          delta: 0,
        };
        return acc;
      }
      const parsed = Number.parseFloat(rawValue);
      if (!Number.isFinite(parsed)) {
        acc[variant.id] = {
          counted: null,
          pending: variant.pendingQuantity,
          derived: null,
          delta: 0,
        };
        return acc;
      }
      const counted = Math.max(0, Math.round(parsed));

      if (stockMode === 'increment') {
        if (counted === 0) {
          acc[variant.id] = {
            counted,
            pending: variant.pendingQuantity,
            derived: null,
            delta: 0,
          };
          return acc;
        }
        const derived = variant.sallaStock + counted;
        acc[variant.id] = {
          counted,
          pending: variant.pendingQuantity,
          derived,
          delta: counted,
        };
        return acc;
      }

      const derived = Math.max(0, counted - variant.pendingQuantity);
      const delta = derived - variant.sallaStock;
      acc[variant.id] = {
        counted,
        pending: variant.pendingQuantity,
        derived,
        delta,
      };
      return acc;
    }, {});
  }, [activeResult, countInputs, stockMode]);

  const variantsNeedingUpdate = useMemo(() => {
    if (!activeResult) return 0;
    return activeResult.variations.reduce((total, variant) => {
      const entry = derivedEntries[variant.id];
      if (!entry || entry.derived === null) {
        return total;
      }
      return entry.delta !== 0 ? total + 1 : total;
    }, 0);
  }, [activeResult, derivedEntries]);

  const locationChanged = useMemo(() => {
    if (!activeResult) return false;
    const currentLocation = activeResult.product.location?.location || '';
    return currentLocation.trim() !== locationInput.trim() && Boolean(locationInput.trim());
  }, [activeResult, locationInput]);

  const hasUpdateableData = variantsNeedingUpdate > 0 || locationChanged;

  const refreshActiveProduct = useCallback(async () => {
    if (!lastQuery) {
      return;
    }
    try {
      const response = await fetch('/api/warehouse/stock-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: lastQuery }),
      });
      const data = await parseJsonResponse(response, 'تعذر تحديث عرض المنتج بعد الحفظ');
      if (!response.ok || data?.error) {
        return;
      }
      const list: StockSearchResult[] = Array.isArray(data?.results) ? data.results : [];
      setResults(list);
      setSelectedIndex(0);
    } catch {
      // ignore refresh errors
    }
  }, [lastQuery]);

  const handleUpdate = useCallback(async () => {
    if (!activeResult) {
      return;
    }
    const adjustments: Array<{ identifer_type: string; identifer: string; quantity: number; mode: 'increment' | 'decrement' }> = [];

    activeResult.variations.forEach((variant) => {
      const entry = derivedEntries[variant.id];
      if (!entry || entry.derived === null) {
        return;
      }
      if (entry.delta === 0) {
        return;
      }
      const variationId = variant.id?.toString().trim();
      if (!variationId) {
        return;
      }
      adjustments.push({
        identifer_type: 'variant_id',
        identifer: variationId,
        quantity: Math.abs(entry.delta),
        mode: entry.delta > 0 ? 'increment' : 'decrement',
      });
    });

    if (adjustments.length === 0 && !locationChanged) {
      setUpdateFeedback({
        type: 'error',
        message: 'لا توجد تغييرات على الكميات أو موقع التخزين ليتم حفظها.',
      });
      return;
    }

    setUpdateLoading(true);
    setOverlayMessage(isIncrementMode ? 'جاري زيادة المخزون...' : 'جاري تحديث المخزون...');
    setUpdateFeedback(null);

    try {
      if (adjustments.length > 0) {
        const response = await fetch('/api/salla/products/quantities/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ products: adjustments }),
        });
        const data = await parseJsonResponse(
          response,
          'تعذر تحديث الكميات في سلة، حاول مرة أخرى.'
        );
        if (!response.ok || data?.error || data?.success === false) {
          throw new Error(data?.error || 'فشل تحديث كميات سلة.');
        }
      }

      if (locationChanged) {
        const parentSku = activeResult.product.sku?.trim();
        if (parentSku) {
          const response = await fetch('/api/product-locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sku: parentSku,
              location: locationInput.trim(),
              productName: activeResult.product.name,
              productId: activeResult.product.id.toString(),
            }),
          });
          const data = await parseJsonResponse(
            response,
            'تعذر حفظ موقع التخزين، حاول مرة أخرى.'
          );
          if (!response.ok || data?.error) {
            throw new Error(data?.error || 'لم يتم حفظ موقع التخزين.');
          }
        }
      }

      const successMessage = isIncrementMode ? 'تمت زيادة المخزون بنجاح.' : 'تم تحديث الكميات بنجاح.';
      setUpdateFeedback({
        type: 'success',
        message: locationChanged ? `${successMessage} وتم حفظ موقع التخزين.` : successMessage,
      });
      setCountInputs({});
      await refreshActiveProduct();
    } catch (error) {
      setUpdateFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'حدث خطأ أثناء تنفيذ التحديث.',
      });
    } finally {
      setOverlayMessage(null);
      setUpdateLoading(false);
    }
  }, [activeResult, derivedEntries, locationChanged, locationInput, refreshActiveProduct, isIncrementMode]);

  const handleUpdateRequest = useCallback(() => {
    if (!hasUpdateableData || updateLoading) {
      return;
    }
    setConfirmingUpdate(true);
  }, [hasUpdateableData, updateLoading]);

  const handleCancelConfirmation = useCallback(() => {
    setConfirmingUpdate(false);
  }, []);

  const handleConfirmUpdate = useCallback(() => {
    setConfirmingUpdate(false);
    void handleUpdate();
  }, [handleUpdate]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppNavbar
        title="تحديث المخزون"
        subtitle="بحث SKU وتعديل الكميات"
        collapseOnMobile
      />

      <main className="mx-auto mt-6 w-full max-w-6xl px-4 pb-40">
        <Card className="border-0 bg-white/70 shadow-2xl shadow-indigo-100/60">
          <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-4">
              <form onSubmit={handleSearch} className="flex flex-1 flex-wrap gap-4">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="أدخل الباركود أو رمز SKU"
                    className="h-12 rounded-2xl border border-slate-200 px-10 text-sm font-medium"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={searching}
                  className="h-12 rounded-2xl bg-indigo-600 px-6 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-500 disabled:opacity-70"
                >
                  {searching ? (
                    <>
                      <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                      جاري البحث
                    </>
                  ) : (
                    <>
                      <Search className="ms-2 h-4 w-4" />
                      بحث
                    </>
                  )}
                </Button>
              </form>
              <Link
                href="/warehouse-locations"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/70 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-indigo-200 hover:text-indigo-600"
              >
                <ClipboardList className="h-4 w-4" />
                إدارة المواقع
              </Link>
            </div>
            <div className="rounded-3xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">اختيار نوع تعديل المخزون</p>
                  <p className="text-xs text-slate-500">
                    حدد ما إذا كنت ترغب بتحديث الكميات الفعلية أو زيادة المخزون قبل البحث.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  {stockModeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setStockMode(option.value)}
                      aria-pressed={stockMode === option.value}
                      className={cn(
                        'flex-1 rounded-2xl border px-4 py-3 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 sm:flex-none',
                        stockMode === option.value
                          ? 'border-indigo-400 bg-white text-indigo-600 shadow-sm shadow-indigo-100'
                          : 'border-transparent bg-transparent text-slate-500 hover:border-slate-200 hover:bg-white/50'
                      )}
                    >
                      <p className="text-sm font-semibold">{option.label}</p>
                      <p className="text-[11px] text-slate-400">{option.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {searchError && (
              <div className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{searchError}</p>
              </div>
            )}
          </div>
        </Card>

        {results.length > 0 && (
          <section className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-100 bg-white/80 p-5 shadow-inner shadow-slate-100">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                  <Search className="h-4 w-4" />
                  نتائج البحث
                </div>
                <p className="mt-1 text-xs text-slate-400">اختر المنتج المطلوب تعديل كمياته</p>
              </div>
              <div className="space-y-3">
                {results.map((result, index) => {
                  const locationLabel = result.product.location?.location || null;
                  return (
                    <button
                      key={`${result.product.id}-${index}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className={cn(
                        'w-full rounded-2xl border px-4 py-3 text-right transition hover:border-indigo-200 hover:bg-indigo-50/40',
                        selectedIndex === index
                          ? 'border-indigo-400 bg-indigo-50/80 text-indigo-700 shadow-lg shadow-indigo-100'
                          : 'border-slate-200 bg-white text-slate-700'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{result.product.name}</p>
                          {result.product.sku && (
                            <p className="text-xs text-slate-400">SKU: {result.product.sku}</p>
                          )}
                        </div>
                        {locationLabel && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/5 px-2 py-1 text-[10px] font-semibold text-slate-500">
                            <MapPin className="h-3 w-3" />
                            {locationLabel}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-6">
              {activeResult && (
                <Card className="border-0 bg-white/90 shadow-xl shadow-indigo-100/60">
                  <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
                    <div className="w-full max-w-[180px]">
                      {activeResult.product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeResult.product.imageUrl}
                          alt={activeResult.product.name}
                          className="h-36 w-full rounded-2xl border border-slate-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-36 w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
                          لا صورة
                        </div>
                      )}
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold text-slate-900">
                          {activeResult.product.name}
                        </h2>
                        {activeResult.product.sku && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50/80 px-3 py-1 text-xs font-semibold text-indigo-600">
                            <Barcode className="h-3.5 w-3.5" />
                            {activeResult.product.sku}
                          </span>
                        )}
                      </div>
                      {activeResult.product.lastUpdatedAt && (
                        <p className="text-xs text-slate-400">
                          آخر جلب من سلة: {formatDateLabel(activeResult.product.lastUpdatedAt)}
                        </p>
                      )}
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                          <p className="text-xs font-medium text-slate-500">موقع التخزين</p>
                          <div className="mt-2 flex items-center gap-4">
                            <MapPin className="h-5 w-5 text-slate-400" />
                            <input
                              value={locationInput}
                              onChange={(event) => setLocationInput(event.target.value.toUpperCase())}
                              placeholder="مثال: A3-B2"
                              className={inputClasses}
                            />
                          </div>
                          {activeResult.product.location?.updatedAt && (
                            <p className="mt-1 text-[11px] text-slate-400">
                              آخر تحديث: {formatDateLabel(activeResult.product.location.updatedAt)}
                            </p>
                          )}
                        </div>
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                          <p className="text-xs font-medium text-slate-500">ملاحظات سريعة</p>
                          <ul className="mt-2 space-y-1 text-xs text-slate-500">
                            <li className="flex items-center gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              {isIncrementMode
                                ? 'أدخل كمية الزيادة لكل متغير'
                                : 'أكتب العدد الفعلي داخل الصندوق لكل متغير'}
                            </li>
                            <li className="flex items-center gap-2">
                              <Activity className="h-3.5 w-3.5 text-indigo-500" />
                              النظام يخصم الطلبات الجاري تجهيزها تلقائياً
                            </li>
                            <li className="flex items-center gap-2">
                              <Info className="h-3.5 w-3.5 text-slate-400" />
                              استخدم زر التحديث بالأسفل لإرسال الكميات لسلة
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {updateFeedback && (
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm',
                    updateFeedback.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  )}
                >
                  {updateFeedback.type === 'success' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <p>{updateFeedback.message}</p>
                </div>
              )}

              {activeResult && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">
                        المتغيرات ({activeResult.variations.length})
                      </p>
                      <p className="text-xs text-slate-400">
                        {isIncrementMode
                          ? 'أدخل كمية الزيادة لكل متغير ليتم إرسالها كزيادة على المخزون الحالي.'
                          : 'أدخل العدد الفعلي بعد الجرد ليتم احتساب المخزون المتاح في سلة.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleResetCounts}
                      className="rounded-2xl border border-slate-200 text-slate-600 hover:border-slate-300"
                    >
                      <RefreshCcw className="ms-2 h-4 w-4" />
                      مسح الحقول
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {activeResult.variations.map((variant) => {
                      const entry = derivedEntries[variant.id];
                      const showDerived = entry?.derived != null;
                      const delta = entry?.delta ?? 0;
                      return (
                        <div
                          key={variant.id}
                          className="rounded-3xl border border-slate-100 bg-white/90 p-4 shadow shadow-slate-100 transition hover:border-indigo-100 hover:shadow-indigo-50"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{variant.name}</p>
                              {variant.sku && (
                                <p className="text-xs text-slate-400">SKU: {variant.sku}</p>
                              )}
                              {variant.barcode && (
                                <p className="text-xs text-slate-400">باركود: {variant.barcode}</p>
                              )}
                            </div>
                            <div className="rounded-2xl bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
                              مخزون سلة الحالي: {variant.sallaStock}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-4 md:grid-cols-3">
                            <div>
                              <p className="text-xs font-semibold text-slate-500">
                                {isIncrementMode ? 'الكمية المراد إضافتها' : 'الكمية الفعلية (المخزون)'}
                              </p>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={countInputs[variant.id] ?? ''}
                                onChange={(event) =>
                                  handleVariantInputChange(variant.id, event.target.value)
                                }
                                placeholder={
                                  isIncrementMode
                                    ? 'أدخل عدد القطع المراد إضافتها'
                                    : 'أدخل العدد بعد الجرد'
                                }
                                className={inputClasses}
                              />
                            </div>
                            <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-700">
                              <p className="text-xs font-semibold text-amber-600">طلبات جارية</p>
                              <p className="mt-1 text-lg font-bold">{variant.pendingQuantity}</p>
                              <p className="text-[11px] text-amber-600/80">
                                الطلبات المعينة قيد التحضير يتم خصمها تلقائياً
                              </p>
                            </div>
                            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                              <p className="text-xs font-semibold text-indigo-600">
                                {isIncrementMode
                                  ? 'المخزون بعد تطبيق الزيادة'
                                  : 'الكمية التي سترسل إلى سلة'}
                              </p>
                              {showDerived ? (
                                <div className="mt-1 flex flex-col gap-1">
                                  <div className="flex items-center gap-3">
                                    <div className="text-2xl font-bold text-indigo-700">
                                      {entry?.derived}
                                    </div>
                                    {delta !== 0 && (
                                      <span
                                        className={cn(
                                          'rounded-full px-2 py-0.5 text-xs font-semibold',
                                          delta > 0
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-rose-100 text-rose-700'
                                        )}
                                      >
                                        {delta > 0 ? '+' : '-'}
                                        {Math.abs(delta)}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-500">
                                    {isIncrementMode
                                      ? `زيادة متوقعة بمقدار ${entry?.counted ?? 0} قطعة على المخزون الحالي.`
                                      : 'القيمة بعد خصم الطلبات الجارية من العدد الفعلي.'}
                                  </p>
                                </div>
                              ) : (
                                <p className="mt-1 text-sm text-indigo-500">
                                  {isIncrementMode
                                    ? 'أدخل كمية الزيادة لعرض أثرها على المخزون.'
                                    : 'أدخل العدد الفعلي لحساب الكمية الجديدة.'}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {activeResult && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-slate-200/80 bg-white/90 px-4 py-4 shadow-[0_-10px_30px_rgba(63,63,90,0.12)]">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <Target className="h-5 w-5 text-indigo-500" />
              <div>
                {variantsNeedingUpdate > 0 ? (
                  <p>
                    سيتم تعديل{' '}
                    <span className="font-semibold text-indigo-600">{variantsNeedingUpdate}</span>{' '}
                    متغير/ات بناءً على الإدخالات الأخيرة.
                  </p>
                ) : (
                  <p>أدخل الكميات الفعلية أو حدّث موقع التخزين قبل الإرسال.</p>
                )}
                {locationChanged && (
                  <p className="text-xs text-slate-400">سيتم أيضاً حفظ موقع التخزين الجديد.</p>
                )}
                <p className="text-xs text-slate-400">
                  نمط التحديث الحالي:{' '}
                  <span className="font-semibold text-slate-600">
                    {isIncrementMode ? 'زيادة تدريجية (Increment)' : 'تحديث كلي (Override)'}
                  </span>
                </p>
              </div>
            </div>
            <Button
              type="button"
              disabled={!hasUpdateableData || updateLoading}
              onClick={handleUpdateRequest}
              className="h-12 rounded-2xl bg-indigo-600 px-8 text-sm font-semibold text-white shadow-lg shadow-indigo-400/40 hover:bg-indigo-500 disabled:opacity-70"
            >
              {updateLoading ? (
                <>
                  <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                  جاري التحديث
                </>
              ) : (
                <>
                  <RefreshCcw className="ms-2 h-4 w-4" />
                  تحديث المخزون
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {confirmingUpdate && activeResult && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-slate-100 bg-white/95 p-6 text-right shadow-2xl shadow-indigo-100">
            <div className="flex items-center gap-2 text-slate-600">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <p className="text-sm font-semibold text-slate-800">تأكيد تحديث المخزون</p>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              سيتم إرسال التغييرات التالية إلى سلة. يرجى التأكد من صحة البيانات قبل الإكمال.
            </p>
              <div className="mt-4 space-y-2 rounded-2xl bg-slate-50/80 p-4 text-sm text-slate-600">
                {variantsNeedingUpdate > 0 && (
                  <p>
                    تعديل{' '}
                    <span className="font-semibold text-indigo-600">{variantsNeedingUpdate}</span>{' '}
                    متغير/متغيرات حسب العد الفعلي.
                  </p>
                )}
                {locationChanged && (
                  <p>
                    تحديث موقع التخزين إلى{' '}
                    <span className="font-semibold text-slate-900">{locationInput.trim()}</span>.
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  النمط المختار:{' '}
                  {isIncrementMode ? 'زيادة المخزون تدريجياً (Increment).' : 'تحديث الكمية الفعلية (Override).'}
                </p>
              </div>
            <p className="mt-3 text-xs text-slate-400">لا يمكن التراجع عن هذه العملية بعد الإرسال.</p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelConfirmation}
                className="h-11 rounded-2xl px-6 text-sm font-semibold text-slate-600"
                disabled={updateLoading}
              >
                تراجع
              </Button>
              <Button
                type="button"
                onClick={handleConfirmUpdate}
                disabled={updateLoading}
                className="h-11 rounded-2xl bg-indigo-600 px-6 text-sm font-semibold text-white shadow-lg shadow-indigo-400/40 hover:bg-indigo-500 disabled:opacity-70"
              >
                تأكيد التحديث
              </Button>
            </div>
          </div>
        </div>
      )}

      {overlayMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur">
          <div className="rounded-3xl border border-slate-100 bg-white/90 px-8 py-6 text-center shadow-2xl shadow-indigo-100">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-indigo-600" />
            <p className="text-sm font-semibold text-slate-700">{overlayMessage}</p>
            <p className="mt-1 text-xs text-slate-400">يرجى عدم إغلاق الصفحة حتى الانتهاء</p>
          </div>
        </div>
      )}
    </div>
  );
}
