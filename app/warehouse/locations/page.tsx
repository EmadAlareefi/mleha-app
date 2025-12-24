'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Loader2, RefreshCcw, Save, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ProductLocation = {
  id: string;
  sku: string;
  location: string;
  productName?: string | null;
  productId?: string | null;
  merchantId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_VISIBLE = 300;

export default function WarehouseLocationsPage() {
  const { data: session } = useSession();
  const [locations, setLocations] = useState<ProductLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingSku, setDeletingSku] = useState<string | null>(null);
  const [formValues, setFormValues] = useState({
    sku: '',
    location: '',
    productName: '',
  });

  const userRoles = useMemo(() => {
    const role = (session?.user as any)?.role as string | undefined;
    const roles = (session?.user as any)?.roles as string[] | undefined;
    if (roles && roles.length > 0) {
      return roles;
    }
    return role ? [role] : [];
  }, [session]);

  const isAdmin = userRoles.includes('admin');

  const fetchLocations = useCallback(async (options?: { silent?: boolean }) => {
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setListError(null);

    try {
      const response = await fetch(`/api/product-locations?limit=${MAX_VISIBLE}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحميل المواقع');
      }

      setLocations(Array.isArray(data?.productLocations) ? data.productLocations : []);
    } catch (err) {
      console.error('Failed to load product locations', err);
      setListError(err instanceof Error ? err.message : 'تعذر تحميل المواقع');
    } finally {
      if (options?.silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const filteredLocations = useMemo(() => {
    if (!search.trim()) {
      return locations;
    }
    const term = search.trim().toLowerCase();
    return locations.filter((location) =>
      [location.sku, location.location, location.productName, location.updatedBy]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term))
    );
  }, [locations, search]);

  const handleInputChange = (field: 'sku' | 'location' | 'productName') => (event: ChangeEvent<HTMLInputElement>) => {
    setFormValues((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const resetForm = () => {
    setFormValues({ sku: '', location: '', productName: '' });
    setEditingId(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setStatusMessage(null);

    try {
      const payload = {
        sku: formValues.sku.trim(),
        location: formValues.location.trim(),
        productName: formValues.productName.trim() || undefined,
      };

      const response = await fetch('/api/product-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر حفظ موقع المنتج');
      }

      const saved: ProductLocation = data.productLocation;
      setLocations((prev) => {
        const other = prev.filter((record) => record.id !== saved.id);
        return [saved, ...other].slice(0, MAX_VISIBLE);
      });

      setStatusMessage(data.action === 'updated' ? 'تم تحديث موقع المنتج بنجاح' : 'تم حفظ موقع المنتج بنجاح');
      resetForm();
    } catch (err) {
      console.error('Failed to save product location', err);
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ موقع المنتج');
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (location: ProductLocation) => {
    setFormValues({
      sku: location.sku,
      location: location.location,
      productName: location.productName || '',
    });
    setEditingId(location.id);
    setStatusMessage(null);
  };

  const handleDelete = async (location: ProductLocation) => {
    if (!isAdmin) {
      return;
    }

    const confirmed = window.confirm(`هل أنت متأكد من حذف موقع SKU ${location.sku}؟`);
    if (!confirmed) {
      return;
    }

    setDeletingSku(location.sku);
    setListError(null);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/product-locations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku: location.sku }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر حذف موقع المنتج');
      }

      setLocations((prev) => prev.filter((record) => record.id !== location.id));
      setStatusMessage('تم حذف موقع المنتج بنجاح');
    } catch (err) {
      console.error('Failed to delete product location', err);
      setListError(err instanceof Error ? err.message : 'تعذر حذف موقع المنتج');
    } finally {
      setDeletingSku(null);
    }
  };

  const latestUpdateTime = locations[0]?.updatedAt ? new Date(locations[0].updatedAt).toLocaleString('ar-SA') : null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 py-10">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">مواقع منتجات المستودع</h1>
            <p className="mt-2 text-slate-600">
              اربط كل SKU بموقعه داخل المستودع لتسريع تحضير الطلبات، التغييرات تظهر مباشرةً أدناه.
            </p>
            {latestUpdateTime && (
              <p className="mt-1 text-sm text-slate-500">آخر تحديث: {latestUpdateTime}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/warehouse">العودة إلى لوحة المستودع</Link>
            </Button>
            <Button variant="outline" onClick={() => fetchLocations({ silent: true })} disabled={loading || refreshing}>
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
              إعادة التحميل
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-blue-100 bg-white">
            <CardHeader>
              <CardTitle>تسجيل موقع منتج</CardTitle>
              <CardDescription>امسح SKU ثم أدخل رمز الموقع مثل A1 أو B2، وسيتم حفظه فوراً.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="skuInput">
                    رمز SKU
                  </label>
                  <Input
                    id="skuInput"
                    dir="ltr"
                    required
                    placeholder="SKU12345"
                    value={formValues.sku}
                    onChange={handleInputChange('sku')}
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="locationInput">
                    موقع التخزين
                  </label>
                  <Input
                    id="locationInput"
                    dir="ltr"
                    required
                    placeholder="A1"
                    value={formValues.location}
                    onChange={handleInputChange('location')}
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="productNameInput">
                    اسم المنتج (اختياري)
                  </label>
                  <Input
                    id="productNameInput"
                    placeholder="فستان سهرة طويل"
                    value={formValues.productName}
                    onChange={handleInputChange('productName')}
                    disabled={submitting}
                  />
                </div>

                {formError && (
                  <p className="text-sm text-red-600">{formError}</p>
                )}
                {statusMessage && (
                  <p className="text-sm text-emerald-600">{statusMessage}</p>
                )}

                <div className="flex gap-3">
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting ? <Loader2 className="animate-spin" /> : <Save />}
                    {editingId ? 'تحديث الموقع' : 'حفظ الموقع'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={resetForm} disabled={submitting}>
                    مسح الحقول
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="border-emerald-100 bg-white">
            <CardHeader>
              <CardTitle>بحث سريع</CardTitle>
              <CardDescription>اعثر على أي SKU أو موقع أثناء العمل، وسيتم تظليله في الجدول أدناه.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <label htmlFor="searchInput" className="mb-1 block text-sm font-medium text-slate-700">
                    كلمة البحث
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="searchInput"
                        placeholder="SKU أو موقع أو اسم"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-600">
                      {filteredLocations.length} نتيجة
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-3 text-sm text-emerald-700">
                  التغييرات التي تحفظها بالزر تظهر مباشرةً في الجدول، ويمكنك تعديل أي صف بنقرة واحدة.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>آخر المواقع ({locations.length})</CardTitle>
              <CardDescription>يتم عرض آخر {Math.min(MAX_VISIBLE, locations.length)} سجل تم تحديثه.</CardDescription>
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                يتم التحميل...
              </div>
            )}
          </CardHeader>
          {listError && (
            <div className="px-6 pb-2 text-sm text-red-600">
              {listError}
            </div>
          )}
          <CardContent className="p-0">
            {filteredLocations.length === 0 ? (
              <p className="p-6 text-center text-slate-500">
                {loading ? 'جارٍ تحميل البيانات...' : 'لا توجد سجلات مطابقة بعد.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">SKU</TableHead>
                    <TableHead className="w-24">الموقع</TableHead>
                    <TableHead>اسم المنتج</TableHead>
                    <TableHead className="w-32">آخر تحديث</TableHead>
                    <TableHead className="w-32">المستخدم</TableHead>
                    <TableHead className="w-32">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLocations.map((location) => (
                    <TableRow key={location.id} className={editingId === location.id ? 'bg-amber-50' : undefined}>
                      <TableCell className="font-semibold" dir="ltr">
                        {location.sku}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700" dir="ltr">
                          {location.location}
                        </span>
                      </TableCell>
                      <TableCell>
                        {location.productName ? (
                          <span className="text-slate-800">{location.productName}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(location.updatedAt).toLocaleTimeString('ar-SA', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        <span className="block text-xs text-slate-400">
                          {new Date(location.updatedAt).toLocaleDateString('ar-SA')}
                        </span>
                      </TableCell>
                      <TableCell>
                        {location.updatedBy || 'غير معروف'}
                        {location.createdBy && location.createdBy !== location.updatedBy && (
                          <span className="block text-xs text-slate-400">بدايةً بواسطة {location.createdBy}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEditing(location)}>
                            تعديل
                          </Button>
                          {isAdmin && (
                            <Button
                              size="icon"
                              variant="destructive"
                              onClick={() => handleDelete(location)}
                              disabled={deletingSku === location.sku}
                              aria-label={`حذف SKU ${location.sku}`}
                            >
                              {deletingSku === location.sku ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
