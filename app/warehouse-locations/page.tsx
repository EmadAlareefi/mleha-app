'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  ClipboardList,
  Loader2,
  MapPin,
  RefreshCcw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type ProductLocation = {
  id: string;
  sku: string;
  productId?: string | null;
  productName?: string | null;
  location: string;
  notes?: string | null;
  updatedAt: string;
  createdAt: string;
  updatedBy?: string | null;
};

async function parseJsonResponse(response: Response, fallbackMessage: string) {
  const cloned = response.clone();
  try {
    return await response.json();
  } catch {
    const text = await cloned.text();
    const trimmed = text.trim();
    if (trimmed.startsWith('<!DOCTYPE')) {
      throw new Error(`${fallbackMessage}. يرجى التأكد من تسجيل الدخول ثم إعادة المحاولة.`);
    }
    if (trimmed) {
      throw new Error(trimmed);
    }
    throw new Error(fallbackMessage);
  }
}

export default function WarehouseLocationsPage() {
  const { data: session } = useSession();
  const [productLocations, setProductLocations] = useState<ProductLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState(150);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<ProductLocation | null>(null);
  const [formStatus, setFormStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [formData, setFormData] = useState({
    sku: '',
    productName: '',
    productId: '',
    location: '',
    notes: '',
  });

  const isAdmin = useMemo(() => {
    const user = session?.user as any;
    if (!user) return false;
    if (user.role === 'admin') return true;
    const roles = Array.isArray(user.roles) ? user.roles : [];
    return roles.includes('admin');
  }, [session]);

  const limitOptions = [50, 150, 300, 500];

  const fetchProductLocations = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSchemaMissing(false);

    try {
      const params = new URLSearchParams();
      if (searchQuery) {
        params.set('q', searchQuery);
      }
      params.set('limit', String(limit));

      const response = await fetch(`/api/product-locations?${params.toString()}`);
      const data = await parseJsonResponse(
        response,
        'تعذر قراءة بيانات مواقع التخزين من الخادم'
      );

      if (!response.ok) {
        if (data?.missingProductLocationTable) {
          setSchemaMissing(true);
        }
        throw new Error(data?.error || 'تعذر تحميل مواقع التخزين');
      }

      setProductLocations(Array.isArray(data.productLocations) ? data.productLocations : []);
      setLastRefreshed(new Date());
    } catch (err) {
      setProductLocations([]);
      setError(err instanceof Error ? err.message : 'تعذر تحميل مواقع التخزين');
    } finally {
      setLoading(false);
    }
  }, [limit, searchQuery]);

  useEffect(() => {
    fetchProductLocations();
  }, [fetchProductLocations]);

  const handleSearchSubmit = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      setSearchQuery(searchInput.trim());
    },
    [searchInput]
  );

  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
  };

  const resetForm = () => {
    setSelectedLocation(null);
    setFormData({
      sku: '',
      productName: '',
      productId: '',
      location: '',
      notes: '',
    });
    setFormStatus(null);
  };

  const lastUpdatedLabel = useMemo(() => {
    if (!lastRefreshed) return null;
    return new Intl.DateTimeFormat('ar-SA', {
      hour: 'numeric',
      minute: 'numeric',
    }).format(lastRefreshed);
  }, [lastRefreshed]);

  const locationSummary = useMemo(() => {
    const counter = new Map<string, number>();
    productLocations.forEach((record) => {
      const label = record.location || 'غير محدد';
      counter.set(label, (counter.get(label) || 0) + 1);
    });
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [productLocations]);

  const handleRowSelect = (record: ProductLocation) => {
    setSelectedLocation(record);
    setFormData({
      sku: record.sku || '',
      productName: record.productName || '',
      productId: record.productId || '',
      location: record.location || '',
      notes: record.notes || '',
    });
    setFormStatus(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormStatus(null);

    const sku = formData.sku.trim().toUpperCase();
    const location = formData.location.trim().toUpperCase();

    if (!sku || !location) {
      setFormStatus({ type: 'error', text: 'رمز SKU وموقع التخزين حقول إلزامية' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        sku,
        location,
        productName: formData.productName.trim() || undefined,
        productId: formData.productId.trim() || undefined,
        notes: formData.notes.trim() || undefined,
      };

      const response = await fetch('/api/product-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonResponse(response, 'تعذر قراءة استجابة حفظ الموقع');

      if (!response.ok) {
        throw new Error(data?.error || 'تعذر حفظ موقع المنتج');
      }

      setFormStatus({
        type: 'success',
        text:
          data?.action === 'updated'
            ? 'تم تحديث موقع المنتج بنجاح'
            : 'تم تسجيل موقع المنتج بنجاح',
      });
      resetForm();
      await fetchProductLocations();
    } catch (err) {
      setFormStatus({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ موقع المنتج',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedLocation) return;
    if (!isAdmin) {
      setFormStatus({ type: 'error', text: 'فقط المسؤول يمكنه حذف السجلات' });
      return;
    }
    const confirmDelete = window.confirm(
      `هل أنت متأكد من حذف موقع SKU ${selectedLocation.sku}? لا يمكن التراجع عن هذا الإجراء.`
    );
    if (!confirmDelete) return;

    setSaving(true);
    try {
      const response = await fetch('/api/product-locations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: selectedLocation.sku }),
      });
      const data = await parseJsonResponse(response, 'تعذر قراءة استجابة حذف الموقع');

      if (!response.ok) {
        throw new Error(data?.error || 'تعذر حذف موقع المنتج');
      }

      setFormStatus({ type: 'success', text: 'تم حذف موقع المنتج بنجاح' });
      resetForm();
      await fetchProductLocations();
    } catch (err) {
      setFormStatus({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حذف موقع المنتج',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppPageShell
      title="مواقع التخزين"
      subtitle="سجّل مواقع المنتجات بسرعة وأرسلها لفرق التحضير والشحن"
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="grid gap-6 lg:grid-cols-[1.4fr,0.6fr]">
          <Card className="overflow-hidden border-primary/20 bg-primary text-primary-foreground">
            <div className="flex flex-col gap-6 p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-primary-foreground/60">مستودع</p>
                  <h1 className="text-3xl font-semibold">لوحة مواقع التخزين</h1>
                  <p className="text-primary-foreground/70">
                    تابع رموز SKU المسجلة وحدّث مواقعها فوراً مع سجل زمني لكل تحديث.
                  </p>
                </div>
                <div className="flex flex-col rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-4 py-3 text-right text-sm">
                  <span className="text-primary-foreground/70">آخر تحديث</span>
                  <span className="text-xl font-semibold">
                    {lastUpdatedLabel || '—'}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-5 py-4">
                  <p className="text-sm text-primary-foreground/70">السجلات الظاهرة</p>
                  <p className="mt-2 text-3xl font-semibold">{productLocations.length}</p>
                </div>
                <div className="rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-5 py-4">
                  <p className="text-sm text-primary-foreground/70">وضع البحث</p>
                  <p className="mt-2 text-xl font-semibold">
                    {searchQuery ? `نتائج لـ ${searchQuery}` : 'عرض عام'}
                  </p>
                </div>
                <div className="rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-5 py-4">
                  <p className="text-sm text-primary-foreground/70">حد النتائج</p>
                  <p className="mt-2 text-3xl font-semibold">{limit}</p>
                </div>
              </div>

              {locationSummary.length > 0 && (
                <div>
                  <p className="mb-3 text-sm text-primary-foreground/70">أكثر المخازن نشاطاً</p>
                  <div className="flex flex-wrap gap-2">
                    {locationSummary.map(([label, count]) => (
                      <Badge key={label} variant="secondary">
                        {label} • {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <div className="flex items-center gap-3 text-primary">
                <ClipboardList className="h-6 w-6" />
                <div>
                  <h2 className="text-xl font-semibold text-foreground">إرشادات الاستخدام</h2>
                  <p className="text-sm text-muted-foreground">
                    سجّل رمز SKU والموقع الداخلي بنفس التنسيق المتفق عليه (مثال: A1-03-B).
                  </p>
                </div>
              </div>
              <ul className="mt-4 list-disc space-y-2 pr-5 text-sm text-muted-foreground">
                <li>يمكن تحديث نفس SKU أكثر من مرة وسيتم حفظ آخر محرر.</li>
                <li>يجب أن تكون مواقع التخزين بالأحرف الإنجليزية لسهولة مسحها.</li>
                <li>الحذف متاح للمسؤول فقط، ويجب استخدامه بحذر.</li>
              </ul>
            </div>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
          <Card>
            <div className="border-b px-6 py-4">
              <h2 className="text-xl font-semibold">
                {selectedLocation ? 'تعديل موقع مسجل' : 'تسجيل موقع جديد'}
              </h2>
              <p className="text-sm text-muted-foreground">
                اضغط على أي صف من الجدول لتعديله أو استخدم النموذج لإضافة سجل جديد.
              </p>
            </div>
            <div className="p-6 space-y-4">
              {formStatus && (
                <Alert variant={formStatus.type === 'error' ? 'destructive' : 'default'}>
                  <AlertDescription>{formStatus.text}</AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field className="gap-2">
                    <FieldLabel>رمز SKU</FieldLabel>
                    <Input
                      value={formData.sku}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          sku: event.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="مثال: SKU12345"
                    />
                  </Field>
                  <Field className="gap-2">
                    <FieldLabel>اسم المنتج</FieldLabel>
                    <Input
                      value={formData.productName}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          productName: event.target.value,
                        }))
                      }
                      placeholder="اسم المنتج (اختياري)"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field className="gap-2">
                    <FieldLabel>المعرف الداخلي</FieldLabel>
                    <Input
                      value={formData.productId}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          productId: event.target.value,
                        }))
                      }
                      placeholder="Product ID (اختياري)"
                    />
                  </Field>
                  <Field className="gap-2">
                    <FieldLabel>موقع التخزين</FieldLabel>
                    <Input
                      value={formData.location}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          location: event.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="مثال: A1-03-B"
                    />
                  </Field>
                </div>

                <Field className="gap-2">
                  <FieldLabel>ملاحظات</FieldLabel>
                  <Textarea
                    value={formData.notes}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="اكتب أي ملاحظة تساعد فريق المستودع (اختياري)"
                  />
                </Field>

                <div className="flex flex-wrap gap-3">
                  <Button
                    type="submit"
                    disabled={saving}
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {selectedLocation ? 'تحديث الموقع' : 'حفظ الموقع'}
                  </Button>
                  {selectedLocation && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetForm}
                    >
                      <XCircle className="h-4 w-4" />
                      إلغاء التحديد
                    </Button>
                  )}
                  {selectedLocation && isAdmin && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                      حذف السجل
                    </Button>
                  )}
                </div>
              </form>
            </div>
          </Card>

          <Card>
            <div className="border-b px-6 py-4">
              <h2 className="text-xl font-semibold">البحث والسجل</h2>
              <p className="text-sm text-muted-foreground">
                استعرض السجلات الحالية وابحث بالكود، الاسم، أو الموقع.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <form onSubmit={handleSearchSubmit} className="grid gap-4 sm:grid-cols-[1fr,auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="ابحث برقم SKU أو الموقع أو اسم المنتج"
                    className="pl-10"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    تنفيذ البحث
                  </Button>
                  {searchQuery && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={clearSearch}
                    >
                      إعادة التعيين
                    </Button>
                  )}
                </div>
              </form>

              <div className="flex flex-wrap items-center gap-3">
                <Field className="w-28 gap-2">
                  <FieldLabel>حد النتائج</FieldLabel>
                <NativeSelect
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                  className="w-full"
                >
                  {limitOptions.map((option) => (
                    <NativeSelectOption key={option} value={option}>
                      {option}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                </Field>
                <Button
                  type="button"
                  onClick={fetchProductLocations}
                  disabled={loading}
                  variant="outline"
                >
                  <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  تحديث
                </Button>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {schemaMissing && (
                <Alert>
                  <AlertDescription>
                  لا يمكن تحميل السجلات قبل تشغيل أداة الهجرة: قم بتشغيل
                  <code className="mx-1 rounded bg-white px-2 py-0.5 text-xs text-amber-700">
                    prisma migrate deploy
                  </code>
                  ثم أعد المحاولة.
                  </AlertDescription>
                </Alert>
              )}

              <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                <p className="flex items-center gap-2 font-semibold text-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  التحديد السريع
                </p>
                <FieldDescription>
                  اضغط على أي صف لنسخ بياناته إلى نموذج التحرير. الصف المحدد يظل مظللاً ليسهل تتبعه.
                </FieldDescription>
              </div>

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">SKU</TableHead>
                      <TableHead className="text-right">المنتج</TableHead>
                      <TableHead className="text-right">الموقع</TableHead>
                      <TableHead className="text-right">آخر تعديل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productLocations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <EmptyState
                            title="لا توجد سجلات مطابقة"
                            description="غيّر كلمات البحث أو حد النتائج ثم أعد المحاولة."
                          />
                        </TableCell>
                      </TableRow>
                    ) : (
                      productLocations.map((record) => {
                        const isSelected = selectedLocation?.id === record.id;
                        return (
                          <TableRow
                            key={record.id}
                            onClick={() => handleRowSelect(record)}
                            className={`cursor-pointer rounded-2xl transition ${
                              isSelected
                                ? 'bg-muted font-semibold'
                                : 'hover:bg-muted/50'
                            }`}
                          >
                            <TableCell className="font-mono text-sm">{record.sku}</TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">
                                  {record.productName || '—'}
                                </span>
                                {record.productId && (
                                  <span className="text-xs text-muted-foreground">{record.productId}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                <MapPin className="h-3.5 w-3.5" />
                                {record.location}
                              </Badge>
                              {record.notes && (
                                <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">
                                  {record.notes}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              <div>{new Date(record.updatedAt).toLocaleString('ar-SA')}</div>
                              {record.updatedBy && (
                                <span className="text-xs text-muted-foreground">بواسطة {record.updatedBy}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </AppPageShell>
  );
}
