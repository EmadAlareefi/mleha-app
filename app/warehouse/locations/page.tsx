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
  const [search, setSearch] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createStatusMessage, setCreateStatusMessage] = useState<string | null>(null);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [updateSubmitting, setUpdateSubmitting] = useState(false);
  const [updateStatusMessage, setUpdateStatusMessage] = useState<string | null>(null);
  const [updateFormError, setUpdateFormError] = useState<string | null>(null);
  const [selectedUpdateId, setSelectedUpdateId] = useState<string | null>(null);
  const [deletingSku, setDeletingSku] = useState<string | null>(null);
  const [createFormValues, setCreateFormValues] = useState({
    sku: '',
    location: '',
    productName: '',
  });
  const [updateFormValues, setUpdateFormValues] = useState({
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

  const handleCreateInputChange = (field: 'sku' | 'location' | 'productName') => (event: ChangeEvent<HTMLInputElement>) => {
    setCreateFormValues((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleUpdateInputChange = (field: 'sku' | 'location' | 'productName') => (event: ChangeEvent<HTMLInputElement>) => {
    setUpdateFormValues((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const resetCreateForm = () => {
    setCreateFormValues({ sku: '', location: '', productName: '' });
  };

  const resetUpdateForm = () => {
    setUpdateFormValues({ sku: '', location: '', productName: '' });
    setSelectedUpdateId(null);
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateSubmitting(true);
    setCreateFormError(null);
    setCreateStatusMessage(null);

    try {
      const payload = {
        sku: createFormValues.sku.trim(),
        location: createFormValues.location.trim(),
        productName: createFormValues.productName.trim() || undefined,
      };

      if (!payload.sku || !payload.location) {
        setCreateFormError('رمز SKU وموقع التخزين مطلوبان');
        return;
      }

      const existingLocation = locations.find((record) => record.sku.toLowerCase() === payload.sku.toLowerCase());
      if (existingLocation) {
        setCreateFormError('تم تسجيل موقع لهذا SKU بالفعل، يرجى استخدام نموذج التحديث لتعديله.');
        return;
      }

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

      setCreateStatusMessage('تم حفظ موقع المنتج بنجاح');
      resetCreateForm();
    } catch (err) {
      console.error('Failed to save product location', err);
      setCreateFormError(err instanceof Error ? err.message : 'تعذر حفظ موقع المنتج');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleUpdateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUpdateSubmitting(true);
    setUpdateFormError(null);
    setUpdateStatusMessage(null);

    try {
      const payload = {
        sku: updateFormValues.sku.trim(),
        location: updateFormValues.location.trim(),
        productName: updateFormValues.productName.trim() || undefined,
      };

      if (!payload.sku || !payload.location) {
        setUpdateFormError('رمز SKU وموقع التخزين مطلوبان للتحديث');
        return;
      }

      const existingLocation = locations.find((record) => record.sku.toLowerCase() === payload.sku.toLowerCase());
      if (!existingLocation) {
        setUpdateFormError('لم يتم العثور على هذا SKU في السجلات الحالية، يرجى استخدام نموذج التسجيل لإضافته.');
        return;
      }

      const response = await fetch('/api/product-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحديث موقع المنتج');
      }

      const saved: ProductLocation = data.productLocation;
      setLocations((prev) => {
        const other = prev.filter((record) => record.id !== saved.id);
        return [saved, ...other].slice(0, MAX_VISIBLE);
      });

      setUpdateFormValues({
        sku: saved.sku,
        location: saved.location,
        productName: saved.productName || '',
      });
      setUpdateStatusMessage('تم تحديث موقع المنتج بنجاح');
      setSelectedUpdateId(saved.id);
    } catch (err) {
      console.error('Failed to update product location', err);
      setUpdateFormError(err instanceof Error ? err.message : 'تعذر تحديث موقع المنتج');
    } finally {
      setUpdateSubmitting(false);
    }
  };

  const selectLocationForUpdate = (location: ProductLocation) => {
    setUpdateFormValues({
      sku: location.sku,
      location: location.location,
      productName: location.productName || '',
    });
    setSelectedUpdateId(location.id);
    setUpdateStatusMessage(null);
    setUpdateFormError(null);
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
    setCreateStatusMessage(null);
    setUpdateStatusMessage(null);

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
      if (selectedUpdateId === location.id) {
        resetUpdateForm();
      }
      setUpdateStatusMessage('تم حذف موقع المنتج بنجاح');
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
              <form className="space-y-4" onSubmit={handleCreateSubmit}>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="skuInput">
                    رمز SKU
                  </label>
                  <Input
                    id="skuInput"
                    dir="ltr"
                    required
                    placeholder="SKU12345"
                    value={createFormValues.sku}
                    onChange={handleCreateInputChange('sku')}
                    disabled={createSubmitting}
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
                    value={createFormValues.location}
                    onChange={handleCreateInputChange('location')}
                    disabled={createSubmitting}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="productNameInput">
                    اسم المنتج (اختياري)
                  </label>
                  <Input
                    id="productNameInput"
                    placeholder="فستان سهرة طويل"
                    value={createFormValues.productName}
                    onChange={handleCreateInputChange('productName')}
                    disabled={createSubmitting}
                  />
                </div>

                {createFormError && (
                  <p className="text-sm text-red-600">{createFormError}</p>
                )}
                {createStatusMessage && (
                  <p className="text-sm text-emerald-600">{createStatusMessage}</p>
                )}

                <div className="flex gap-3">
                  <Button type="submit" className="flex-1" disabled={createSubmitting}>
                    {createSubmitting ? <Loader2 className="animate-spin" /> : <Save />}
                    حفظ الموقع
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      resetCreateForm();
                      setCreateStatusMessage(null);
                      setCreateFormError(null);
                    }}
                    disabled={createSubmitting}
                  >
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

          <Card className="border-amber-100 bg-white md:col-span-2">
            <CardHeader>
              <CardTitle>تحديث موقع منتج</CardTitle>
              <CardDescription>
                اختر السجل من الجدول أو أدخل SKU يدوياً لتعديل موقعه واسم المنتج، ولن يتم إنشاء سجل جديد من خلال هذا النموذج.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleUpdateSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="updateSkuInput">
                      رمز SKU
                    </label>
                    <Input
                      id="updateSkuInput"
                      dir="ltr"
                      placeholder="SKU12345"
                      value={updateFormValues.sku}
                      onChange={handleUpdateInputChange('sku')}
                      disabled={updateSubmitting}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="updateLocationInput">
                      موقع التخزين الجديد
                    </label>
                    <Input
                      id="updateLocationInput"
                      dir="ltr"
                      placeholder="A1"
                      value={updateFormValues.location}
                      onChange={handleUpdateInputChange('location')}
                      disabled={updateSubmitting}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="updateProductNameInput">
                    اسم المنتج (اختياري)
                  </label>
                  <Input
                    id="updateProductNameInput"
                    placeholder="فستان سهرة طويل"
                    value={updateFormValues.productName}
                    onChange={handleUpdateInputChange('productName')}
                    disabled={updateSubmitting}
                  />
                </div>

                {updateFormError && (
                  <p className="text-sm text-red-600">{updateFormError}</p>
                )}
                {updateStatusMessage && (
                  <p className="text-sm text-emerald-600">{updateStatusMessage}</p>
                )}

                <div className="flex gap-3">
                  <Button type="submit" className="flex-1" disabled={updateSubmitting}>
                    {updateSubmitting ? <Loader2 className="animate-spin" /> : <Save />}
                    تحديث الموقع
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      resetUpdateForm();
                      setUpdateStatusMessage(null);
                      setUpdateFormError(null);
                    }}
                    disabled={updateSubmitting}
                  >
                    مسح الحقول
                  </Button>
                </div>
              </form>
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
                    <TableRow key={location.id} className={selectedUpdateId === location.id ? 'bg-amber-50' : undefined}>
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
                          <Button size="sm" variant="outline" onClick={() => selectLocationForUpdate(location)}>
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
