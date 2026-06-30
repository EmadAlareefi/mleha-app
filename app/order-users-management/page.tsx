'use client';

import { useState } from 'react';
import { AlertTriangle, RefreshCcw, UserPlus } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/components/ui/use-toast';
import { useOrderUsers } from './hooks/use-order-users';
import { StatsCards } from './components/stats-cards';
import { UserFilters, DEFAULT_FILTERS, type UserFiltersState } from './components/user-filters';
import { UsersTable } from './components/users-table';
import { UserFormDialog } from './components/user-form-dialog';
import { PrinterLinkDialog } from './components/printer-link-dialog';
import type { OrderUser } from './types';

type ConfirmState =
  | { type: 'delete'; user: OrderUser }
  | { type: 'reset'; user: OrderUser }
  | null;

export default function OrderUsersManagementPage() {
  const { toast } = useToast();
  const {
    users,
    loading,
    accessDenied,
    warehouseOptions,
    warehousesLoading,
    warehousesError,
    loadUsers,
    loadWarehouses,
    saveUser,
    deleteUser,
    resetOrders,
    updateUserPrinterLink,
    mergeWarehouseOptions,
  } = useOrderUsers();

  const [filters, setFilters] = useState<UserFiltersState>(DEFAULT_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<OrderUser | null>(null);
  const [printerUser, setPrinterUser] = useState<OrderUser | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const openCreate = () => {
    setEditingUser(null);
    setFormOpen(true);
  };

  const openEdit = (user: OrderUser) => {
    if (user.warehouses?.length) {
      mergeWarehouseOptions(user.warehouses);
    }
    setEditingUser(user);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingUser(null);
  };

  const handleConfirm = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);

    const result =
      confirmState.type === 'delete'
        ? await deleteUser(confirmState.user.id)
        : await resetOrders(confirmState.user.id);

    setConfirmBusy(false);

    if (result.ok) {
      const resetMessage =
        'message' in result ? (result as { message?: string }).message : undefined;
      toast({
        title: confirmState.type === 'delete' ? 'تم حذف المستخدم' : 'تم تصفير الطلبات',
        description:
          confirmState.type === 'delete'
            ? `تم حذف ${confirmState.user.name}`
            : resetMessage || 'تم إعادة تعيين الطلبات بنجاح',
      });
      setConfirmState(null);
    } else {
      toast({ title: 'حدث خطأ', description: result.error, variant: 'destructive' });
    }
  };

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
              <Button size="sm" onClick={openCreate} disabled={accessDenied}>
                <UserPlus className="h-4 w-4" />
                إضافة مستخدم
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={loadUsers}>
                <RefreshCcw className="h-4 w-4" />
                تحديث
              </Button>
            </div>
          </div>
        </Card>
        <StatsCards users={users} />
      </section>

      {accessDenied ? (
        <Alert variant="destructive" className="p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <AlertTitle className="col-span-full text-xl">
            لا تملك صلاحية الوصول لهذه الصفحة
          </AlertTitle>
          <AlertDescription className="col-span-full justify-items-center">
            فقط حساب المسؤول يمكنه إدارة المستخدمين.
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <Card>
          <LoadingState label="جاري تحميل المستخدمين..." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <UserFilters filters={filters} onChange={setFilters} />
          <UsersTable
            users={users}
            filters={filters}
            onEdit={openEdit}
            onPrinter={setPrinterUser}
            onResetOrders={(user) => setConfirmState({ type: 'reset', user })}
            onDelete={(user) => setConfirmState({ type: 'delete', user })}
          />
        </div>
      )}

      <UserFormDialog
        open={formOpen}
        editingUser={editingUser}
        warehouseOptions={warehouseOptions}
        warehousesLoading={warehousesLoading}
        warehousesError={warehousesError}
        onReloadWarehouses={loadWarehouses}
        onClose={closeForm}
        onSubmit={saveUser}
      />

      <PrinterLinkDialog
        user={printerUser}
        onClose={() => setPrinterUser(null)}
        onLinkChange={updateUserPrinterLink}
      />

      <ConfirmationDialog
        open={confirmState !== null}
        title={confirmState?.type === 'delete' ? 'حذف المستخدم' : 'تصفير الطلبات'}
        message={
          confirmState?.type === 'delete'
            ? `هل أنت متأكد من حذف ${confirmState?.user.name}؟ لا يمكن التراجع عن هذا الإجراء.`
            : `هل أنت متأكد من إعادة تعيين جميع طلبات ${confirmState?.user.name}؟ سيتم إرجاع الطلبات إلى حالة "تحت المراجعة" في سلة.`
        }
        confirmLabel={confirmState?.type === 'delete' ? 'حذف' : 'تصفير'}
        confirmVariant="danger"
        confirmDisabled={confirmBusy}
        onConfirm={handleConfirm}
        onCancel={() => !confirmBusy && setConfirmState(null)}
      />
    </AppPageShell>
  );
}
