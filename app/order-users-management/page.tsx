'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import AppNavbar from '@/components/AppNavbar';
import {
  getAssignableServices,
  getRolesFromServiceKeys,
  serviceDefinitions,
} from '@/app/lib/service-definitions';
import type { ServiceKey } from '@/app/lib/service-definitions';
import {
  AlertTriangle,
  PackageCheck,
  RefreshCcw,
  ShieldCheck,
  UserPlus,
  Users as UsersIcon,
  Warehouse as WarehouseIcon,
} from 'lucide-react';

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
  serviceKeys: ServiceKey[];
  email?: string;
  phone?: string;
  affiliateName?: string | null;
  affiliateCommission?: string | number | null;
  employmentStartDate?: string | null;
  employmentEndDate?: string | null;
  salaryAmount?: string | null;
  salaryCurrency?: string | null;
  isActive: boolean;
  autoAssign: boolean;
  createdAt: string;
  _count: {
    assignments: number;
  };
  warehouses?: WarehouseOption[];
}

const ASSIGNABLE_SERVICES = getAssignableServices();
const SERVICE_MAP = new Map(serviceDefinitions.map((service) => [service.key, service]));
const inputClasses =
  'w-full rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';

const formatDateForInput = (value?: string | null) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().split('T')[0];
};

const formatDateForDisplay = (value?: string | null) => {
  if (!value) {
    return 'غير محدد';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'غير محدد';
  }
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const formatSalaryDisplay = (amount?: string | null, currency?: string | null) => {
  if (!amount) {
    return 'غير محدد';
  }
  const numericAmount = Number(amount);
  const safeCurrency = currency || 'SAR';
  if (Number.isNaN(numericAmount)) {
    return `${amount} ${safeCurrency}`.trim();
  }
  const formattedAmount = new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
  return `${formattedAmount} ${safeCurrency}`.trim();
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
    affiliateName: '',
    affiliateCommission: '',
    employmentStartDate: '',
    employmentEndDate: '',
    salaryAmount: '',
    salaryCurrency: 'SAR',
    isActive: true,
    autoAssign: true,
    warehouseIds: [] as string[],
    serviceKeys: ['order-prep'] as ServiceKey[],
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

  const selectedServiceRoles = useMemo(
    () => getRolesFromServiceKeys(formData.serviceKeys),
    [formData.serviceKeys]
  );
  const hasOrdersAccess = selectedServiceRoles.includes('orders');
  const hasWarehouseAccess = selectedServiceRoles.includes('warehouse');

  const toggleService = (serviceKey: ServiceKey) => {
    setFormData((prev) => {
      const exists = prev.serviceKeys.includes(serviceKey);
      if (exists) {
        if (prev.serviceKeys.length === 1) {
          alert('يجب اختيار رابط واحد على الأقل');
          return prev;
        }
        return {
          ...prev,
          serviceKeys: prev.serviceKeys.filter((key) => key !== serviceKey),
        };
      }
      return {
        ...prev,
        serviceKeys: [...prev.serviceKeys, serviceKey],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.serviceKeys.length === 0) {
      alert('يجب اختيار رابط واحد على الأقل');
      return;
    }

    if (hasWarehouseAccess && formData.warehouseIds.length === 0) {
      alert('يرجى اختيار مستودع واحد على الأقل لمستخدم المستودع');
      return;
    }

    try {
      const url = editingUser
        ? `/api/order-users/${editingUser.id}`
        : '/api/order-users';

      const method = editingUser ? 'PUT' : 'POST';

      const payload = {
        username: formData.username,
        password: formData.password,
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        affiliateName: formData.affiliateName,
        affiliateCommission: formData.affiliateCommission,
        employmentStartDate: formData.employmentStartDate || null,
        employmentEndDate: formData.employmentEndDate || null,
        salaryAmount: formData.salaryAmount || null,
        salaryCurrency: formData.salaryCurrency || null,
        isActive: formData.isActive,
        serviceKeys: formData.serviceKeys,
        autoAssign: hasOrdersAccess ? formData.autoAssign : false,
        warehouseIds: hasWarehouseAccess ? formData.warehouseIds : [],
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
      affiliateName: user.affiliateName || '',
      affiliateCommission: user.affiliateCommission ? String(user.affiliateCommission) : '10',
      employmentStartDate: formatDateForInput(user.employmentStartDate),
      employmentEndDate: formatDateForInput(user.employmentEndDate),
      salaryAmount: user.salaryAmount || '',
      salaryCurrency: user.salaryCurrency || 'SAR',
      isActive: user.isActive,
      autoAssign: user.autoAssign,
      warehouseIds: user.warehouses?.map((w) => w.id) || [],
      serviceKeys: (user.serviceKeys && user.serviceKeys.length > 0
        ? (user.serviceKeys as ServiceKey[])
        : (['order-prep'] as ServiceKey[])),
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
      affiliateName: '',
      affiliateCommission: '10',
      employmentStartDate: '',
      employmentEndDate: '',
      salaryAmount: '',
      salaryCurrency: 'SAR',
      isActive: true,
      autoAssign: true,
      warehouseIds: [],
      serviceKeys: ['order-prep'],
    });
  };

  const overviewStats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => user.isActive).length;
    const autoAssignEnabled = users.filter((user) => user.autoAssign).length;
    const uniqueWarehouses = new Set(
      users.flatMap((user) => (user.warehouses || []).map((warehouse) => warehouse.id))
    ).size;

    return [
      {
        label: 'إجمالي المستخدمين',
        value: total,
        hint: 'حساب مُدار',
        icon: UsersIcon,
      },
      {
        label: 'المستخدمون النشطون',
        value: active,
        hint: active === total ? 'الجميع متاح' : `${active} من ${total}`,
        icon: ShieldCheck,
      },
      {
        label: 'التعيين التلقائي',
        value: autoAssignEnabled,
        hint: autoAssignEnabled > 0 ? 'يستلمون الطلبات فوراً' : 'معطّل الآن',
        icon: PackageCheck,
      },
      {
        label: 'المستودعات المرتبطة',
        value: uniqueWarehouses,
        hint: 'موزعة على الشبكة',
        icon: WarehouseIcon,
      },
    ];
  }, [users]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 pb-16">
      <AppNavbar title="إدارة مستخدمي الطلبات" subtitle="إنشاء وإدارة حسابات الموظفين" />

      <div className="max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8 text-slate-900">
        <section className="mb-10 grid gap-6 lg:grid-cols-[minmax(0,1.9fr),minmax(0,1.1fr)]">
          <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-indigo-900 via-indigo-700 to-slate-900 p-8 text-white shadow-2xl shadow-indigo-900/40">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#ffffff22,transparent_60%)]" />
            <div className="relative z-10 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/80">
                <span>مركز التحكم</span>
              </div>
              <div>
                <h2 className="text-3xl font-semibold leading-snug text-white md:text-4xl">
                  تحكم كامل بصلاحيات التحضير والمستودع
                </h2>
                <p className="mt-3 text-base text-white/80">
                  راقب حالة الحسابات، امنح الروابط المناسبة، وتابع ارتباط المستودعات قبل أن تبدأ فرقك
                  يومها.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    if (showForm) {
                      setShowForm(false);
                      setEditingUser(null);
                      resetForm();
                      return;
                    }
                    setEditingUser(null);
                    resetForm();
                    setShowForm(true);
                  }}
                  disabled={accessDenied}
                  className="rounded-2xl bg-white/95 px-6 py-5 text-base font-semibold text-slate-900 shadow-lg shadow-slate-900/20 hover:bg-white"
                >
                  {showForm ? 'إغلاق نموذج الإدارة' : '+ إضافة مستخدم جديد'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={loadUsers}
                  className="rounded-2xl border border-white/30 bg-white/10 px-6 py-5 text-base text-white hover:bg-white/20"
                >
                  <RefreshCcw className="h-4 w-4" />
                  <span>تحديث القائمة</span>
                </Button>
              </div>
              <p className="text-sm text-white/70">
                نصيحة: حدّث الصلاحيات بعد فتح مستودع جديد أو تغيير مهام فريق التحضير.
              </p>
            </div>
          </div>
          <div className="rounded-3xl border border-white/30 bg-white/90 p-6 shadow-xl shadow-indigo-900/10">
            <div className="grid grid-cols-2 gap-4">
              {overviewStats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-200/70 bg-white/80 p-4 text-slate-600"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <span>{stat.label}</span>
                      <Icon className="h-4 w-4 text-indigo-500" />
                    </div>
                    <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
                    <p className="text-xs text-slate-500">{stat.hint}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {accessDenied ? (
          <Card className="rounded-3xl border border-rose-200/70 bg-rose-50/80 p-10 text-center text-rose-700 shadow-lg">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <p className="text-xl font-semibold">لا تملك صلاحية الوصول لهذه الصفحة</p>
            <p className="mt-2 text-sm text-rose-600/80">فقط حساب المسؤول يمكنه إدارة المستخدمين.</p>
          </Card>
        ) : (
          <>
            {showForm && (
              <Card className="mb-10 rounded-3xl border border-white/40 bg-white/95 p-8 shadow-2xl shadow-slate-900/20">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
                      {editingUser ? 'تحديث مستخدم' : 'إنشاء مستخدم'}
                    </p>
                    <h3 className="mt-1 text-2xl font-semibold text-slate-900">
                      {editingUser ? `تعديل ${editingUser.name}` : 'إضافة حساب جديد لفريق التحضير'}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      اربط الروابط المناسبة واختر المستودعات للوصول الكامل.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setShowForm(false);
                      setEditingUser(null);
                      resetForm();
                    }}
                    className="rounded-2xl border border-slate-200 px-4 py-2 text-slate-600 hover:text-slate-900"
                  >
                    إغلاق
                  </Button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-8">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">
                        اسم المستخدم *
                      </label>
                      <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        className={inputClasses}
                        required
                      />
                      {editingUser && (
                        <p className="text-xs text-slate-500">يمكنك تعديل اسم المستخدم إذا لزم الأمر.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">
                        كلمة المرور {!editingUser && '*'}
                      </label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className={inputClasses}
                        required={!editingUser}
                        placeholder={editingUser ? 'اتركها فارغة لعدم التغيير' : ''}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">الاسم *</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={inputClasses}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">البريد الإلكتروني</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className={inputClasses}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">رقم الهاتف</label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className={inputClasses}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">كود المسوق (اختياري)</label>
                      <input
                        type="text"
                        value={formData.affiliateName}
                        onChange={(e) => setFormData({ ...formData, affiliateName: e.target.value })}
                        className={inputClasses}
                        placeholder="مثال: mm11"
                      />
                      <p className="text-xs text-slate-500">لربط المستخدم بإحصائيات الحملات التسويقية.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">نسبة العمولة (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={formData.affiliateCommission}
                        onChange={(e) => setFormData({ ...formData, affiliateCommission: e.target.value })}
                        className={inputClasses}
                        placeholder="10"
                      />
                      <p className="text-xs text-slate-500">النسبة المئوية لعمولة المسوق (الافتراضي 10%).</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">
                        تاريخ بداية العمل *
                      </label>
                      <input
                        type="date"
                        value={formData.employmentStartDate}
                        onChange={(e) =>
                          setFormData({ ...formData, employmentStartDate: e.target.value })
                        }
                        className={inputClasses}
                        required={!editingUser}
                      />
                      <p className="text-xs text-slate-500">اليوم الأول الذي بدأ فيه الموظف عمله.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">
                        تاريخ نهاية العمل (اختياري)
                      </label>
                      <input
                        type="date"
                        value={formData.employmentEndDate}
                        onChange={(e) =>
                          setFormData({ ...formData, employmentEndDate: e.target.value })
                        }
                        className={inputClasses}
                      />
                      <p className="text-xs text-slate-500">
                        اتركه فارغاً إذا كان الموظف ما زال على رأس العمل.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">
                        الراتب الشهري
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.salaryAmount}
                        onChange={(e) => setFormData({ ...formData, salaryAmount: e.target.value })}
                        className={inputClasses}
                        placeholder="0.00"
                      />
                      <p className="text-xs text-slate-500">أدخل المبلغ الشهري دون البدلات.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-600">
                        عملة الراتب
                      </label>
                      <input
                        type="text"
                        value={formData.salaryCurrency}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            salaryCurrency: e.target.value.toUpperCase().slice(0, 10),
                          })
                        }
                        className={inputClasses}
                        placeholder="SAR"
                      />
                      <p className="text-xs text-slate-500">استخدم اختصار العملة مثل SAR أو USD.</p>
                    </div>
                  </div>

                  <div>
                    <label className="mb-3 block text-sm font-semibold text-slate-700">
                      الروابط المسموح بها في الصفحة الرئيسية *
                    </label>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {ASSIGNABLE_SERVICES.map((service) => {
                        const selected = formData.serviceKeys.includes(service.key);
                        return (
                          <label
                            key={service.key}
                            className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
                              selected
                                ? 'border-indigo-400 bg-indigo-50/60 shadow-sm'
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleService(service.key)}
                              className="mt-1 h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div>
                              <div className="font-semibold text-slate-900">{service.title}</div>
                              <div className="text-xs text-slate-500">{service.description}</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-indigo-700">
                      {formData.serviceKeys.length > 0 ? (
                        formData.serviceKeys.map((key) => (
                          <span
                            key={key}
                            className="rounded-full bg-indigo-50 px-3 py-1 font-semibold text-indigo-700"
                          >
                            {SERVICE_MAP.get(key)?.title || key}
                          </span>
                        ))
                      ) : (
                        <span>لم يتم اختيار روابط بعد.</span>
                      )}
                    </div>
                  </div>

                  {hasOrdersAccess && (
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 text-sm text-indigo-900">
                      <p className="font-semibold">إعدادات تحضير الطلبات</p>
                      <p className="mt-1">
                        يتم تعيين طلب واحد نشط في كل مرة ليتم العمل عليه. فعّل التعيين التلقائي لضمان
                        جاهزية الطلب فور دخول المستخدم لصفحة التحضير.
                      </p>
                    </div>
                  )}

                  {hasWarehouseAccess && (
                    <div className="space-y-3">
                      <label className="text-sm font-semibold text-slate-700">ربط المستودعات *</label>
                      {warehousesLoading ? (
                        <p className="text-sm text-slate-500">جاري تحميل المستودعات...</p>
                      ) : warehousesError ? (
                        <div className="space-y-3">
                          <p className="text-sm text-rose-600">{warehousesError}</p>
                          <Button type="button" variant="outline" onClick={loadWarehouses}>
                            إعادة المحاولة
                          </Button>
                        </div>
                      ) : warehouseOptions.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          لا يوجد مستودعات نشطة. يرجى إنشاء مستودعات من صفحة المستودع أولاً.
                        </p>
                      ) : (
                        <div className="max-h-60 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          {warehouseOptions.map((warehouse) => {
                            const isSelected = formData.warehouseIds.includes(warehouse.id);
                            return (
                              <label
                                key={warehouse.id}
                                className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 ${
                                  isSelected
                                    ? 'border-emerald-200 bg-white'
                                    : 'border-transparent hover:border-slate-200'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleWarehouseSelection(warehouse.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <div>
                                  <p className="font-semibold text-slate-900">{warehouse.name}</p>
                                  {(warehouse.code || warehouse.location) && (
                                    <p className="text-xs text-slate-500">
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
                      <p className="text-xs text-slate-500">
                        يمكن ربط مستخدم المستودع بأكثر من مستودع واحد.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>نشط</span>
                    </label>
                    {hasOrdersAccess && (
                      <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={formData.autoAssign}
                          onChange={(e) => setFormData({ ...formData, autoAssign: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>التعيين التلقائي</span>
                      </label>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" className="rounded-2xl px-6 py-5 text-base">
                      {editingUser ? 'تحديث المستخدم' : 'إضافة المستخدم'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowForm(false);
                        setEditingUser(null);
                        resetForm();
                      }}
                      className="rounded-2xl border-slate-300 px-6 py-5 text-base text-slate-700 hover:text-slate-900"
                    >
                      إلغاء
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {loading ? (
              <Card className="flex flex-col items-center justify-center rounded-3xl border border-white/30 bg-white/90 py-16 text-slate-500 shadow-lg">
                <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-500" />
                <p>جاري تحميل المستخدمين...</p>
              </Card>
            ) : users.length === 0 ? (
              <Card className="rounded-3xl border border-dashed border-slate-200 bg-white/90 p-12 text-center shadow">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <UserPlus className="h-6 w-6" />
                </div>
                <p className="text-lg font-semibold text-slate-900">لا يوجد مستخدمون بعد</p>
                <p className="mt-2 text-sm text-slate-500">
                  ابدأ بإنشاء أول مستخدم لتحضير الطلبات أو لإدارة المستودع.
                </p>
              </Card>
            ) : (
              <Card className="rounded-3xl border border-white/40 bg-white/95 p-0 shadow-lg shadow-slate-900/10">
                <Table className="text-xs text-slate-600">
                  <TableHeader className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <TableRow className="border-slate-200">
                      <TableHead className="px-6 py-4 text-right text-slate-500">
                        المستخدم
                      </TableHead>
                      <TableHead className="px-6 py-4 text-right text-slate-500">
                        التوظيف والمزايا
                      </TableHead>
                      <TableHead className="px-6 py-4 text-right text-slate-500">
                        الوصول والارتباط
                      </TableHead>
                      <TableHead className="px-6 py-4 text-right text-slate-500">
                        الإجراءات
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="bg-white text-xs">
                    {users.map((user) => {
                        const serviceKeysForUser = (user.serviceKeys || []) as ServiceKey[];
                        const derivedRoles = getRolesFromServiceKeys(serviceKeysForUser);
                        const hasOrdersRole = derivedRoles.includes('orders');
                        const hasWarehouseRole = derivedRoles.includes('warehouse');
                        const hasAccountantRole = derivedRoles.includes('accountant');
                        const serviceBadges =
                          serviceKeysForUser.length > 0 ? serviceKeysForUser : [];
                        const startDateLabel = formatDateForDisplay(user.employmentStartDate);
                        const endDateLabel = user.employmentEndDate
                          ? formatDateForDisplay(user.employmentEndDate)
                          : 'على رأس العمل';
                        const salaryLabel = formatSalaryDisplay(
                          user.salaryAmount,
                          user.salaryCurrency
                        );
                        const endedEmployment = Boolean(user.employmentEndDate);
                        const employmentStatusClasses = endedEmployment
                          ? 'border-rose-100 bg-rose-50 text-rose-700'
                          : 'border-emerald-100 bg-emerald-50 text-emerald-700';

                        return (
                          <TableRow key={user.id} className="align-top border-slate-100">
                            <TableCell className="px-6 py-4">
                              <div className="flex flex-col gap-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <div>
                                    <p className="text-base font-semibold text-slate-900">
                                      {user.name}
                                    </p>
                                    <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                                      @{user.username}
                                    </p>
                                  </div>
                                  <span
                                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                                      user.isActive
                                        ? 'bg-emerald-50 text-emerald-600'
                                        : 'bg-slate-100 text-slate-500'
                                    }`}
                                  >
                                    {user.isActive ? 'نشط' : 'غير نشط'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500">
                                  {user.email || 'لا يوجد بريد'} • {user.phone || 'لا يوجد هاتف'}
                                </p>
                                {user.affiliateName && (
                                  <span className="inline-flex w-fit items-center rounded-md bg-purple-50 px-2 py-1 text-[11px] font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
                                    مسوق: {user.affiliateName} ({Number(user.affiliateCommission || 10)}%)
                                  </span>
                                )}
                                <div className="flex flex-wrap gap-1">
                                  {serviceBadges.length > 0 ? (
                                    serviceBadges.map((key) => (
                                      <span
                                        key={key}
                                        className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700"
                                      >
                                        {SERVICE_MAP.get(key)?.title || key}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-500">
                                      لا توجد روابط محددة
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <div className="space-y-2 text-[11px]">
                                <div className="flex justify-between gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/60 px-3 py-2">
                                  <span className="text-slate-500">بداية العمل</span>
                                  <span className="font-semibold text-slate-900">
                                    {startDateLabel}
                                  </span>
                                </div>
                                <div className="flex justify-between gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/60 px-3 py-2">
                                  <span className="text-slate-500">نهاية العمل</span>
                                  <span className="font-semibold text-slate-900">{endDateLabel}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/60 px-3 py-2">
                                  <div className="flex flex-col">
                                    <span className="text-slate-500">الراتب</span>
                                    <span className="text-sm font-semibold text-slate-900">
                                      {salaryLabel}
                                    </span>
                                  </div>
                                  <span
                                    className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold ${employmentStatusClasses}`}
                                  >
                                    {endedEmployment ? 'انتهت الخدمة' : 'على رأس العمل'}
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <div className="space-y-3">
                                {hasOrdersRole && (
                                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
                                    <p className="font-semibold text-indigo-900">وصول التحضير</p>
                                    <p className="text-indigo-700">
                                      الطلبات النشطة: {user._count.assignments}
                                    </p>
                                    <p className="text-indigo-700">
                                      التعيين التلقائي: {user.autoAssign ? 'مفعّل' : 'معطّل'}
                                    </p>
                                  </div>
                                )}
                                {hasWarehouseRole && (
                                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-2">
                                    <p className="font-semibold text-emerald-900">مستودعات مرتبطة</p>
                                    {user.warehouses && user.warehouses.length > 0 ? (
                                      <ul className="mt-1 space-y-1 text-emerald-700">
                                        {user.warehouses.map((warehouse) => (
                                          <li key={warehouse.id}>
                                            {warehouse.name}
                                            {warehouse.code ? ` (${warehouse.code})` : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p className="mt-1 text-rose-600">لا توجد مستودعات مرتبطة</p>
                                    )}
                                  </div>
                                )}
                                {hasAccountantRole && (
                                  <div className="rounded-2xl border border-amber-100 bg-amber-50/70 px-3 py-2">
                                    <p className="font-semibold text-amber-900">
                                      صلاحية التقارير والمصروفات
                                    </p>
                                    <p className="text-amber-700">
                                      يمكنه عرض تقارير الطلبات ومراقبة المصروفات.
                                    </p>
                                  </div>
                                )}
                                {!hasOrdersRole && !hasWarehouseRole && !hasAccountantRole && (
                                  <p className="text-slate-500">
                                    {serviceBadges.length > 0
                                      ? 'يرتبط بالروابط الموضحة أعلاه.'
                                      : 'لا توجد روابط مرتبطة بهذا المستخدم بعد.'}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="px-6 py-4">
                              <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => handleEdit(user)}
                                    className="flex-1 rounded-2xl border-slate-200 text-slate-700 hover:text-slate-900"
                                  >
                                    تعديل
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() => handleDelete(user.id)}
                                    className="rounded-2xl border-rose-200 text-rose-600 hover:bg-rose-50"
                                  >
                                    حذف
                                  </Button>
                                </div>
                                {hasOrdersRole && user._count.assignments > 0 && (
                                  <Button
                                    variant="outline"
                                    onClick={() => handleResetOrders(user.id, user.name)}
                                    className="rounded-2xl border-amber-200 text-amber-700 hover:bg-amber-50"
                                  >
                                    إعادة تعيين الطلبات ({user._count.assignments})
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
