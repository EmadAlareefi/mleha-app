'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getAssignableServices,
  getRolesFromServiceKeys,
  serviceDefinitions,
} from '@/app/lib/service-definitions';
import type { ServiceKey } from '@/app/lib/service-definitions';
import {
  AlertTriangle,
  PackageCheck,
  Printer,
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
  printerLink?: PrinterLinkInfo | null;
}

interface PrinterLinkInfo {
  printerId: number;
  printerName?: string | null;
  computerId?: number | null;
  computerName?: string | null;
  paperName?: string | null;
}

interface PrinterProfileConfig {
  id: string;
  printerId: number;
  label: string;
  location?: string | null;
  paperName?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PrintNodeInventoryPrinter {
  id: number;
  name: string;
  description?: string;
  state?: string;
  default?: {
    paper?: string;
    paperName?: string;
  };
  computer?: {
    id?: number;
    name?: string;
    hostname?: string;
    state?: string;
    description?: string;
  };
}

interface PrinterOption {
  id: number;
  label: string;
  description?: string;
  paperName?: string;
  location?: string | null;
  notes?: string | null;
  source: 'profile' | 'printnode';
  state?: string;
  computerId?: number;
  computerName?: string;
  printerName?: string;
}

const ASSIGNABLE_SERVICES = getAssignableServices();
const SERVICE_MAP = new Map(serviceDefinitions.map((service) => [service.key, service]));

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
  const [printerInventory, setPrinterInventory] = useState({
    printers: [] as PrintNodeInventoryPrinter[],
    profiles: [] as PrinterProfileConfig[],
    loading: false,
    loaded: false,
    error: null as string | null,
  });
  const [printerDialog, setPrinterDialog] = useState({
    open: false,
    user: null as OrderUser | null,
    selectedPrinterId: null as number | null,
    saving: false,
    unlinking: false,
    error: null as string | null,
  });

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

  const loadPrinterInventory = useCallback(
    async (force = false) => {
      if (!force && (printerInventory.loaded || printerInventory.loading)) {
        return;
      }

      setPrinterInventory((prev) => ({
        ...prev,
        loading: true,
        error: null,
      }));

      try {
        const response = await fetch('/api/printers');
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'تعذر تحميل بيانات الطابعات');
        }

        setPrinterInventory({
          printers: Array.isArray(data.printers) ? data.printers : [],
          profiles: Array.isArray(data.profiles) ? data.profiles : [],
          loading: false,
          loaded: true,
          error: null,
        });
      } catch (error) {
        setPrinterInventory((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'حدث خطأ أثناء تحميل بيانات الطابعات',
        }));
      }
    },
    [printerInventory.loaded, printerInventory.loading]
  );

  const ensurePrinterInventory = useCallback(() => {
    loadPrinterInventory(false);
  }, [loadPrinterInventory]);

  const refreshPrinterInventory = useCallback(() => {
    loadPrinterInventory(true);
  }, [loadPrinterInventory]);

  const printerOptions = useMemo(() => {
    const options: PrinterOption[] = [];
    const mapped = new Set<number>();
    const printersById = new Map(printerInventory.printers.map((printer) => [printer.id, printer]));

    printerInventory.profiles.forEach((profile) => {
      const printer = printersById.get(profile.printerId);
      options.push({
        id: profile.printerId,
        label: profile.label,
        description:
          profile.location || printer?.computer?.name || printer?.computer?.hostname || undefined,
        paperName: profile.paperName || printer?.default?.paperName || printer?.default?.paper,
        location: profile.location,
        notes: profile.notes || undefined,
        source: 'profile',
        state: printer?.state,
        computerId: printer?.computer?.id,
        computerName: printer?.computer?.name || printer?.computer?.hostname,
        printerName: profile.label || printer?.name,
      });
      mapped.add(profile.printerId);
    });

    printerInventory.printers.forEach((printer) => {
      if (mapped.has(printer.id)) {
        return;
      }
      options.push({
        id: printer.id,
        label: printer.name,
        description: printer.description || printer.computer?.name || printer.computer?.hostname,
        paperName: printer.default?.paperName || printer.default?.paper,
        source: 'printnode',
        state: printer.state,
        computerId: printer.computer?.id,
        computerName: printer.computer?.name || printer.computer?.hostname,
        printerName: printer.name,
      });
    });

    return options.sort((a, b) => a.label.localeCompare(b.label, 'ar')); // Arabic locale keeps original order readable
  }, [printerInventory]);

  const getPrinterMeta = useCallback(
    (printerId: number) => {
      const option = printerOptions.find((printer) => printer.id === printerId);
      if (!option) {
        return null;
      }
      return {
        printerName: option.printerName || option.label,
        paperName: option.paperName,
        computerId: option.computerId,
        computerName: option.computerName,
      };
    },
    [printerOptions]
  );

  const openPrinterDialog = useCallback(
    (user: OrderUser) => {
      setPrinterDialog({
        open: true,
        user,
        selectedPrinterId: user.printerLink?.printerId ?? null,
        saving: false,
        unlinking: false,
        error: null,
      });
      ensurePrinterInventory();
    },
    [ensurePrinterInventory]
  );

  const closePrinterDialog = useCallback(() => {
    setPrinterDialog({
      open: false,
      user: null,
      selectedPrinterId: null,
      saving: false,
      unlinking: false,
      error: null,
    });
  }, []);

  const updateUserPrinterLink = useCallback((userId: string, link: PrinterLinkInfo | null) => {
    setUsers((prev) =>
      prev.map((user) => (user.id === userId ? { ...user, printerLink: link } : user))
    );
  }, []);

  const handlePrinterSelection = useCallback((printerId: number) => {
    setPrinterDialog((prev) => ({ ...prev, selectedPrinterId: printerId, error: null }));
  }, []);

  const handleSavePrinterLink = useCallback(async () => {
    if (!printerDialog.user || printerDialog.selectedPrinterId === null) {
      setPrinterDialog((prev) => ({
        ...prev,
        error: 'يرجى اختيار طابعة قبل الحفظ',
      }));
      return;
    }

    const printerMeta = getPrinterMeta(printerDialog.selectedPrinterId);
    setPrinterDialog((prev) => ({ ...prev, saving: true, error: null }));

    try {
      const response = await fetch('/api/order-prep/printer-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: printerDialog.user.id,
          printerId: printerDialog.selectedPrinterId,
          printerName: printerMeta?.printerName,
          paperName: printerMeta?.paperName,
          computerId: printerMeta?.computerId,
          computerName: printerMeta?.computerName,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'فشل حفظ ربط الطابعة');
      }

      updateUserPrinterLink(printerDialog.user.id, {
        printerId: data.link?.printerId ?? printerDialog.selectedPrinterId,
        printerName: data.link?.printerName ?? printerMeta?.printerName ?? null,
        computerId: data.link?.computerId ?? printerMeta?.computerId ?? null,
        computerName: data.link?.computerName ?? printerMeta?.computerName ?? null,
        paperName: data.link?.paperName ?? printerMeta?.paperName ?? null,
      });

      alert('تم تحديث الطابعة بنجاح للمستخدم المحدد');
      closePrinterDialog();
    } catch (error) {
      setPrinterDialog((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'فشل حفظ ربط الطابعة',
      }));
    } finally {
      setPrinterDialog((prev) => ({ ...prev, saving: false }));
    }
  }, [closePrinterDialog, getPrinterMeta, printerDialog, updateUserPrinterLink]);

  const handleUnlinkPrinter = useCallback(async () => {
    if (!printerDialog.user) {
      return;
    }

    setPrinterDialog((prev) => ({ ...prev, unlinking: true, error: null }));

    try {
      const response = await fetch(`/api/order-prep/printer-links?userId=${printerDialog.user.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'فشل إزالة الربط');
      }

      updateUserPrinterLink(printerDialog.user.id, null);
      alert('تم إزالة ربط الطابعة');
      closePrinterDialog();
    } catch (error) {
      setPrinterDialog((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'تعذر إزالة الربط',
      }));
    } finally {
      setPrinterDialog((prev) => ({ ...prev, unlinking: false }));
    }
  }, [closePrinterDialog, printerDialog.user, updateUserPrinterLink]);

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
    <AppPageShell
      title="إدارة مستخدمي الطلبات"
      subtitle="إنشاء وإدارة حسابات الموظفين"
      contentClassName="flex flex-1 flex-col gap-4 p-4 md:p-6"
    >
        <section className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Card className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">مستخدمو التحضير والمستودع</h2>
                <p className="text-sm text-muted-foreground">
                  إدارة الصلاحيات، المستودعات، الطابعات، والتعيين التلقائي من جدول واحد.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
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
                >
                  <UserPlus className="h-4 w-4" />
                  {showForm ? 'إغلاق النموذج' : 'إضافة مستخدم'}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={loadUsers}>
                  <RefreshCcw className="h-4 w-4" />
                  تحديث
                </Button>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
              {overviewStats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="rounded-md border bg-muted/30 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>{stat.label}</span>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="mt-1 text-lg font-semibold">{stat.value}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>

        {accessDenied ? (
          <Alert variant="destructive" className="p-10 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <AlertTitle className="col-span-full text-xl">لا تملك صلاحية الوصول لهذه الصفحة</AlertTitle>
            <AlertDescription className="col-span-full justify-items-center">
              فقط حساب المسؤول يمكنه إدارة المستخدمين.
            </AlertDescription>
          </Alert>
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
                    <Field>
                      <FieldLabel>اسم المستخدم *</FieldLabel>
                      <Input
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        required
                      />
                      {editingUser && (
                        <FieldDescription>يمكنك تعديل اسم المستخدم إذا لزم الأمر.</FieldDescription>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel>كلمة المرور {!editingUser && '*'}</FieldLabel>
                      <Input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required={!editingUser}
                        placeholder={editingUser ? 'اتركها فارغة لعدم التغيير' : ''}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>الاسم *</FieldLabel>
                      <Input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel>البريد الإلكتروني</FieldLabel>
                      <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>رقم الهاتف</FieldLabel>
                      <Input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>كود المسوق (اختياري)</FieldLabel>
                      <Input
                        type="text"
                        value={formData.affiliateName}
                        onChange={(e) => setFormData({ ...formData, affiliateName: e.target.value })}
                        placeholder="مثال: mm11"
                      />
                      <FieldDescription>لربط المستخدم بإحصائيات الحملات التسويقية.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel>نسبة العمولة (%)</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={formData.affiliateCommission}
                        onChange={(e) => setFormData({ ...formData, affiliateCommission: e.target.value })}
                        placeholder="10"
                      />
                      <FieldDescription>النسبة المئوية لعمولة المسوق (الافتراضي 10%).</FieldDescription>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>تاريخ بداية العمل *</FieldLabel>
                      <Input
                        type="date"
                        value={formData.employmentStartDate}
                        onChange={(e) =>
                          setFormData({ ...formData, employmentStartDate: e.target.value })
                        }
                        required={!editingUser}
                      />
                      <FieldDescription>اليوم الأول الذي بدأ فيه الموظف عمله.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel>تاريخ نهاية العمل (اختياري)</FieldLabel>
                      <Input
                        type="date"
                        value={formData.employmentEndDate}
                        onChange={(e) =>
                          setFormData({ ...formData, employmentEndDate: e.target.value })
                        }
                      />
                      <FieldDescription>اتركه فارغاً إذا كان الموظف ما زال على رأس العمل.</FieldDescription>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>الراتب الشهري</FieldLabel>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={formData.salaryAmount}
                        onChange={(e) => setFormData({ ...formData, salaryAmount: e.target.value })}
                        placeholder="0.00"
                      />
                      <FieldDescription>أدخل المبلغ الشهري دون البدلات.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel>عملة الراتب</FieldLabel>
                      <Input
                        type="text"
                        value={formData.salaryCurrency}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            salaryCurrency: e.target.value.toUpperCase().slice(0, 10),
                          })
                        }
                        placeholder="SAR"
                      />
                      <FieldDescription>استخدم اختصار العملة مثل SAR أو USD.</FieldDescription>
                    </Field>
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
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => toggleService(service.key)}
                              className="mt-1"
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
                          <Badge
                            key={key}
                            variant="outline"
                            className="bg-indigo-50 font-semibold text-indigo-700"
                          >
                            {SERVICE_MAP.get(key)?.title || key}
                          </Badge>
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
                        <LoadingState label="جاري تحميل المستودعات..." />
                      ) : warehousesError ? (
                        <div className="space-y-3">
                          <Alert variant="destructive">
                            <AlertDescription>{warehousesError}</AlertDescription>
                          </Alert>
                          <Button type="button" variant="outline" onClick={loadWarehouses}>
                            إعادة المحاولة
                          </Button>
                        </div>
                      ) : warehouseOptions.length === 0 ? (
                        <EmptyState
                          title="لا توجد مستودعات نشطة"
                          description="يرجى إنشاء مستودعات من صفحة المستودع أولاً."
                        />
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
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => toggleWarehouseSelection(warehouse.id)}
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
                      <Checkbox
                        checked={formData.isActive}
                        onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked === true })}
                      />
                      <span>نشط</span>
                    </label>
                    {hasOrdersAccess && (
                      <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
                        <Checkbox
                          checked={formData.autoAssign}
                          onCheckedChange={(checked) => setFormData({ ...formData, autoAssign: checked === true })}
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
              <Card>
                <LoadingState label="جاري تحميل المستخدمين..." />
              </Card>
            ) : users.length === 0 ? (
              <EmptyState
                title="لا يوجد مستخدمون بعد"
                description="ابدأ بإنشاء أول مستخدم لتحضير الطلبات أو لإدارة المستودع."
                action={
                  <Button
                    onClick={() => {
                      setEditingUser(null);
                      resetForm();
                      setShowForm(true);
                    }}
                  >
                    <UserPlus className="h-4 w-4" />
                    إضافة مستخدم
                  </Button>
                }
              />
            ) : (
              <Card className="overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 w-[220px] px-3 text-right">المستخدم</TableHead>
                      <TableHead className="h-9 px-3 text-right">الروابط</TableHead>
                      <TableHead className="h-9 px-3 text-right">المستودعات</TableHead>
                      <TableHead className="h-9 px-3 text-right">الطابعة</TableHead>
                      <TableHead className="h-9 px-3 text-right">الطلبات</TableHead>
                      <TableHead className="h-9 px-3 text-right">التوظيف</TableHead>
                      <TableHead className="h-9 w-[180px] px-3 text-right">الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => {
                        const serviceKeysForUser = (user.serviceKeys || []) as ServiceKey[];
                        const derivedRoles = getRolesFromServiceKeys(serviceKeysForUser);
                        const hasOrdersRole = derivedRoles.includes('orders');
                        const hasWarehouseRole = derivedRoles.includes('warehouse');
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

                        return (
                          <TableRow key={user.id} className="align-middle">
                            <TableCell className="px-3 py-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-sm font-medium">{user.name}</p>
                                  <Badge variant={user.isActive ? 'default' : 'secondary'}>
                                    {user.isActive ? 'نشط' : 'متوقف'}
                                  </Badge>
                                </div>
                                <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {user.email || user.phone || 'لا توجد بيانات اتصال'}
                                </p>
                                {user.affiliateName && (
                                  <p className="truncate text-xs text-purple-700">
                                    مسوق: {user.affiliateName} ({Number(user.affiliateCommission || 10)}%)
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              <div className="flex max-w-[260px] flex-wrap gap-1">
                                {serviceBadges.length > 0 ? (
                                  serviceBadges.map((key) => (
                                    <Badge key={key} variant="outline">
                                      {SERVICE_MAP.get(key)?.title || key}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">لا توجد روابط</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              {hasWarehouseRole ? (
                                user.warehouses && user.warehouses.length > 0 ? (
                                  <div className="max-w-[220px] truncate text-xs">
                                    {user.warehouses
                                      .map((warehouse) => warehouse.code || warehouse.name)
                                      .join('، ')}
                                  </div>
                                ) : (
                                  <Badge variant="destructive">لا توجد</Badge>
                                )
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              <div className="flex max-w-[220px] items-center gap-2">
                                <Printer className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="truncate text-xs">
                                  {user.printerLink?.printerName || 'غير مرتبطة'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              {hasOrdersRole ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant={user.autoAssign ? 'default' : 'secondary'}>
                                    {user.autoAssign ? 'تلقائي' : 'يدوي'}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {user._count.assignments} طلب
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              <div className="space-y-0.5 text-xs">
                                <div>{startDateLabel}</div>
                                <div className="text-muted-foreground">{salaryLabel}</div>
                                <Badge variant={endedEmployment ? 'destructive' : 'secondary'}>
                                  {endedEmployment ? `انتهى: ${endDateLabel}` : 'على رأس العمل'}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-2">
                              <div className="flex flex-wrap gap-1.5">
                                <Button size="sm" variant="outline" onClick={() => handleEdit(user)}>
                                  تعديل
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openPrinterDialog(user)}>
                                  طابعة
                                </Button>
                                {hasOrdersRole && user._count.assignments > 0 && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleResetOrders(user.id, user.name)}
                                  >
                                    تصفير
                                  </Button>
                                )}
                                <Button size="sm" variant="destructive" onClick={() => handleDelete(user.id)}>
                                  حذف
                                </Button>
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
      <Dialog open={printerDialog.open} onOpenChange={(open) => !open && closePrinterDialog()}>
        {printerDialog.user && (
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <div>
                <DialogTitle>ربط الطابعة للمستخدم</DialogTitle>
                <DialogDescription>
                  {printerDialog.user.name} - @{printerDialog.user.username}
                </DialogDescription>
              </div>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={refreshPrinterInventory}
                  disabled={printerInventory.loading}
                  className="rounded-2xl border-slate-200"
                >
                  <RefreshCcw className="h-4 w-4" />
                  تحديث القائمة
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closePrinterDialog}
                  disabled={printerDialog.saving || printerDialog.unlinking}
                  className="rounded-2xl text-slate-600 hover:text-slate-900"
                >
                  إغلاق
                </Button>
              </div>
              {printerInventory.error && (
                <Alert variant="destructive">
                  <AlertTitle>تعذر تحميل بيانات الطابعات</AlertTitle>
                  <AlertDescription>{printerInventory.error}</AlertDescription>
                </Alert>
              )}

              {printerInventory.loading ? (
                <LoadingState label="جاري تحميل قائمة الطابعات..." />
              ) : (
                <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {printerOptions.length === 0 && (
                    <EmptyState
                      title="لا توجد طابعات متاحة"
                      description="تأكد من اتصال PrintNode ثم حاول مرة أخرى."
                    />
                  )}
                  {printerOptions.map((option) => {
                    const isSelected = printerDialog.selectedPrinterId === option.id;
                    return (
                      <Button
                        key={option.id}
                        type="button"
                        onClick={() => handlePrinterSelection(option.id)}
                        variant={isSelected ? 'default' : 'outline'}
                        className="h-auto w-full justify-start px-4 py-3 text-right"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-base font-semibold">{option.label}</p>
                            {option.description && (
                              <p className="text-xs opacity-70">{option.description}</p>
                            )}
                            {option.paperName && (
                              <p className="text-xs opacity-70">الورق: {option.paperName}</p>
                            )}
                            {option.notes && (
                              <p className="text-xs opacity-70">ملاحظات: {option.notes}</p>
                            )}
                          </div>
                          <div className="text-left">
                            <Badge variant={option.source === 'profile' ? 'secondary' : 'outline'}>
                              {option.source === 'profile' ? 'تكوين مخصص' : 'PrintNode'}
                            </Badge>
                            {option.state && (
                              <p
                                className={`mt-1 text-xs font-semibold ${
                                  option.state === 'online'
                                    ? 'text-emerald-600'
                                    : option.state === 'disconnected'
                                      ? 'text-rose-600'
                                      : 'text-slate-500'
                                }`}
                              >
                                الحالة: {option.state}
                              </p>
                            )}
                          </div>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              )}

              {printerDialog.error && (
                <Alert variant="destructive">
                  <AlertDescription>{printerDialog.error}</AlertDescription>
                </Alert>
              )}

              <DialogFooter className="flex-wrap">
                <Button
                  type="button"
                  onClick={handleSavePrinterLink}
                  disabled={printerDialog.saving || printerDialog.selectedPrinterId === null}
                  className="rounded-2xl px-6 py-5"
                >
                  {printerDialog.saving ? 'جاري الحفظ...' : 'حفظ ربط الطابعة'}
                </Button>
                {printerDialog.user.printerLink && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUnlinkPrinter}
                    disabled={printerDialog.unlinking}
                    className="rounded-2xl border-rose-200 px-6 py-5 text-rose-600 hover:bg-rose-50"
                  >
                    {printerDialog.unlinking ? 'جاري الإزالة...' : 'إزالة الربط الحالي'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={closePrinterDialog}
                  disabled={printerDialog.saving || printerDialog.unlinking}
                  className="rounded-2xl px-6 py-5 text-slate-600 hover:text-slate-900"
                >
                  إلغاء
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </AppPageShell>
  );
}
