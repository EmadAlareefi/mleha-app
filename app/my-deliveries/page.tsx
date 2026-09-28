'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { RefreshCw } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { AssignmentCard } from './AssignmentCard';
import { HistoryPanel } from './HistoryPanel';
import { ReturnPickupCard } from './ReturnPickupCard';
import {
  DeliverDialog,
  FailDialog,
  PickupDialog,
  markAssignmentFailed,
  parseJsonResponse,
  recordPickupAttemptFailed,
} from './StatusDialogs';
import { TasksPanel, isOpenTask } from './TasksPanel';
import {
  ADMIN_DELIVERABLE_STATUSES,
  type Assignment,
  type DeliveryAgentTask,
  type DeliveryAgentWalletInfo,
  type LocalShipment,
  FINAL_STATUSES,
  formatCurrency,
  getCollectAmount,
  isReturnAssignment,
  isReturnPickupTask,
} from './delivery-helpers';

const ASSIGNMENTS_PAGE_LIMIT = 200;

type TabKey = 'deliveries' | 'returns' | 'done' | 'tasks';

const digitsOf = (value: string) => value.replace(/[^\d]/g, '');

const matchesSearch = (shipment: LocalShipment, query: string) => {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  const meta = shipment.orderItems?.meta;
  const haystack = [
    shipment.orderNumber,
    shipment.trackingNumber,
    shipment.customerName,
    meta?.shipToName,
    meta?.shipToDistrict,
  ];
  if (haystack.some((value) => typeof value === 'string' && value.toLowerCase().includes(text))) {
    return true;
  }
  const digits = digitsOf(text);
  return Boolean(
    digits &&
      [shipment.customerPhone, meta?.shipToPhone].some(
        (phone) => typeof phone === 'string' && digitsOf(phone).includes(digits)
      )
  );
};

const byAssignedAtAsc = (a: Assignment, b: Assignment) =>
  new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();

export default function MyDeliveriesPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const sessionUser = session?.user as any;
  const isAdminUser =
    (Array.isArray(sessionUser?.roles) && sessionUser.roles.includes('admin')) ||
    (Array.isArray(sessionUser?.serviceKeys) && sessionUser.serviceKeys.includes('admin')) ||
    sessionUser?.role === 'admin';

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [tasks, setTasks] = useState<DeliveryAgentTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [wallet, setWallet] = useState<DeliveryAgentWalletInfo | null>(null);
  const [walletError, setWalletError] = useState('');

  const [tab, setTab] = useState<TabKey>('deliveries');
  const [search, setSearch] = useState('');
  const [deliverTarget, setDeliverTarget] = useState<Assignment | null>(null);
  const [failTarget, setFailTarget] = useState<Assignment | null>(null);
  const [pickupTarget, setPickupTarget] = useState<DeliveryAgentTask | null>(null);
  const [pickupFailTarget, setPickupFailTarget] = useState<DeliveryAgentTask | null>(null);

  const [adminSelection, setAdminSelection] = useState<string[]>([]);
  const [adminBulkUpdating, setAdminBulkUpdating] = useState(false);
  const [refreshingLocationId, setRefreshingLocationId] = useState<string | null>(null);

  const fetchAssignments = useCallback(async (nextPage = 1, append = false) => {
    try {
      if (append) setLoadingMore(true);
      setError('');
      const params = new URLSearchParams({ page: String(nextPage), limit: String(ASSIGNMENTS_PAGE_LIMIT) });
      const response = await fetch(`/api/shipment-assignments?${params}`);
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحميل الشحنات');
      }
      const next: Assignment[] = Array.isArray(data.assignments) ? data.assignments : [];
      setAssignments((prev) => {
        if (!append) return next;
        const seen = new Set(prev.map((assignment) => assignment.id));
        return [...prev, ...next.filter((assignment) => !seen.has(assignment.id))];
      });
      setPage(data.pagination?.page ?? nextPage);
      setHasMore(Boolean(data.pagination?.hasMore));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل الشحنات');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      setTasksError('');
      const response = await fetch('/api/delivery-agent-tasks?includeCompleted=true');
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحميل المهام');
      }
      setTasks(data.tasks || []);
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل المهام');
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const fetchWallet = useCallback(async () => {
    try {
      setWalletError('');
      const response = await fetch('/api/delivery-agent-wallets?deliveryAgentId=me&includeTransactions=true');
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحميل المحفظة');
      }
      setWallet(data.wallet || null);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل المحفظة');
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchAssignments(), fetchTasks(), fetchWallet()]);
    setRefreshing(false);
  }, [fetchAssignments, fetchTasks, fetchWallet]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const { deliveries, returns, done } = useMemo(() => {
    const open = assignments.filter((assignment) => !FINAL_STATUSES.includes(assignment.status));
    return {
      deliveries: open.filter((assignment) => !isReturnAssignment(assignment)).sort(byAssignedAtAsc),
      returns: open.filter(isReturnAssignment).sort(byAssignedAtAsc),
      done: assignments.filter((assignment) => FINAL_STATUSES.includes(assignment.status)),
    };
  }, [assignments]);

  // Returns filed on orders this agent delivered arrive as pickup tasks.
  const returnPickups = tasks.filter((task) => isReturnPickupTask(task) && isOpenTask(task));
  const otherTasks = tasks.filter((task) => !returnPickups.includes(task));
  const openTaskCount = otherTasks.filter(isOpenTask).length;
  const toCollect = [...deliveries, ...returns].reduce((sum, assignment) => sum + getCollectAmount(assignment), 0);
  const cashInHand = assignments
    .filter((assignment) => assignment.shipment.codCollection?.status === 'collected')
    .reduce(
      (sum, assignment) =>
        sum +
        Number(
          assignment.shipment.codCollection?.collectedAmount ??
            assignment.shipment.codCollection?.collectionAmount ??
            0
        ),
      0
    );

  const handleStatusDone = async (message: string) => {
    setDeliverTarget(null);
    setFailTarget(null);
    toast({ title: message });
    await Promise.all([fetchAssignments(), fetchWallet()]);
  };

  const handlePickupDone = async (message: string) => {
    setPickupTarget(null);
    setPickupFailTarget(null);
    toast({ title: message });
    await fetchTasks();
  };

  // ---- Admin-only helpers -------------------------------------------------

  const toggleAdminSelection = (assignmentId: string) =>
    setAdminSelection((prev) =>
      prev.includes(assignmentId) ? prev.filter((id) => id !== assignmentId) : [...prev, assignmentId]
    );

  const handleAdminBulkDeliver = async () => {
    if (!isAdminUser || adminSelection.length === 0) return;
    setAdminBulkUpdating(true);
    try {
      for (const assignmentId of adminSelection) {
        const response = await fetch(`/api/shipment-assignments/${assignmentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'delivered' }),
        });
        const data = await parseJsonResponse(response);
        if (!response.ok) {
          throw new Error(data?.error || 'تعذر تحديث إحدى الشحنات');
        }
      }
      toast({ title: 'تم تأكيد تسليم الشحنات المحددة' });
      setAdminSelection([]);
      await Promise.all([fetchAssignments(), fetchWallet()]);
    } catch (err) {
      toast({
        title: 'تعذر إتمام التحديث الجماعي',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setAdminBulkUpdating(false);
    }
  };

  const handleRefreshLocation = async (assignment: Assignment) => {
    setRefreshingLocationId(assignment.id);
    try {
      const response = await fetch(`/api/local-shipments/${assignment.shipment.id}/refresh-location`, {
        method: 'POST',
      });
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحديث الموقع');
      }
      setAssignments((prev) =>
        prev.map((item) =>
          item.id === assignment.id
            ? {
                ...item,
                shipment: {
                  ...item.shipment,
                  orderItems: { ...(item.shipment.orderItems || {}), meta: data.meta },
                },
              }
            : item
        )
      );
      toast({ title: 'تم تحديث الموقع من سلة' });
    } catch (err) {
      toast({
        title: 'تعذر تحديث الموقع',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRefreshingLocationId(null);
    }
  };

  // ---- Rendering ----------------------------------------------------------

  const renderList = (list: Assignment[], isReturn: boolean) => {
    const visible = list.filter((assignment) => matchesSearch(assignment.shipment, search));
    const selectable = isAdminUser
      ? visible.filter((assignment) => ADMIN_DELIVERABLE_STATUSES.includes(assignment.status))
      : [];

    if (visible.length === 0) {
      return (
        <EmptyState
          title={
            list.length === 0
              ? isReturn
                ? 'لا توجد مرتجعات أو استبدالات'
                : 'لا توجد شحنات للتوصيل'
              : 'لا توجد نتائج مطابقة'
          }
        />
      );
    }

    return (
      <div className="space-y-3">
        {isAdminUser && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <span className="text-emerald-800">
              تأكيد إداري بدون رمز · محدد {adminSelection.length}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setAdminSelection(
                    adminSelection.length > 0 ? [] : selectable.map((assignment) => assignment.id)
                  )
                }
                disabled={adminBulkUpdating || selectable.length === 0}
              >
                {adminSelection.length > 0 ? 'مسح التحديد' : `تحديد الكل (${selectable.length})`}
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={handleAdminBulkDeliver}
                disabled={adminBulkUpdating || adminSelection.length === 0}
              >
                {adminBulkUpdating ? 'جاري التأكيد...' : 'تأكيد المحدد'}
              </Button>
            </div>
          </div>
        )}
        {visible.map((assignment) => (
          <AssignmentCard
            key={assignment.id}
            assignment={assignment}
            isReturn={isReturn}
            onDeliver={setDeliverTarget}
            onFail={setFailTarget}
            admin={
              isAdminUser
                ? {
                    selected: adminSelection.includes(assignment.id),
                    onToggle: () => toggleAdminSelection(assignment.id),
                    onRefreshLocation: () => handleRefreshLocation(assignment),
                    refreshing: refreshingLocationId === assignment.id,
                    disabled: adminBulkUpdating,
                  }
                : undefined
            }
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <AppPageShell title="شحناتي">
        <LoadingState label="جاري تحميل الشحنات..." />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell title="شحناتي">
      <div className="mx-auto w-full max-w-2xl space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-xl border bg-white px-3 py-2">
            <p className="text-xs text-gray-500">للتحصيل من العملاء</p>
            <p className="text-lg font-bold text-orange-600">{formatCurrency(toCollect)}</p>
          </div>
          <Button
            variant="outline"
            className="h-14 w-14 shrink-0"
            onClick={refreshAll}
            disabled={refreshing}
            aria-label="تحديث"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
          <TabsList className="grid h-12 w-full grid-cols-4">
            <TabsTrigger value="deliveries" className="h-10">توصيل ({deliveries.length})</TabsTrigger>
            <TabsTrigger value="returns" className="h-10">
              مرتجعات ({returns.length + returnPickups.length})
            </TabsTrigger>
            <TabsTrigger value="done" className="h-10">المنجزة</TabsTrigger>
            <TabsTrigger value="tasks" className="h-10">مهام ({openTaskCount})</TabsTrigger>
          </TabsList>

          {tab !== 'tasks' && (
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث: رقم الطلب، الاسم، الجوال، الحي"
              aria-label="بحث الشحنات"
              className="mt-3 h-11"
            />
          )}

          <TabsContent value="deliveries" className="mt-3">
            {renderList(deliveries, false)}
          </TabsContent>
          <TabsContent value="returns" className="mt-3 space-y-3">
            {returnPickups
              .filter((task) =>
                task.relatedShipment ? matchesSearch(task.relatedShipment, search) : false
              )
              .map((task) => (
                <ReturnPickupCard
                  key={task.id}
                  task={task as Parameters<typeof ReturnPickupCard>[0]['task']}
                  onPickedUp={setPickupTarget}
                  onFail={setPickupFailTarget}
                />
              ))}
            {(returns.length > 0 || returnPickups.length === 0) && renderList(returns, true)}
          </TabsContent>
          <TabsContent value="done" className="mt-3">
            <HistoryPanel
              assignments={done.filter((assignment) => matchesSearch(assignment.shipment, search))}
              wallet={wallet}
              walletError={walletError}
              cashInHand={cashInHand}
            />
          </TabsContent>
          <TabsContent value="tasks" className="mt-3">
            <TasksPanel
              tasks={otherTasks}
              loading={tasksLoading}
              error={tasksError}
              onChanged={async () => {
                await Promise.all([fetchTasks(), fetchWallet()]);
              }}
            />
          </TabsContent>
        </Tabs>

        {hasMore && tab !== 'tasks' && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fetchAssignments(page + 1, true)}
            disabled={loadingMore}
          >
            {loadingMore ? 'جاري التحميل...' : 'تحميل شحنات أقدم'}
          </Button>
        )}
      </div>

      <DeliverDialog
        assignment={deliverTarget}
        requiresOtp={!isAdminUser}
        onClose={() => setDeliverTarget(null)}
        onDone={() => handleStatusDone('تم تأكيد التسليم')}
      />
      <FailDialog
        title={
          failTarget
            ? `تعذّر تسليم #${failTarget.shipment.orderNumber}`
            : pickupFailTarget
              ? `تعذّر استلام مرتجع #${pickupFailTarget.relatedShipment?.orderNumber ?? ''}`
              : null
        }
        onClose={() => {
          setFailTarget(null);
          setPickupFailTarget(null);
        }}
        onSubmit={async (reason) => {
          if (failTarget) {
            await markAssignmentFailed(failTarget.id, reason);
            await handleStatusDone('تم تسجيل تعذّر التسليم');
          } else if (pickupFailTarget) {
            await recordPickupAttemptFailed(pickupFailTarget.id, reason);
            await handlePickupDone('تم تسجيل السبب، المرتجع باقٍ في قائمتك');
          }
        }}
      />
      <PickupDialog
        task={pickupTarget}
        onClose={() => setPickupTarget(null)}
        onDone={() => handlePickupDone('تم تأكيد استلام المرتجع')}
      />
    </AppPageShell>
  );
}
