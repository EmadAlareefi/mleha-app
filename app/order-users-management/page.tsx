'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

type UserRole = 'orders' | 'store_manager' | 'warehouse';

interface WarehouseOption {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
}

interface OrderUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  email?: string;
  phone?: string;
  orderType: string;
  specificStatus?: string;
  isActive: boolean;
  autoAssign: boolean;
  maxOrders: number;
  createdAt: string;
  _count: {
    assignments: number;
  };
  warehouses?: WarehouseOption[];
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  all: 'جميع الطلبات',
  cod: 'الدفع عند الاستلام فقط',
  prepaid: 'المدفوعة مسبقاً فقط',
  specific_status: 'حالة محددة',
};

const ROLE_LABELS: Record<UserRole, string> = {
  orders: 'مستخدم الطلبات',
  store_manager: 'مدير المتجر (الإرجاع)',
  warehouse: 'موظف المستودع',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  orders: 'الوصول إلى لوحة تحضير الطلبات فقط',
  store_manager: 'الوصول إلى صفحات الإرجاع/إدارة الطلبات المرتجعة',
  warehouse: 'الوصول إلى المستودع والشحن المحلي',
};

export default function OrderUsersManagementPage() {
  const [users, setUsers] = useState<OrderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<OrderUser | null>(null);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(true);
  const [warehousesError, setWarehousesError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    name: '',
    email: '',
    phone: '',
    role: 'orders' as UserRole,
    orderType: 'all',
    specificStatus: '',
    isActive: true,
    autoAssign: true,
    maxOrders: 50,
    warehouseIds: [] as string[],
  });

  useEffect(() => {
    loadUsers();
    loadWarehouses();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    setAccessDenied(false);
    try {
      const response = await fetch('/api/order-users');

      if (response.status === 403) {
        setAccessDenied(true);
        setUsers([]);
        return;
      }

      const data = await response.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWarehouses = async () => {
    setWarehousesLoading(true);
    setWarehousesError(null);
    try {
      const response = await fetch('/api/warehouses');

      if (response.status === 403) {
        setWarehousesError('لا توجد صلاحية لعرض المستودعات');
        setWarehouseOptions([]);
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 503 && data?.missingWarehousesTable) {
          setWarehousesError(
            'ميزة المستودعات غير مفعّلة بعد. يرجى تشغيل prisma migrate deploy ثم إعادة المحاولة.'
          );
          setWarehouseOptions([]);
          return;
        }
        throw new Error(data?.error || 'فشل تحميل المستودعات');
      }

      if (data.success) {
        setWarehouseOptions(data.warehouses || []);
      } else {
        setWarehousesError('تعذر تحميل قائمة المستودعات');
      }
    } catch (error) {
      console.error('Error loading warehouses:', error);
      setWarehousesError('تعذر تحميل قائمة المستودعات');
      setWarehouseOptions([]);
    } finally {
      setWarehousesLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.role === 'warehouse' && formData.warehouseIds.length === 0) {
      alert('يرجى اختيار مستودع واحد على الأقل لمستخدم المستودع');
      return;
    }

    try {
      const url = editingUser
        ? `/api/order-users/${editingUser.id}`
        : '/api/order-users';

      const method = editingUser ? 'PUT' : 'POST';

      const payload = {
        ...formData,
        orderType: formData.role === 'orders' ? formData.orderType : 'all',
        specificStatus:
          formData.role === 'orders' ? formData.specificStatus : '',
        autoAssign: formData.role === 'orders' ? formData.autoAssign : false,
        maxOrders: formData.role === 'orders' ? formData.maxOrders : 50,
        warehouseIds: formData.role === 'warehouse' ? formData.warehouseIds : [],
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل حفظ المستخدم');
      }

      alert(editingUser ? 'تم تحديث المستخدم بنجاح' : 'تم إنشاء المستخدم بنجاح');
      setShowForm(false);
      setEditingUser(null);
      resetForm();
      loadUsers();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'حدث خطأ');
    }
  };

  const toggleWarehouseSelection = (warehouseId: string) => {
    setFormData((prev) => {
      const exists = prev.warehouseIds.includes(warehouseId);
      return {
        ...prev,
        warehouseIds: exists
          ? prev.warehouseIds.filter((id) => id !== warehouseId)
          : [...prev.warehouseIds, warehouseId],
      };
    });
  };

  const handleEdit = (user: OrderUser) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '', // Leave password empty for edits
      name: user.name,
      email: user.email || '',
      phone: user.phone || '',
      role: user.role,
      orderType: user.orderType,
      specificStatus: user.specificStatus || '',
      isActive: user.isActive,
      autoAssign: user.autoAssign,
      maxOrders: user.maxOrders,
      warehouseIds: user.warehouses?.map((w) => w.id) || [],
    });
    if (user.warehouses?.length) {
      setWarehouseOptions((prev) => {
        const existingIds = new Set(prev.map((warehouse) => warehouse.id));
        const extras = (user.warehouses || [])
          .filter((warehouse) => !existingIds.has(warehouse.id));
        return extras.length > 0 ? [...prev, ...extras] : prev;
      });
    }
    setShowForm(true);
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) {
      return;
    }

    try {
      const response = await fetch(`/api/order-users/${userId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('فشل حذف المستخدم');
      }

      alert('تم حذف المستخدم بنجاح');
      loadUsers();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'حدث خطأ');
    }
  };

  const handleResetOrders = async (userId: string, userName: string) => {
    if (!confirm(`هل أنت متأكد من إعادة تعيين جميع طلبات ${userName}؟ سيتم إرجاع الطلبات إلى حالة "تحت المراجعة" في سلة.`)) {
      return;
    }

    try {
      const response = await fetch('/api/order-assignments/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل إعادة تعيين الطلبات');
      }

      alert(data.message || 'تم إعادة تعيين الطلبات بنجاح');
      loadUsers();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'حدث خطأ');
    }
  };

  const resetForm = () => {
    setFormData({
      username: '',
      password: '',
      name: '',
      email: '',
      phone: '',
      role: 'orders',
      orderType: 'all',
      specificStatus: '',
      isActive: true,
      autoAssign: true,
      maxOrders: 50,
       warehouseIds: [],
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold mb-2">إدارة مستخدمي الطلبات</h1>
            <p className="text-gray-600">
              إنشاء وإدارة حسابات موظفي التحضير، المستودع، ومدراء الإرجاع
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => {
                setEditingUser(null);
                resetForm();
                setShowForm(true);
              }}
              disabled={showForm || accessDenied}
            >
              + إضافة مستخدم
            </Button>
            <Link href="/">
              <Button variant="outline">← العودة للرئيسية</Button>
            </Link>
          </div>
        </div>

        {/* Form */}
        {showForm && !accessDenied && (
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">
              {editingUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    اسم المستخدم *
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                    required
                    disabled={!!editingUser}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    كلمة المرور {!editingUser && '*'}
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                    required={!editingUser}
                    placeholder={editingUser ? 'اتركها فارغة لعدم التغيير' : ''}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">الاسم *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">دور المستخدم *</label>
                  <select
                    value={formData.role}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        role: e.target.value as UserRole,
                      })
                    }
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map((roleKey) => (
                      <option key={roleKey} value={roleKey}>
                        {ROLE_LABELS[roleKey]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {ROLE_DESCRIPTIONS[formData.role]}
                  </p>
                </div>

                {formData.role === 'orders' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-2">نوع الطلبات *</label>
                      <select
                        value={formData.orderType}
                        onChange={(e) => setFormData({ ...formData, orderType: e.target.value })}
                        className="w-full px-4 py-2 border rounded-lg"
                        required={formData.role === 'orders'}
                      >
                        <option value="all">جميع الطلبات</option>
                        <option value="cod">الدفع عند الاستلام فقط</option>
                        <option value="prepaid">المدفوعة مسبقاً فقط</option>
                        <option value="specific_status">حالة محددة</option>
                      </select>
                    </div>

                    {formData.orderType === 'specific_status' && (
                      <div>
                        <label className="block text-sm font-medium mb-2">الحالة المحددة</label>
                        <input
                          type="text"
                          value={formData.specificStatus}
                          onChange={(e) => setFormData({ ...formData, specificStatus: e.target.value })}
                          className="w-full px-4 py-2 border rounded-lg"
                          placeholder="مثال: pending, processing"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium mb-2">عدد الطلبات لكل دفعة</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.maxOrders}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            maxOrders: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="w-full px-4 py-2 border rounded-lg"
                        required={formData.role === 'orders'}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        عدد الطلبات التي يتم تعيينها في كل مرة (لا يوجد حد أقصى إجمالي)
                      </p>
                    </div>
                  </>
                )}

                {formData.role === 'warehouse' && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium mb-2">
                      ربط المستودعات *
                    </label>
                    {warehousesLoading ? (
                      <p className="text-sm text-gray-500">جاري تحميل المستودعات...</p>
                    ) : warehousesError ? (
                      <div className="space-y-3">
                        <p className="text-sm text-red-600">{warehousesError}</p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={loadWarehouses}
                        >
                          إعادة المحاولة
                        </Button>
                      </div>
                    ) : warehouseOptions.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        لا يوجد مستودعات نشطة. يرجى إنشاء مستودعات من صفحة المستودع أولاً.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-3 bg-gray-50">
                        {warehouseOptions.map((warehouse) => {
                          const isSelected = formData.warehouseIds.includes(warehouse.id);
                          return (
                            <label
                              key={warehouse.id}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleWarehouseSelection(warehouse.id)}
                                className="w-4 h-4"
                              />
                              <div>
                                <p className="font-medium">{warehouse.name}</p>
                                {(warehouse.code || warehouse.location) && (
                                  <p className="text-xs text-gray-500">
                                    {warehouse.code && `رمز: ${warehouse.code}`}
                                    {warehouse.code && warehouse.location ? ' • ' : ''}
                                    {warehouse.location}
                                  </p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-2">
                      يمكن ربط مستخدم المستودع بأكثر من مستودع واحد.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>نشط</span>
                </label>

                {formData.role === 'orders' && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.autoAssign}
                      onChange={(e) => setFormData({ ...formData, autoAssign: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span>التعيين التلقائي</span>
                  </label>
                )}
              </div>

              <div className="flex gap-3">
                <Button type="submit">
                  {editingUser ? 'تحديث' : 'إضافة'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditingUser(null);
                    resetForm();
                  }}
                >
                  إلغاء
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Users List */}
        {accessDenied ? (
          <Card className="p-10 text-center border-red-200 bg-red-50 text-red-800">
            <p className="font-semibold mb-2">لا تملك صلاحية الوصول لهذه الصفحة</p>
            <p className="text-sm">فقط حساب المسؤول يمكنه إدارة المستخدمين.</p>
          </Card>
        ) : loading ? (
          <div className="text-center py-12">
            <p>جاري التحميل...</p>
          </div>
        ) : users.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-gray-500">لا يوجد مستخدمون</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {users.map((user) => (
              <Card key={user.id} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold">{user.name}</h3>
                    <p className="text-sm text-gray-600">@{user.username}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="px-3 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
                      {ROLE_LABELS[user.role]}
                    </span>
                    <span
                      className={`px-3 py-1 rounded-full text-sm ${
                        user.isActive
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {user.isActive ? 'نشط' : 'غير نشط'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-sm mb-4">
                  {user.role === 'orders' ? (
                    <>
                      <div>
                        <strong>نوع الطلبات:</strong> {ORDER_TYPE_LABELS[user.orderType]}
                      </div>
                      {user.specificStatus && (
                        <div>
                          <strong>الحالة:</strong> {user.specificStatus}
                        </div>
                      )}
                      <div>
                        <strong>الطلبات النشطة:</strong> {user._count.assignments}
                      </div>
                      <div>
                        <strong>حجم الدفعة:</strong> {user.maxOrders} طلب
                      </div>
                      <div>
                        <strong>التعيين التلقائي:</strong> {user.autoAssign ? 'مفعّل' : 'معطّل'}
                      </div>
                    </>
                  ) : user.role === 'warehouse' ? (
                    <div className="space-y-2 text-gray-600">
                      <div>{ROLE_DESCRIPTIONS[user.role]}</div>
                      {user.warehouses && user.warehouses.length > 0 ? (
                        <div>
                          <strong>المستودعات المرتبطة:</strong>
                          <ul className="list-disc pr-5 mt-1 text-gray-700 text-xs space-y-1">
                            {user.warehouses.map((warehouse) => (
                              <li key={warehouse.id}>
                                {warehouse.name}
                                {warehouse.code ? ` (${warehouse.code})` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-xs text-red-600">لم يتم ربط أي مستودع بهذا المستخدم</p>
                      )}
                    </div>
                  ) : (
                    <div className="text-gray-600">
                      {ROLE_DESCRIPTIONS[user.role]}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleEdit(user)}
                      className="flex-1"
                    >
                      تعديل
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleDelete(user.id)}
                      className="text-red-600 border-red-300 hover:bg-red-50"
                    >
                      حذف
                    </Button>
                  </div>
                  {user.role === 'orders' && user._count.assignments > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => handleResetOrders(user.id, user.name)}
                      className="w-full text-orange-600 border-orange-300 hover:bg-orange-50"
                    >
                      إعادة تعيين الطلبات ({user._count.assignments})
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
