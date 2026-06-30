'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { getRolesFromServiceKeys, type ServiceKey } from '@/app/lib/service-definitions';
import type { MutationResult, OrderUser, UserFormData, WarehouseOption } from '../types';
import { ServiceSelector } from './service-selector';
import { WarehouseSelector } from './warehouse-selector';

const DEFAULT_FORM: UserFormData = {
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
  userType: 'employee',
  isActive: true,
  autoAssign: true,
  warehouseIds: [],
  serviceKeys: ['order-prep'],
};

function formatDateForInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

function buildFormData(user: OrderUser): UserFormData {
  return {
    username: user.username,
    password: '',
    name: user.name,
    email: user.email || '',
    phone: user.phone || '',
    affiliateName: user.affiliateName || '',
    affiliateCommission: user.affiliateCommission ? String(user.affiliateCommission) : '10',
    employmentStartDate: formatDateForInput(user.employmentStartDate),
    employmentEndDate: formatDateForInput(user.employmentEndDate),
    salaryAmount: user.salaryAmount || '',
    salaryCurrency: user.salaryCurrency || 'SAR',
    userType: user.userType === 'manufacturer' ? 'manufacturer' : 'employee',
    isActive: user.isActive,
    autoAssign: user.autoAssign,
    warehouseIds: user.warehouses?.map((warehouse) => warehouse.id) || [],
    serviceKeys:
      user.serviceKeys && user.serviceKeys.length > 0
        ? (user.serviceKeys as ServiceKey[])
        : (['order-prep'] as ServiceKey[]),
  };
}

interface UserFormDialogProps {
  open: boolean;
  editingUser: OrderUser | null;
  warehouseOptions: WarehouseOption[];
  warehousesLoading: boolean;
  warehousesError: string | null;
  onReloadWarehouses: () => void;
  onClose: () => void;
  onSubmit: (
    payload: Record<string, unknown>,
    editingId: string | null
  ) => Promise<MutationResult>;
}

export function UserFormDialog({
  open,
  editingUser,
  warehouseOptions,
  warehousesLoading,
  warehousesError,
  onReloadWarehouses,
  onClose,
  onSubmit,
}: UserFormDialogProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<UserFormData>(DEFAULT_FORM);
  const [tab, setTab] = useState('basic');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormData(editingUser ? buildFormData(editingUser) : DEFAULT_FORM);
    setTab('basic');
    setSubmitError(null);
    setSubmitting(false);
  }, [open, editingUser]);

  const selectedRoles = useMemo(
    () => getRolesFromServiceKeys(formData.serviceKeys),
    [formData.serviceKeys]
  );
  const hasOrdersAccess = selectedRoles.includes('orders');
  const hasWarehouseAccess = selectedRoles.includes('warehouse');

  const update = <K extends keyof UserFormData>(key: K, value: UserFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setSubmitError(null);

    if (formData.serviceKeys.length === 0) {
      setTab('permissions');
      setSubmitError('يجب اختيار صلاحية واحدة على الأقل');
      return;
    }
    if (hasWarehouseAccess && formData.warehouseIds.length === 0) {
      setTab('permissions');
      setSubmitError('يرجى اختيار مستودع واحد على الأقل لمستخدم المستودع');
      return;
    }

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
      userType: formData.userType,
      isActive: formData.isActive,
      serviceKeys: formData.serviceKeys,
      autoAssign: hasOrdersAccess ? formData.autoAssign : false,
      warehouseIds: hasWarehouseAccess ? formData.warehouseIds : [],
    };

    setSubmitting(true);
    const result = await onSubmit(payload, editingUser?.id ?? null);
    setSubmitting(false);

    if (result.ok) {
      toast({
        title: editingUser ? 'تم تحديث المستخدم' : 'تم إنشاء المستخدم',
        description: editingUser
          ? `تم حفظ تعديلات ${formData.name}`
          : `تمت إضافة ${formData.name} بنجاح`,
      });
      onClose();
    } else {
      setSubmitError(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-6 text-right">
          <DialogTitle>{editingUser ? `تعديل ${editingUser.name}` : 'إضافة مستخدم جديد'}</DialogTitle>
          <DialogDescription>
            اربط الصلاحيات المناسبة واختر المستودعات للوصول الكامل.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-4">
            <TabsList className="w-full">
              <TabsTrigger value="basic" className="flex-1">
                الأساسية
              </TabsTrigger>
              <TabsTrigger value="employment" className="flex-1">
                التوظيف
              </TabsTrigger>
              <TabsTrigger value="permissions" className="flex-1">
                الصلاحيات
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <TabsContent value="basic" className="mt-0 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>اسم المستخدم *</FieldLabel>
                  <Input
                    value={formData.username}
                    onChange={(event) => update('username', event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>كلمة المرور {!editingUser && '*'}</FieldLabel>
                  <Input
                    type="password"
                    value={formData.password}
                    onChange={(event) => update('password', event.target.value)}
                    placeholder={editingUser ? 'اتركها فارغة لعدم التغيير' : ''}
                  />
                </Field>
                <Field>
                  <FieldLabel>الاسم *</FieldLabel>
                  <Input
                    value={formData.name}
                    onChange={(event) => update('name', event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>البريد الإلكتروني</FieldLabel>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(event) => update('email', event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel>رقم الهاتف</FieldLabel>
                  <Input
                    type="tel"
                    value={formData.phone}
                    onChange={(event) => update('phone', event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel>كود المسوق (اختياري)</FieldLabel>
                  <Input
                    value={formData.affiliateName}
                    onChange={(event) => update('affiliateName', event.target.value)}
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
                    onChange={(event) => update('affiliateCommission', event.target.value)}
                    placeholder="10"
                  />
                </Field>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Checkbox
                    checked={formData.isActive}
                    onCheckedChange={(checked) => update('isActive', checked === true)}
                  />
                  <span>نشط</span>
                </label>
                <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Checkbox
                    checked={formData.userType === 'manufacturer'}
                    onCheckedChange={(checked) =>
                      update('userType', checked === true ? 'manufacturer' : 'employee')
                    }
                  />
                  <span>مصنع</span>
                </label>
              </div>
            </TabsContent>

            <TabsContent value="employment" className="mt-0 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>تاريخ بداية العمل {!editingUser && '*'}</FieldLabel>
                  <Input
                    type="date"
                    value={formData.employmentStartDate}
                    onChange={(event) => update('employmentStartDate', event.target.value)}
                    required={!editingUser}
                  />
                  <FieldDescription>اليوم الأول الذي بدأ فيه الموظف عمله.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>تاريخ نهاية العمل (اختياري)</FieldLabel>
                  <Input
                    type="date"
                    value={formData.employmentEndDate}
                    onChange={(event) => update('employmentEndDate', event.target.value)}
                  />
                  <FieldDescription>اتركه فارغاً إذا كان الموظف ما زال على رأس العمل.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>الراتب الشهري</FieldLabel>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.salaryAmount}
                    onChange={(event) => update('salaryAmount', event.target.value)}
                    placeholder="0.00"
                  />
                  <FieldDescription>أدخل المبلغ الشهري دون البدلات.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>عملة الراتب</FieldLabel>
                  <Input
                    value={formData.salaryCurrency}
                    onChange={(event) =>
                      update('salaryCurrency', event.target.value.toUpperCase().slice(0, 10))
                    }
                    placeholder="SAR"
                  />
                  <FieldDescription>استخدم اختصار العملة مثل SAR أو USD.</FieldDescription>
                </Field>
              </div>
            </TabsContent>

            <TabsContent value="permissions" className="mt-0 space-y-5">
              <div>
                <p className="mb-2 text-sm font-semibold">الصلاحيات المسموح بها *</p>
                <ServiceSelector
                  value={formData.serviceKeys}
                  onChange={(next) => update('serviceKeys', next)}
                />
              </div>

              {hasOrdersAccess && (
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
                  <p className="font-semibold">إعدادات تحضير الطلبات</p>
                  <p className="text-muted-foreground">
                    يتم تعيين طلب واحد نشط في كل مرة. فعّل التعيين التلقائي لضمان جاهزية الطلب فور دخول
                    المستخدم لصفحة التحضير.
                  </p>
                  <label className="flex w-fit items-center gap-2 rounded-lg border bg-background px-3 py-2">
                    <Checkbox
                      checked={formData.autoAssign}
                      onCheckedChange={(checked) => update('autoAssign', checked === true)}
                    />
                    <span>التعيين التلقائي</span>
                  </label>
                </div>
              )}

              {hasWarehouseAccess && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">ربط المستودعات *</p>
                  <WarehouseSelector
                    options={warehouseOptions}
                    value={formData.warehouseIds}
                    loading={warehousesLoading}
                    error={warehousesError}
                    onChange={(next) => update('warehouseIds', next)}
                    onRetry={onReloadWarehouses}
                  />
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <div className="space-y-3 border-t p-6">
          {submitError && (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              إلغاء
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? 'جاري الحفظ...'
                : editingUser
                  ? 'تحديث المستخدم'
                  : 'إضافة المستخدم'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
