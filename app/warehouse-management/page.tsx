'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">إدارة المستودعات</h1>
            <p className="text-gray-600">
              إنشاء المستودعات، تعديل بياناتها، وتفعيلها/تعطيلها.
            </p>
          </div>
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
          <Card className="p-5 border-red-200 bg-red-50 text-red-800">
            <p className="font-semibold mb-1">ترحيل قاعدة البيانات مطلوب</p>
            <p className="text-sm">
              ميزة إدارة المستودعات تتطلب تشغيل ترحيل Prisma الخاص بالمستودعات. شغّل
              <code className="mx-2 px-2 py-1 bg-white border rounded text-xs">npx prisma migrate deploy</code>
              ثم أعد تحميل الصفحة.
            </p>
          </Card>
        )}

        {showForm && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">
                {editingWarehouse ? 'تعديل مستودع' : 'مستودع جديد'}
              </h2>
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                إغلاق
              </Button>
            </div>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">اسم المستودع *</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">رمز المستودع</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  />
                  <p className="text-xs text-gray-500 mt-1">يجب أن يكون فريداً (اختياري).</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">الموقع</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">الحالة</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={formData.isActive ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setFormData({ ...formData, isActive: e.target.value === 'active' })
                    }
                  >
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">الوصف</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 min-h-[100px]"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
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
            </form>
          </Card>
        )}

        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div>
              <p className="text-sm text-gray-500">عدد المستودعات</p>
              <p className="text-2xl font-semibold">{warehouses.length}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">المستودعات النشطة</p>
              <p className="text-2xl font-semibold text-green-600">{activeCount}</p>
            </div>
            <Button variant="outline" onClick={loadWarehouses} disabled={loading}>
              تحديث القائمة
            </Button>
          </div>

          {error && (
            <div className="p-4 mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-10 text-center text-gray-500">جاري تحميل المستودعات...</div>
          ) : warehouses.length === 0 ? (
            <div className="py-10 text-center text-gray-500">
              لا يوجد مستودعات حالياً. قم بإضافة مستودع جديد للبدء.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {warehouses.map((warehouse) => (
                <Card key={warehouse.id} className="p-4 border">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-lg font-semibold">{warehouse.name}</h3>
                      {warehouse.code && (
                        <p className="text-sm text-gray-500">رمز: {warehouse.code}</p>
                      )}
                      {warehouse.location && (
                        <p className="text-sm text-gray-500">الموقع: {warehouse.location}</p>
                      )}
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs ${
                        warehouse.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      {warehouse.isActive ? 'نشط' : 'غير نشط'}
                    </span>
                  </div>
                  {warehouse.description && (
                    <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">{warehouse.description}</p>
                  )}
                  <div className="text-xs text-gray-500 space-y-1 mb-3">
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
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
