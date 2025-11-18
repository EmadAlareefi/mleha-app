'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface OrderUser {
  id: string;
  username: string;
  name: string;
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
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  all: 'جميع الطلبات',
  cod: 'الدفع عند الاستلام فقط',
  prepaid: 'المدفوعة مسبقاً فقط',
  specific_status: 'حالة محددة',
};

export default function OrderUsersManagementPage() {
  const [users, setUsers] = useState<OrderUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<OrderUser | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    name: '',
    email: '',
    phone: '',
    orderType: 'all',
    specificStatus: '',
    isActive: true,
    autoAssign: true,
    maxOrders: 50,
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/order-users');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const url = editingUser
        ? `/api/order-users/${editingUser.id}`
        : '/api/order-users';

      const method = editingUser ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
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

  const handleEdit = (user: OrderUser) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '', // Leave password empty for edits
      name: user.name,
      email: user.email || '',
      phone: user.phone || '',
      orderType: user.orderType,
      specificStatus: user.specificStatus || '',
      isActive: user.isActive,
      autoAssign: user.autoAssign,
      maxOrders: user.maxOrders,
    });
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
      orderType: 'all',
      specificStatus: '',
      isActive: true,
      autoAssign: true,
      maxOrders: 50,
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
              إنشاء وإدارة المستخدمين المخصصين لتحضير الطلبات
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => {
                setEditingUser(null);
                resetForm();
                setShowForm(true);
              }}
              disabled={showForm}
            >
              + إضافة مستخدم
            </Button>
            <Link href="/">
              <Button variant="outline">← العودة للرئيسية</Button>
            </Link>
          </div>
        </div>

        {/* Form */}
        {showForm && (
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
                  <label className="block text-sm font-medium mb-2">نوع الطلبات *</label>
                  <select
                    value={formData.orderType}
                    onChange={(e) => setFormData({ ...formData, orderType: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                    required
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
                    onChange={(e) => setFormData({ ...formData, maxOrders: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border rounded-lg"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    عدد الطلبات التي يتم تعيينها في كل مرة (لا يوجد حد أقصى إجمالي)
                  </p>
                </div>
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

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.autoAssign}
                    onChange={(e) => setFormData({ ...formData, autoAssign: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span>التعيين التلقائي</span>
                </label>
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
        {loading ? (
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
                  <div
                    className={`px-3 py-1 rounded-full text-sm ${
                      user.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {user.isActive ? 'نشط' : 'غير نشط'}
                  </div>
                </div>

                <div className="space-y-2 text-sm mb-4">
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
                  {user._count.assignments > 0 && (
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
