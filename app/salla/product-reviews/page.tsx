'use client';

/* Salla image URLs are dynamic and already CDN-optimized. */
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Check,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  generateProductReviewDrafts,
  randomReviewPreset,
  type ProductReviewDraft,
} from '@/app/lib/product-review-presets';
import type { SallaPaginationMeta, SallaProductSummary } from '@/app/lib/salla-api';

const PRODUCTS_PER_PAGE = 24;
const REVIEW_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const REVIEW_IMAGE_MAX_DATA_LENGTH = 1_500_000;
const REVIEW_IMAGE_MAX_DIMENSION = 1200;

type ManagedReview = {
  id: string;
  productId: string;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  reviewerName: string;
  reviewerCity: string;
  body: string;
  reviewImageData?: string | null;
  rating: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

type ReviewPagination = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

type Feedback = { type: 'success' | 'error'; message: string } | null;

function productKey(product: SallaProductSummary) {
  return String(product.id);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date(value));
}

async function readResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}

async function prepareReviewImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('اختر صورة بصيغة JPG أو PNG أو WebP.');
  }
  if (file.size > REVIEW_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error('حجم الصورة الأصلية يجب ألا يتجاوز 8 ميجابايت.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
      element.src = objectUrl;
    });
    const scale = Math.min(1, REVIEW_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('تعذر تجهيز الصورة.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    let data = canvas.toDataURL('image/jpeg', 0.82);
    if (data.length > REVIEW_IMAGE_MAX_DATA_LENGTH) data = canvas.toDataURL('image/jpeg', 0.62);
    if (data.length > REVIEW_IMAGE_MAX_DATA_LENGTH) {
      throw new Error('الصورة كبيرة جداً بعد الضغط. اختر صورة أصغر.');
    }
    return data;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ReviewImageInput({
  value,
  onChange,
  disabled = false,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chooseImage = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      onChange(await prepareReviewImage(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تجهيز الصورة.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>صورة العميلة (اختيارية)</Label>
      <div className="flex flex-wrap items-center gap-3">
        {value && <img src={value} alt="معاينة صورة التقييم" className="size-24 rounded-lg border object-cover" />}
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          {value ? 'تغيير الصورة' : 'إضافة صورة'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={disabled || loading}
            onChange={(event) => {
              void chooseImage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {value && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
            <Trash2 className="size-4 text-destructive" /> حذف الصورة
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">JPG أو PNG أو WebP، ويتم ضغطها تلقائياً قبل الحفظ.</p>
    </div>
  );
}

export default function ProductReviewsPage() {
  const router = useRouter();
  const { status } = useSession();
  const [activeTab, setActiveTab] = useState('create');

  const [productQuery, setProductQuery] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [productPagination, setProductPagination] = useState<SallaPaginationMeta | null>(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<Record<string, SallaProductSummary>>({});
  const [reviewsPerProduct, setReviewsPerProduct] = useState(1);
  const [drafts, setDrafts] = useState<ProductReviewDraft[]>([]);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<Feedback>(null);

  const [reviews, setReviews] = useState<ManagedReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewQueryInput, setReviewQueryInput] = useState('');
  const [reviewQuery, setReviewQuery] = useState('');
  const [publishedFilter, setPublishedFilter] = useState('all');
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPagination, setReviewPagination] = useState<ReviewPagination | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [router, status]);

  const fetchProducts = useCallback(async (query: string, page: number) => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        perPage: String(PRODUCTS_PER_PAGE),
      });
      if (query.trim()) params.set('keyword', query.trim());
      const response = await fetch(`/api/salla/products?${params}`, { cache: 'no-store' });
      const data = await readResponse(response, 'تعذر تحميل منتجات سلة');
      setProducts(Array.isArray(data.products) ? data.products : []);
      setProductPagination(data.pagination ?? null);
    } catch (error) {
      setProducts([]);
      setProductPagination(null);
      setProductsError(error instanceof Error ? error.message : 'تعذر تحميل المنتجات');
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const timer = window.setTimeout(() => {
      setProductPage(1);
      fetchProducts(productQuery, 1);
    }, productQuery ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [fetchProducts, productQuery, status]);

  const goToProductPage = useCallback(
    (page: number) => {
      setProductPage(page);
      fetchProducts(productQuery, page);
    },
    [fetchProducts, productQuery]
  );

  const fetchReviews = useCallback(async () => {
    if (status !== 'authenticated') return;
    setReviewsLoading(true);
    setReviewsError(null);
    try {
      const params = new URLSearchParams({
        page: String(reviewPage),
        perPage: '50',
      });
      if (reviewQuery) params.set('q', reviewQuery);
      if (publishedFilter !== 'all') params.set('published', publishedFilter);
      const response = await fetch(`/api/salla/product-reviews?${params}`, { cache: 'no-store' });
      const data = await readResponse(response, 'تعذر تحميل التقييمات');
      setReviews(Array.isArray(data.reviews) ? data.reviews : []);
      setReviewPagination(data.pagination ?? null);
    } catch (error) {
      setReviews([]);
      setReviewPagination(null);
      setReviewsError(error instanceof Error ? error.message : 'تعذر تحميل التقييمات');
    } finally {
      setReviewsLoading(false);
    }
  }, [publishedFilter, reviewPage, reviewQuery, status]);

  useEffect(() => {
    if (activeTab === 'manage') fetchReviews();
  }, [activeTab, fetchReviews]);

  const selectedList = useMemo(() => Object.values(selectedProducts), [selectedProducts]);
  const groupedDrafts = useMemo(() => {
    const groups = new Map<string, ProductReviewDraft[]>();
    drafts.forEach((draft) => groups.set(draft.productId, [...(groups.get(draft.productId) ?? []), draft]));
    return Array.from(groups.values());
  }, [drafts]);

  const toggleProduct = useCallback((product: SallaProductSummary) => {
    const key = productKey(product);
    setSelectedProducts((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = product;
      return next;
    });
  }, []);

  const generateDrafts = useCallback(() => {
    setCreateFeedback(null);
    if (selectedList.length === 0) {
      setCreateFeedback({ type: 'error', message: 'اختر منتجاً واحداً على الأقل.' });
      return;
    }
    const generated = generateProductReviewDrafts(
      selectedList.map((product) => ({
        id: String(product.id),
        name: product.name,
        sku: product.sku ?? null,
        imageUrl: product.imageUrl ?? null,
      })),
      reviewsPerProduct
    );
    if (drafts.length + generated.length > 100) {
      setCreateFeedback({ type: 'error', message: 'يمكن حفظ 100 تقييم كحد أقصى في الدفعة الواحدة.' });
      return;
    }
    setDrafts((current) => [...current, ...generated]);
  }, [drafts.length, reviewsPerProduct, selectedList]);

  const updateDraft = useCallback((draftId: string, patch: Partial<ProductReviewDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.draftId === draftId ? { ...draft, ...patch } : draft)));
  }, []);

  const rerollDraft = useCallback((draftId: string) => {
    updateDraft(draftId, {
      reviewerName: randomReviewPreset('reviewerName'),
      reviewerCity: randomReviewPreset('reviewerCity'),
      body: randomReviewPreset('body'),
    });
  }, [updateDraft]);

  const saveDrafts = useCallback(async () => {
    setCreateFeedback(null);
    if (drafts.length === 0) {
      setCreateFeedback({ type: 'error', message: 'أنشئ تقييماً واحداً على الأقل قبل الحفظ.' });
      return;
    }
    if (drafts.some((draft) => !draft.reviewerName.trim() || !draft.reviewerCity.trim() || !draft.body.trim())) {
      setCreateFeedback({ type: 'error', message: 'أكمل الاسم والمدينة ونص التقييم في جميع الصفوف.' });
      return;
    }

    setSavingDrafts(true);
    try {
      const response = await fetch('/api/salla/product-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews: drafts }),
      });
      const data = await readResponse(response, 'تعذر حفظ التقييمات');
      setDrafts([]);
      setSelectedProducts({});
      setCreateFeedback({ type: 'success', message: `تم نشر ${data.count} تقييم بنجاح.` });
      setReviewPage(1);
      setActiveTab('manage');
    } catch (error) {
      setCreateFeedback({ type: 'error', message: error instanceof Error ? error.message : 'تعذر حفظ التقييمات' });
    } finally {
      setSavingDrafts(false);
    }
  }, [drafts]);

  const handleReviewSearch = (event: FormEvent) => {
    event.preventDefault();
    setReviewPage(1);
    setReviewQuery(reviewQueryInput.trim());
  };

  const updateManagedReview = useCallback((updated: ManagedReview) => {
    setReviews((current) => current.map((review) => (review.id === updated.id ? updated : review)));
  }, []);

  const removeManagedReview = useCallback((id: string) => {
    setReviews((current) => current.filter((review) => review.id !== id));
    setReviewPagination((current) => current ? { ...current, total: Math.max(0, current.total - 1) } : current);
  }, []);

  return (
    <AppPageShell
      title="تقييمات المنتجات"
      subtitle="إنشاء ونشر تقييمات متعددة لمنتجات مليحة بسرعة"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="create">إنشاء تقييمات</TabsTrigger>
          <TabsTrigger value="manage">إدارة المنشور</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>1. اختر المنتجات</CardTitle>
              <CardDescription>ابحث بالاسم أو SKU وحدد منتجاً واحداً أو عدة منتجات.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative max-w-xl">
                <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                  placeholder="ابحث باسم المنتج أو SKU..."
                  className="pr-9"
                />
              </div>

              {selectedList.length > 0 && (
                <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/30 p-3">
                  {selectedList.map((product) => (
                    <Badge key={productKey(product)} variant="secondary" className="gap-2 py-1.5">
                      {product.name}
                      <button type="button" onClick={() => toggleProduct(product)} aria-label={`إلغاء تحديد ${product.name}`}>
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {productsError && <Alert variant="destructive"><AlertDescription>{productsError}</AlertDescription></Alert>}
              {productsLoading ? (
                <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" /> جاري تحميل المنتجات...
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {products.map((product) => {
                    const selected = Boolean(selectedProducts[productKey(product)]);
                    return (
                      <button
                        type="button"
                        key={productKey(product)}
                        onClick={() => toggleProduct(product)}
                        aria-pressed={selected}
                        className={`flex min-h-24 items-center gap-3 rounded-xl border p-3 text-right transition ${
                          selected ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : 'hover:border-primary/40'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-4 shrink-0 place-items-center rounded border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}
                        >
                          {selected && <Check className="size-3" />}
                        </span>
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt="" className="size-16 rounded-lg object-cover" />
                        ) : (
                          <div className="size-16 rounded-lg bg-muted" />
                        )}
                        <span className="min-w-0">
                          <span className="line-clamp-2 block text-sm font-semibold">{product.name}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">SKU: {product.sku || '—'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!productsLoading && products.length === 0 && !productsError && (
                <p className="py-10 text-center text-sm text-muted-foreground">لا توجد منتجات مطابقة.</p>
              )}

              {productPagination && productPagination.totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <Button variant="outline" disabled={productPage <= 1} onClick={() => goToProductPage(productPage - 1)}>السابق</Button>
                  <span className="text-sm text-muted-foreground">{productPage} من {productPagination.totalPages}</span>
                  <Button variant="outline" disabled={productPage >= productPagination.totalPages} onClick={() => goToProductPage(productPage + 1)}>التالي</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. أنشئ المسودات</CardTitle>
              <CardDescription>سيتم تعبئة الاسم والمدينة والنص عشوائياً، ويمكن تعديل كل شيء قبل النشر.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="reviews-count">عدد التقييمات لكل منتج</Label>
                <Input
                  id="reviews-count"
                  type="number"
                  min={1}
                  max={10}
                  value={reviewsPerProduct}
                  onChange={(event) => setReviewsPerProduct(Math.min(10, Math.max(1, Number(event.target.value) || 1)))}
                  className="w-36"
                />
              </div>
              <Button onClick={generateDrafts} disabled={selectedList.length === 0}>
                <Sparkles className="size-4" />
                إنشاء لـ {selectedList.length || 0} منتج
              </Button>
              <span className="pb-2 text-sm text-muted-foreground">المسودات الحالية: {drafts.length} / 100</span>
            </CardContent>
          </Card>

          {groupedDrafts.map((group) => (
            <Card key={group[0].productId}>
              <CardHeader className="flex-row items-center gap-3">
                {group[0].productImageUrl && <img src={group[0].productImageUrl} alt="" className="size-14 rounded-lg object-cover" />}
                <div>
                  <CardTitle className="text-lg">{group[0].productName}</CardTitle>
                  <CardDescription>{group.length} تقييم · SKU: {group[0].productSku || '—'}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {group.map((draft, index) => (
                  <div key={draft.draftId} className="grid gap-3 rounded-xl border p-4 lg:grid-cols-[1fr_1fr_140px_auto]">
                    <div className="space-y-2">
                      <Label>الاسم</Label>
                      <div className="flex gap-2">
                        <Input value={draft.reviewerName} onChange={(event) => updateDraft(draft.draftId, { reviewerName: event.target.value })} />
                        <Button variant="outline" size="icon" title="اسم عشوائي" onClick={() => updateDraft(draft.draftId, { reviewerName: randomReviewPreset('reviewerName') })}>
                          <RefreshCcw className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>المدينة</Label>
                      <div className="flex gap-2">
                        <Input value={draft.reviewerCity} onChange={(event) => updateDraft(draft.draftId, { reviewerCity: event.target.value })} />
                        <Button variant="outline" size="icon" title="مدينة عشوائية" onClick={() => updateDraft(draft.draftId, { reviewerCity: randomReviewPreset('reviewerCity') })}>
                          <RefreshCcw className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>التقييم</Label>
                      <NativeSelect value={String(draft.rating)} onChange={(event) => updateDraft(draft.draftId, { rating: Number(event.target.value) })} className="w-full">
                        {[5, 4, 3, 2, 1].map((rating) => <NativeSelectOption key={rating} value={rating}>{rating} نجوم</NativeSelectOption>)}
                      </NativeSelect>
                    </div>
                    <div className="flex items-end gap-2">
                      <Button variant="outline" size="icon" title="إعادة تعبئة الصف" onClick={() => rerollDraft(draft.draftId)}><Sparkles className="size-4" /></Button>
                      <Button variant="ghost" size="icon" title="حذف المسودة" onClick={() => setDrafts((current) => current.filter((item) => item.draftId !== draft.draftId))}><Trash2 className="size-4 text-destructive" /></Button>
                    </div>
                    <div className="space-y-2 lg:col-span-4">
                      <div className="flex items-center justify-between">
                        <Label>نص التقييم {index + 1}</Label>
                        <Button variant="ghost" size="sm" onClick={() => updateDraft(draft.draftId, { body: randomReviewPreset('body') })}><RefreshCcw className="size-3.5" /> نص آخر</Button>
                      </div>
                      <Textarea value={draft.body} maxLength={1000} onChange={(event) => updateDraft(draft.draftId, { body: event.target.value })} />
                    </div>
                    <div className="lg:col-span-4">
                      <ReviewImageInput
                        value={draft.reviewImageData}
                        onChange={(reviewImageData) => updateDraft(draft.draftId, { reviewImageData })}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          {createFeedback && (
            <Alert variant={createFeedback.type === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{createFeedback.message}</AlertDescription>
            </Alert>
          )}

          {drafts.length > 0 && (
            <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
              <span className="text-sm font-medium">جاهز لنشر {drafts.length} تقييم</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setDrafts([])}>مسح المسودات</Button>
                <Button onClick={saveDrafts} disabled={savingDrafts}>
                  {savingDrafts ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  نشر الكل
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="manage" className="space-y-5 pt-4">
          {createFeedback?.type === 'success' && <Alert><AlertDescription>{createFeedback.message}</AlertDescription></Alert>}
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <form onSubmit={handleReviewSearch} className="flex flex-1 gap-2">
                <Input value={reviewQueryInput} onChange={(event) => setReviewQueryInput(event.target.value)} placeholder="ابحث بالمنتج أو SKU أو الاسم أو المدينة..." className="max-w-xl" />
                <Button type="submit" variant="outline"><Search className="size-4" /> بحث</Button>
              </form>
              <NativeSelect
                value={publishedFilter}
                onChange={(event) => { setPublishedFilter(event.target.value); setReviewPage(1); }}
                className="w-44"
              >
                <NativeSelectOption value="all">كل الحالات</NativeSelectOption>
                <NativeSelectOption value="true">المنشور فقط</NativeSelectOption>
                <NativeSelectOption value="false">المخفي فقط</NativeSelectOption>
              </NativeSelect>
              <Button variant="outline" onClick={fetchReviews}><RefreshCcw className="size-4" /> تحديث</Button>
            </CardContent>
          </Card>

          {reviewsError && <Alert variant="destructive"><AlertDescription>{reviewsError}</AlertDescription></Alert>}
          {reviewsLoading ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="size-5 animate-spin" /> جاري تحميل التقييمات...</div>
          ) : reviews.length === 0 ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">لا توجد تقييمات مطابقة.</CardContent></Card>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <ManagedReviewCard
                  key={review.id}
                  review={review}
                  onUpdated={updateManagedReview}
                  onDeleted={removeManagedReview}
                />
              ))}
            </div>
          )}

          {reviewPagination && reviewPagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" disabled={reviewPage <= 1} onClick={() => setReviewPage((page) => page - 1)}>السابق</Button>
              <span className="text-sm text-muted-foreground">{reviewPage} من {reviewPagination.totalPages} · {reviewPagination.total} تقييم</span>
              <Button variant="outline" disabled={reviewPage >= reviewPagination.totalPages} onClick={() => setReviewPage((page) => page + 1)}>التالي</Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AppPageShell>
  );
}

function ManagedReviewCard({
  review,
  onUpdated,
  onDeleted,
}: {
  review: ManagedReview;
  onUpdated: (review: ManagedReview) => void;
  onDeleted: (id: string) => void;
}) {
  const [reviewerName, setReviewerName] = useState(review.reviewerName);
  const [reviewerCity, setReviewerCity] = useState(review.reviewerCity);
  const [body, setBody] = useState(review.body);
  const [reviewImageData, setReviewImageData] = useState(review.reviewImageData ?? null);
  const [rating, setRating] = useState(review.rating);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchReview = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/salla/product-reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await readResponse(response, 'تعذر تحديث التقييم');
      onUpdated(data.review);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تحديث التقييم');
    } finally {
      setBusy(false);
    }
  };

  const save = () => patchReview({ reviewerName, reviewerCity, body, reviewImageData, rating });

  const remove = async () => {
    if (!window.confirm('سيتم حذف هذا التقييم نهائياً. هل تريد المتابعة؟')) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/salla/product-reviews/${review.id}`, { method: 'DELETE' });
      await readResponse(response, 'تعذر حذف التقييم');
      onDeleted(review.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حذف التقييم');
      setBusy(false);
    }
  };

  return (
    <Card className={!review.isPublished ? 'opacity-75' : ''}>
      <CardHeader className="flex-row items-start gap-3">
        {review.productImageUrl ? <img src={review.productImageUrl} alt="" className="size-16 rounded-lg object-cover" /> : <div className="size-16 rounded-lg bg-muted" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">{review.productName}</CardTitle>
            <Badge variant={review.isPublished ? 'default' : 'secondary'}>{review.isPublished ? 'منشور' : 'مخفي'}</Badge>
          </div>
          <CardDescription>SKU: {review.productSku || '—'} · أضيف {formatDate(review.createdAt)}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px]">
          <div className="space-y-2"><Label>الاسم</Label><Input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} /></div>
          <div className="space-y-2"><Label>المدينة</Label><Input value={reviewerCity} onChange={(event) => setReviewerCity(event.target.value)} /></div>
          <div className="space-y-2"><Label>التقييم</Label><NativeSelect value={String(rating)} onChange={(event) => setRating(Number(event.target.value))} className="w-full">{[5, 4, 3, 2, 1].map((value) => <NativeSelectOption key={value} value={value}>{value} نجوم</NativeSelectOption>)}</NativeSelect></div>
        </div>
        <div className="space-y-2"><Label>نص التقييم</Label><Textarea value={body} maxLength={1000} onChange={(event) => setBody(event.target.value)} /></div>
        <ReviewImageInput value={reviewImageData} onChange={setReviewImageData} disabled={busy} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="outline" onClick={() => patchReview({ isPublished: !review.isPublished })} disabled={busy}>
            {review.isPublished ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {review.isPublished ? 'إخفاء' : 'إعادة النشر'}
          </Button>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={remove} disabled={busy}><Trash2 className="size-4" /> حذف</Button>
            <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ التعديلات</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
