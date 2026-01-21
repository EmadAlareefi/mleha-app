'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Loader2, Package, RefreshCcw, Printer } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/components/ui/use-toast';

type AssignmentStatus = 'assigned' | 'preparing' | 'waiting' | 'completed';

interface Assignment {
  id: string;
  merchantId: string;
  userId: string;
  userName: string;
  orderId: string;
  orderNumber?: string | null;
  orderReference?: string | null;
  status: AssignmentStatus;
  assignedAt: string;
  startedAt: string | null;
  waitingAt: string | null;
  completedAt: string | null;
  lastStatusUpdateAt: string;
  orderData: any;
}

interface LineItem {
  sku: string | null;
  name: string | null;
  quantity: number;
  image: string | null;
  color: string | null;
  size: string | null;
  location: string | null;
  locationNotes: string | null;
}

const assignmentStatusMeta: Record<
  AssignmentStatus,
  { label: string; className: string }
> = {
  assigned: {
    label: 'بانتظار البدء',
    className: 'bg-gray-100 text-gray-800 border border-gray-200',
  },
  preparing: {
    label: 'جاري التجهيز',
    className: 'bg-purple-100 text-purple-700 border border-purple-200',
  },
  waiting: {
    label: 'قيد الانتظار',
    className: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  },
  completed: {
    label: 'مكتمل',
    className: 'bg-green-100 text-green-700 border border-green-200',
  },
};

const orderStatusColors = new Map<string, string>([
  ['under_review', 'bg-yellow-50 text-yellow-700 border-yellow-200'],
  ['in_progress', 'bg-blue-50 text-blue-700 border-blue-200'],
  ['completed', 'bg-green-50 text-green-700 border-green-200'],
  ['shipped', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
  ['delivered', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  ['canceled', 'bg-red-50 text-red-700 border-red-200'],
]);

export default function OrderPrepClient() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [sallaStatusAction, setSallaStatusAction] = useState<string | null>(null);
  const autoStartedAssignments = useRef<Set<string>>(new Set());
  const refreshedAssignments = useRef<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'complete' | 'under_review_a' | 'under_review_reservation' | 'under_review_inner';
    assignment: Assignment;
  } | null>(null);
  const { toast } = useToast();

  const loadAssignments = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) {
        setLoading(true);
      }
      try {
        const response = await fetch('/api/order-prep/orders', {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'تعذر تحميل الطلبات');
        }
        const assignmentsList = Array.isArray(data.assignments) ? data.assignments : [];
        setAssignments(assignmentsList.length > 0 ? [assignmentsList[0]] : []);
        if (data.autoAssigned) {
          toast({ description: '🎉 تم تعيين أقدم طلب جديد لك تلقائياً' });
        }
        setLastUpdated(new Date().toISOString());
      } catch (err) {
        toast({
          variant: 'destructive',
          description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const requestNewOrder = useCallback(async () => {
    if (assignments.length > 0) {
      toast({ description: '⚠️ يرجى إنهاء الطلب الحالي قبل طلب طلب جديد' });
      return;
    }
    setAssigning(true);
    try {
      const response = await fetch('/api/order-prep/orders/assign', {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'لا توجد طلبات جديدة متاحة');
      }
      setAssignments([data.assignment]);
      toast({ description: '✅ تم تعيين طلب جديد لك' });
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'تعذر الحصول على طلب جديد',
      });
    } finally {
      setAssigning(false);
    }
  }, [assignments.length, toast]);

  const updateStatus = useCallback(
    async (assignmentId: string, status: AssignmentStatus, options?: { skipSallaSync?: boolean; suppressError?: boolean }) => {
      setPendingAction(`${assignmentId}_${status}`);
      try {
        const response = await fetch(`/api/order-prep/orders/${assignmentId}/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status,
            skipSallaSync: Boolean(options?.skipSallaSync),
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'فشل تحديث حالة الطلب');
        }

        setAssignments((prev) => {
          if (status === 'completed') {
            return prev.filter((assignment) => assignment.id !== assignmentId);
          }
          return prev.map((assignment) =>
            assignment.id === assignmentId ? data.assignment : assignment
          );
        });

        if (status === 'completed') {
          toast({ description: '🎉 تم إنهاء الطلب، يمكنك طلب طلب جديد الآن' });
        } else if (status === 'preparing') {
          toast({ description: '🔄 تم تحديث الطلب إلى جاري التجهيز' });
        } else if (status === 'waiting') {
          toast({ description: '⌛ تم وضع الطلب في قائمة الانتظار' });
        }

        if (status === 'completed') {
          void loadAssignments({ silent: true });
        }
      } catch (err) {
        if (!options?.suppressError) {
          toast({
            variant: 'destructive',
            description: err instanceof Error ? err.message : 'فشل تحديث حالة الطلب',
          });
        } else {
          console.warn('Auto status update failed', err);
        }
      } finally {
        setPendingAction(null);
      }
    },
    [loadAssignments, toast],
  );

  const handlePrintOrderNumber = useCallback(
    async (assignment: Assignment) => {
      const reference = assignment.orderNumber || assignment.orderReference || assignment.orderId;
      if (!reference) {
        toast({
          variant: 'destructive',
          description: 'رقم الطلب غير متوفر للطباعة',
        });
        return;
      }

      setPrintingOrderId(assignment.id);

      try {
        const response = await fetch('/api/order-prep/print-order-number', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderNumber: reference,
            orderId: assignment.orderId,
            printDate: new Date().toISOString(),
          }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'فشل إرسال رقم الطلب للطابعة');
        }

        toast({ description: `تم إرسال رقم الطلب ${reference} للطابعة` });
      } catch (err) {
        console.error('Print order number error:', err);
        toast({
          variant: 'destructive',
          description:
            err instanceof Error ? err.message : 'تعذر إرسال رقم الطلب للطابعة',
        });
      } finally {
        setPrintingOrderId(null);
      }
    },
    [toast],
  );

  const refreshAssignmentItems = useCallback(async (assignmentId: string) => {
    try {
      const response = await fetch(`/api/order-prep/orders/${assignmentId}/refresh-items`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'تعذر تحديث بيانات الطلب من سلة');
      }
      if (data.assignment) {
        setAssignments([data.assignment]);
        setLastUpdated(new Date().toISOString());
      }
    } catch (err) {
      console.error('Refresh order items error:', err);
    }
  }, []);

  const handleUpdateSallaStatus = useCallback(
    async (assignment: Assignment, target: 'under_review_a' | 'under_review_reservation' | 'under_review_inner') => {
      const actionKey = `${assignment.id}_${target}`;
      setSallaStatusAction(actionKey);

      try {
        const response = await fetch(
          `/api/order-prep/orders/${assignment.id}/salla-status`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target }),
          },
        );
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'تعذر تحديث حالة الطلب في سلة');
        }

        setAssignments((prev) => prev.filter((item) => item.id !== assignment.id));
        toast({ description: 'تم تحديث حالة الطلب في سلة وإعادة الطلب إلى قائمة الانتظار' });
        await loadAssignments({ silent: true });
      } catch (err) {
        console.error('Salla status update error:', err);
        toast({
          variant: 'destructive',
          description: err instanceof Error ? err.message : 'تعذر تحديث حالة الطلب في سلة',
        });
      } finally {
        setSallaStatusAction(null);
      }
    },
    [loadAssignments, toast],
  );

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const assignmentsCount = assignments.length;
  const activeAssignment = assignments[0] ?? null;
  const isBusy =
    loading || assigning || Boolean(pendingAction || sallaStatusAction || printingOrderId);

  useEffect(() => {
    if (activeAssignment && !refreshedAssignments.current.has(activeAssignment.id)) {
      refreshedAssignments.current.add(activeAssignment.id);
      void refreshAssignmentItems(activeAssignment.id);
    }
  }, [activeAssignment, refreshAssignmentItems]);

  useEffect(() => {
    if (activeAssignment && activeAssignment.status === 'assigned' && !autoStartedAssignments.current.has(activeAssignment.id)) {
      autoStartedAssignments.current.add(activeAssignment.id);
      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.id === activeAssignment.id
            ? {
                ...assignment,
                status: 'preparing',
                startedAt: assignment.startedAt ?? new Date().toISOString(),
              }
            : assignment,
        ),
      );
      void updateStatus(activeAssignment.id, 'preparing', { skipSallaSync: true, suppressError: true });
    }
  }, [activeAssignment, updateStatus]);

  const runConfirmedAction = useCallback(() => {
    if (!confirmDialog) return;
    const { type, assignment } = confirmDialog;
    if (type === 'complete') {
      void updateStatus(assignment.id, 'completed');
    } else {
      void handleUpdateSallaStatus(
        assignment,
        type as 'under_review_a' | 'under_review_reservation' | 'under_review_inner',
      );
    }
    setConfirmDialog(null);
  }, [confirmDialog, updateStatus, handleUpdateSallaStatus]);

  const confirmConfig: Record<
    'complete' | 'under_review_a' | 'under_review_reservation' | 'under_review_inner',
    { message: string; confirmLabel: string; variant?: 'primary' | 'danger' }
  > = {
    complete: {
      message: 'هل أنت متأكد من إنهاء الطلب الحالي؟ سيتم اعتباره مكتمل ولن تتمكن من التعديل عليه.',
      confirmLabel: 'إنهاء الطلب',
      variant: 'danger',
    },
    under_review_a: {
      message: 'سيتم إعادة الطلب إلى حالة "تحت المراجعة". هل تريد المتابعة؟',
      confirmLabel: 'تأكيد الإرجاع',
    },
    under_review_reservation: {
      message: 'سيتم وضع الطلب في حالة "تحت المراجعة - حجز قطع". تأكيد العملية؟',
      confirmLabel: 'تأكيد النقل',
    },
    under_review_inner: {
      message: 'سيتم تحويل الطلب إلى "تحت المراجعة ا". هل أنت متأكد؟',
      confirmLabel: 'تأكيد التحويل',
    },
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-gray-500">مسؤول الطلبات</p>
          <h1 className="text-2xl font-bold text-gray-900">لوحة تجهيز الطلبات</h1>
          <p className="text-sm text-gray-500 mt-1">
            يتم تعيين أقدم طلب جديد من سلة عند تسجيل الدخول أو بطلب المستخدم
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            onClick={() => loadAssignments()}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4 ml-2" />
            )}
            تحديث
          </Button>
          <Button
            onClick={requestNewOrder}
            disabled={assigning || assignmentsCount > 0}
            className="w-full sm:w-auto"
          >
            {assigning ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <Package className="h-4 w-4 ml-2" />
            )}
            طلب طلب جديد
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm text-gray-500">الطلبات الحالية</div>
          <div className="text-3xl font-bold text-gray-900">{assignmentsCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">آخر تحديث</div>
          <div className="text-lg font-semibold text-gray-900">
            {lastUpdated ? formatDate(lastUpdated) : '—'}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">الحالة</div>
          <div className="text-lg font-semibold text-gray-900">
            {isBusy ? 'قيد التحديث' : 'جاهز'}
          </div>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
        </div>
      ) : !activeAssignment ? (
        <Card className="p-10 text-center">
          <Package className="mx-auto mb-4 h-10 w-10 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900">لا توجد طلبات حالياً</h3>
          <p className="text-sm text-gray-500 mt-2">
            كل الطلبات الجديدة تم توزيعها. اضغط على زر طلب جديد للتحديث والتحقق من طلبات سلة المباشرة.
          </p>
        </Card>
      ) : (
        <AssignmentCard
          key={activeAssignment.id}
          assignment={activeAssignment}
          pendingAction={pendingAction}
          onStatusChange={updateStatus}
          onPrintOrderNumber={handlePrintOrderNumber}
          printingOrderId={printingOrderId}
          onUpdateSallaStatus={handleUpdateSallaStatus}
          sallaStatusAction={sallaStatusAction}
          onConfirmComplete={() => setConfirmDialog({ type: 'complete', assignment: activeAssignment })}
          onConfirmSallaStatus={(target) => setConfirmDialog({ type: target, assignment: activeAssignment })}
        />
      )}
      <ConfirmationDialog
        open={Boolean(confirmDialog)}
        title="تأكيد العملية"
        message={confirmDialog ? confirmConfig[confirmDialog.type].message : ''}
        confirmLabel={confirmDialog ? confirmConfig[confirmDialog.type].confirmLabel : 'تأكيد'}
        confirmVariant={
          confirmDialog ? confirmConfig[confirmDialog.type].variant ?? 'primary' : 'primary'
        }
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmDialog(null)}
      />
    </section>
  );
}

function AssignmentCard({
  assignment,
  pendingAction,
  onStatusChange,
  onPrintOrderNumber,
  printingOrderId,
  onUpdateSallaStatus,
  sallaStatusAction,
  onConfirmComplete,
  onConfirmSallaStatus,
}: {
  assignment: Assignment;
  pendingAction: string | null;
  onStatusChange: (assignmentId: string, status: AssignmentStatus) => void;
  onPrintOrderNumber: (assignment: Assignment) => void;
  printingOrderId: string | null;
  onUpdateSallaStatus: (assignment: Assignment, target: 'under_review_a' | 'under_review_reservation' | 'under_review_inner') => void;
  sallaStatusAction: string | null;
  onConfirmComplete: () => void;
  onConfirmSallaStatus: (target: 'under_review_a' | 'under_review_reservation' | 'under_review_inner') => void;
}) {
  const items = getLineItems(assignment.orderData);
  const orderStatus = getOrderStatus(assignment.orderData);
  const orderNumber = assignment.orderNumber || assignment.orderReference || assignment.orderId;
  const statusMeta = assignmentStatusMeta[assignment.status];
  const actionKey = (status: AssignmentStatus) => `${assignment.id}_${status}`;
  const waitingDisabled = assignment.status === 'waiting';
  const completedDisabled = assignment.status === 'completed';
  const itemsCount = items.reduce<number>((sum, item) => sum + (item.quantity || 0), 0);

  return (
    <Card className="overflow-hidden border border-gray-200 shadow-sm">
      <div className="border-b border-gray-100 bg-white px-6 py-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs text-gray-400">رقم الطلب</p>
          <h2 className="text-lg font-semibold text-gray-900">#{orderNumber}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', statusMeta.className)}>
            {statusMeta.label}
          </span>
          {orderStatus && (
            <span
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold',
                orderStatusColors.get(orderStatus.slug) || 'bg-gray-50 text-gray-800 border-gray-200'
              )}
            >
              {orderStatus.name}
            </span>
          )}
        </div>
      </div>

      <div className="px-6 py-5 space-y-5 bg-white">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">المنتجات ({itemsCount})</h3>
            <span className="text-xs text-gray-500">
              تم التحديث {formatRelativeTime(assignment.lastStatusUpdateAt || assignment.assignedAt)}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-500">
                لا توجد بيانات للمنتجات داخل هذا الطلب حتى الآن.
              </div>
            ) : (
              items.map((item: LineItem, index: number) => (
                <div
                  key={`${item.sku ?? 'item'}-${index}`}
                  className="flex flex-col sm:flex-row gap-3 rounded-lg border border-gray-100 p-3"
                >
                  {item.image && (
                    <Image
                      src={item.image}
                      alt={item.name || item.sku || 'منتج'}
                      width={256}
                      height={256}
                      unoptimized
                      className="w-full h-full rounded-md object-cover border border-gray-100 sm:w-16 sm:h-16"
                    />
                  )}
                  <div className="flex-1">
                    <p className="text-base font-semibold text-gray-900">
                      {item.name || 'منتج بدون اسم'}
                    </p>
                    <p className="text-sm font-semibold text-gray-800 mt-1">
                      {item.sku || 'بدون رمز'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-600">
                      <span className="font-semibold text-gray-900">
                        الكمية: {item.quantity || 1}
                      </span>
                      {item.color && (
                        <span className="inline-flex items-center gap-1 font-semibold text-gray-900">
                          <span className="text-gray-500">اللون:</span>
                          <span>{item.color}</span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 font-semibold text-gray-900">
                        <span className="text-gray-500">المقاس:</span>
                        <span>{item.size || '-'}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <span className="text-gray-500">موقع المخزون:</span>
                        <span className="font-semibold">{item.location || '-'}</span>
                      </span>
                    </div>
                    {item.locationNotes && (
                      <p className="text-xs text-gray-500 mt-1">{item.locationNotes}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              variant="outline"
              onClick={() => onPrintOrderNumber(assignment)}
              disabled={printingOrderId === assignment.id}
              className="w-full sm:w-auto"
            >
              {printingOrderId === assignment.id ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 ml-2" />
              )}
              طباعة رقم الطلب
            </Button>
            <Button
              onClick={onConfirmComplete}
              disabled={completedDisabled || pendingAction === actionKey('completed')}
              className="w-full sm:w-auto"
            >
              {pendingAction === actionKey('completed') ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <Package className="h-4 w-4 ml-2" />
              )}
              إنهاء الطلب
            </Button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              variant="outline"
              onClick={() => onConfirmSallaStatus('under_review_a')}
              disabled={sallaStatusAction === `${assignment.id}_under_review_a`}
              className="w-full sm:w-auto"
            >
              {sallaStatusAction === `${assignment.id}_under_review_a` ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4 ml-2" />
              )}
              تحديث سلة: تحت المراجعة
            </Button>
            <Button
              variant="outline"
              onClick={() => onConfirmSallaStatus('under_review_reservation')}
              disabled={sallaStatusAction === `${assignment.id}_under_review_reservation`}
              className="w-full sm:w-auto"
            >
              {sallaStatusAction === `${assignment.id}_under_review_reservation` ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4 ml-2" />
              )}
              تحديث سلة: تحت المراجعة (حجز)
            </Button>
            <Button
              variant="outline"
              onClick={() => onConfirmSallaStatus('under_review_inner')}
              disabled={sallaStatusAction === `${assignment.id}_under_review_inner`}
              className="w-full sm:w-auto"
            >
              {sallaStatusAction === `${assignment.id}_under_review_inner` ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4 ml-2" />
              )}
              تحديث سلة: تحت المراجعة ا
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function getLineItems(order: any): LineItem[] {
  const list = Array.isArray(order?.items)
    ? order.items
    : Array.isArray(order?.order?.items)
    ? order.order.items
    : [];

  return list.map((item: any): LineItem => {
    const image =
      item?.images?.[0]?.url ||
      item?.images?.[0]?.src ||
      item?.product?.thumbnail ||
      item?.product?.image ||
      null;
    const sku = item?.sku || item?.product?.sku || null;
    const name = item?.name || item?.product?.name || null;
    const color = extractAttributeValue(item, ['color', 'color_name', 'colour', 'اللون']);
    const size = extractAttributeValue(item, ['size', 'size_name', 'المقاس', 'variant_size']);
    const location = item?.inventoryLocation || item?.inventory_location || null;
    const locationNotes = item?.inventoryNotes || item?.inventory_notes || null;
    return {
      sku,
      name,
      quantity: item?.quantity || 1,
      image,
      color,
      size,
      location,
      locationNotes,
    };
  });
}

function extractAttributeValue(item: any, attributeNames: string[]): string | null {
  const normalizedKeys = attributeNames.map((name) => name.toLowerCase());
  const includesSize = normalizedKeys.some(
    (key) => key.includes('size') || key.includes('مقاس'),
  );
  const includesColor = normalizedKeys.some(
    (key) => key.includes('color') || key.includes('لون'),
  );
  const matchesKey = (key?: string | null) => {
    if (!key) return false;
    const normalized = key.toLowerCase();
    return normalizedKeys.some(
      (target) => normalized === target || normalized.includes(target),
    );
  };
  const normalizeValue = (value: any): string | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    if (typeof value === 'object') {
      return value?.name || value?.value || value?.label || null;
    }
    return null;
  };

  const directLookup = (source: any): string | null => {
    if (!source || typeof source !== 'object') {
      return null;
    }
    for (const key of Object.keys(source)) {
      if (matchesKey(key)) {
        const result = normalizeValue(source[key]);
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  const relatedFields = (source: any): string | null => {
    if (!source || typeof source !== 'object') {
      return null;
    }
    for (const key of Object.keys(source)) {
      if (matchesKey(key)) {
        const result = normalizeValue(source[key]);
        if (result) return result;
      }
    }
    return null;
  };

  const searchArray = (arr: any): string | null => {
    if (!Array.isArray(arr)) {
      return null;
    }
    for (const entry of arr) {
      const key =
        entry?.name ??
        entry?.label ??
        entry?.title ??
        entry?.key ??
        entry?.option ??
        entry?.option_name ??
        entry?.optionName ??
        entry?.id ??
        '';
      if (matchesKey(key?.toString())) {
        const result = normalizeValue(entry?.value ?? entry?.name ?? entry?.label);
        if (result) {
          return result;
        }
      }
    }
    return null;
  };

  const objectSources = [item, item?.product, item?.details, item?.variant];
  for (const source of objectSources) {
    const result = directLookup(source);
    if (result) {
      return result;
    }
  }

  for (const source of objectSources) {
    const result = relatedFields(source);
    if (result) {
      return result;
    }
  }

  const arraySources = [
    item?.options,
    item?.attributes,
    item?.variant?.options,
    item?.variant?.attributes,
    item?.variant?.values,
    item?.product?.options,
    item?.details?.options,
  ];
  for (const arr of arraySources) {
    const result = searchArray(arr);
    if (result) {
      return result;
    }
  }

  const variantName = item?.variant?.name || item?.variant?.value || item?.variant?.label || null;
  if (variantName) {
    const parts = variantName.split(/[\/\-|،]/).map((part: string) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      if (includesColor) {
        return parts[0];
      }
      if (includesSize) {
        return parts[parts.length - 1];
      }
    } else if (parts.length === 1) {
      if (includesColor || includesSize) {
        return parts[0];
      }
    }
  }
  return null;
}

function getOrderStatus(order: any) {
  const status = order?.status || order?.order?.status || null;
  if (!status) {
    return null;
  }
  const slug =
    status.slug ||
    status.code ||
    status.status ||
    status.name ||
    status.id ||
    null;

  const normalizedSlug = typeof slug === 'string' ? slug : slug?.toString();
  const name = status.name || status.label || normalizedSlug || '';

  return normalizedSlug ? { slug: normalizedSlug, name } : { slug: '', name };
}

function formatCurrency(value: unknown, currency?: string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return '—';
  }
  const safeCurrency = currency || 'SAR';
  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: safeCurrency,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${safeCurrency}`;
  }
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

function formatRelativeTime(value: string) {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return 'منذ لحظات';
  }
  const diff = Date.now() - target;
  if (diff < 60000) {
    return 'منذ لحظات';
  }
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) {
    return `منذ ${minutes} دقيقة`;
  }
  const hours = Math.floor(minutes / 60);
  return `منذ ${hours} ساعة`;
}
