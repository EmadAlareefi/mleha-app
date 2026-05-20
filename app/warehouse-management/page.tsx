'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

interface Warehouse {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WarehouseFormData {
  name: string;
  code: string;
  location: string;
  description: string;
  isActive: boolean;
}

const emptyForm: WarehouseFormData = {
  name: '',
  code: '',
  location: '',
  description: '',
  isActive: true,
};

export default function WarehouseManagementPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [formData, setFormData] = useState<WarehouseFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadWarehouses();
  }, []);

  const activeCount = useMemo(
    () => warehouses.filter((warehouse) => warehouse.isActive).length,
    [warehouses]
  );

  const loadWarehouses = async () => {
    setLoading(true);
    setError(null);
    setSchemaMissing(false);
    try {
      const response = await fetch('/api/warehouses?all=true');
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 503 && data?.missingWarehousesTable) {
          setSchemaMissing(true);
          setError(
            'يجب تطبيق ترحيل قاعدة البيانات للمستودعات قبل استخدام هذه الصفحة. شغّل prisma migrate deploy ثم أعد المحاولة.'
          );
          setWarehouses([]);
          return;
        }
        throw new Error(data?.error || 'تعذر تحميل المستودعات');
      }

      setWarehouses(data.warehouses || []);
    } catch (err) {
      console.error('Error loading warehouses:', err);
      setError(err instanceof Error ? err.message : 'تعذر تحميل المستودعات');
      setWarehouses([]);
    } finally {
      setLoading(false);
    }
  };

  const openCreateForm = () => {
    setEditingWarehouse(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (warehouse: Warehouse) => {
    setEditingWarehouse(warehouse);
    setFormData({
      name: warehouse.name,
      code: warehouse.code || '',
      location: warehouse.location || '',
      description: warehouse.description || '',
      isActive: warehouse.isActive,
    });
    setShowForm(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.name.trim()) {
      alert('اسم المستودع مطلوب');
      return;
    }

    setSaving(true);
    try {
      const url = editingWarehouse ? `/api/warehouses/${editingWarehouse.id}` : '/api/warehouses';
      const method = editingWarehouse ? 'PUT' : 'POST';

      const payload = {
        ...formData,
        name: formData.name.trim(),
        code: formData.code.trim() || null,
        location: formData.location.trim() || null,
        description: formData.description.trim() || null,
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'تعذر حفظ المستودع');
      }

      setShowForm(false);
      setEditingWarehouse(null);
      setFormData(emptyForm);
      await loadWarehouses();
      alert(editingWarehouse ? 'تم تحديث المستودع' : 'تم إنشاء المستودع');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر حفظ المستودع');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (warehouse: Warehouse) => {
    if (
      !confirm(
        `هل أنت متأكد من حذف المستودع ${warehouse.name}؟ سيتم إزالة أي روابط تعتمد عليه.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(`/api/warehouses/${warehouse.id}`, {
        method: 'DELETE',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر حذف المستودع');
      }
      await loadWarehouses();
      alert('تم حذف المستودع');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر حذف المستودع');
    }
  };

  const handleToggleActive = async (warehouse: Warehouse) => {
    try {
      const response = await fetch(`/api/warehouses/${warehouse.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: warehouse.name,
          code: warehouse.code,
          location: warehouse.location,
          description: warehouse.description,
          isActive: !warehouse.isActive,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحديث حالة المستودع');
      }
      await loadWarehouses();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر تحديث حالة المستودع');
    }
  };

  return (
    <AppPageShell title="إدارة المستودعات" subtitle="إنشاء المستودعات، تعديل بياناتها، وتفعيلها أو تعطيلها">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={openCreateForm} disabled={schemaMissing}>
              + إضافة مستودع
            </Button>
            <Link href="/">
              <Button variant="outline">← العودة للرئيسية</Button>
            </Link>
          </div>
        </div>

        {schemaMissing && (
          <Alert variant="destructive">
            <AlertTitle>ترحيل قاعدة البيانات مطلوب</AlertTitle>
            <AlertDescription>
              ميزة إدارة المستودعات تتطلب تشغيل ترحيل Prisma الخاص بالمستودعات. شغّل
              <code className="mx-2 px-2 py-1 bg-white border rounded text-xs">npx prisma migrate deploy</code>
              ثم أعد تحميل الصفحة.
            </AlertDescription>
          </Alert>
        )}

        {showForm && (
          <Card className="rounded-lg">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>
                {editingWarehouse ? 'تعديل مستودع' : 'مستودع جديد'}
                </CardTitle>
                <CardDescription>أدخل بيانات المستودع وحالة تفعيله.</CardDescription>
              </div>
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                إغلاق
              </Button>
            </CardHeader>
            <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>اسم المستودع *</FieldLabel>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>رمز المستودع</FieldLabel>
                  <Input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  />
                  <FieldDescription>يجب أن يكون فريداً (اختياري).</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>الموقع</FieldLabel>
                  <Input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel>الحالة</FieldLabel>
                  <NativeSelect
                    value={formData.isActive ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setFormData({ ...formData, isActive: e.target.value === 'active' })
                    }
                  >
                    <NativeSelectOption value="active">نشط</NativeSelectOption>
                    <NativeSelectOption value="inactive">غير نشط</NativeSelectOption>
                  </NativeSelect>
                </Field>
              </div>
              <Field>
                <FieldLabel>الوصف</FieldLabel>
                <Textarea
                  className="min-h-[100px]"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </Field>
              <div className="flex gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'جارٍ الحفظ...' : editingWarehouse ? 'تحديث' : 'حفظ'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingWarehouse(null);
                    setFormData(emptyForm);
                  }}
                >
                  إلغاء
                </Button>
              </div>
              </FieldGroup>
            </form>
            </CardContent>
          </Card>
        )}

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>قائمة المستودعات</CardTitle>
            <CardDescription>إجمالي المستودعات وحالة التفعيل الحالية.</CardDescription>
          </CardHeader>
          <CardContent>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div>
              <p className="text-sm text-muted-foreground">عدد المستودعات</p>
              <p className="text-2xl font-semibold">{warehouses.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">المستودعات النشطة</p>
              <p className="text-2xl font-semibold text-green-600">{activeCount}</p>
            </div>
            <Button variant="outline" onClick={loadWarehouses} disabled={loading}>
              تحديث القائمة
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading ? (
            <LoadingState label="جاري تحميل المستودعات..." />
          ) : warehouses.length === 0 ? (
            <EmptyState title="لا يوجد مستودعات حالياً" description="قم بإضافة مستودع جديد للبدء." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {warehouses.map((warehouse) => (
                <Card key={warehouse.id} className="rounded-lg">
                  <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-lg font-semibold">{warehouse.name}</h3>
                      {warehouse.code && (
                        <p className="text-sm text-muted-foreground">رمز: {warehouse.code}</p>
                      )}
                      {warehouse.location && (
                        <p className="text-sm text-muted-foreground">الموقع: {warehouse.location}</p>
                      )}
                    </div>
                    <Badge variant={warehouse.isActive ? 'default' : 'secondary'}>
                      {warehouse.isActive ? 'نشط' : 'غير نشط'}
                    </Badge>
                  </div>
                  {warehouse.description && (
                    <p className="text-sm text-muted-foreground mb-3 whitespace-pre-wrap">{warehouse.description}</p>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1 mb-3">
                    <p>أُنشئ في: {new Date(warehouse.createdAt).toLocaleString('ar')}</p>
                    <p>آخر تحديث: {new Date(warehouse.updatedAt).toLocaleString('ar')}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditForm(warehouse)}>
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleActive(warehouse)}
                      className={warehouse.isActive ? 'text-yellow-600 border-yellow-200' : 'text-green-600 border-green-200'}
                    >
                      {warehouse.isActive ? 'تعطيل' : 'تفعيل'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(warehouse)}
                      className="text-red-600 border-red-200"
                    >
                      حذف
                    </Button>
                  </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}
