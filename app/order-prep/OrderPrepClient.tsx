'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle, Loader2, Package, Printer, RefreshCcw, Undo2 } from 'lucide-react';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/components/ui/use-toast';
import { getShippingAddressSummary, getShippingCompanyName } from '@/app/lib/shipping-company';

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
  options: any[];
  product?: Record<string, unknown> | null;
  variant?: Record<string, unknown> | null;
  code?: string | null;
}

interface ProductLocation {
  id: string;
  sku: string;
  location: string;
  productName?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

interface UnavailableItemRecord {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  sku: string;
  normalizedSku: string;
  itemName?: string | null;
  reportedById?: string | null;
  reportedByName?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

type SallaStatusTarget =
  | 'under_review_a'
  | 'under_review_reservation'
  | 'under_review_inner'
  | 'under_review_x4';
type ConfirmDialogType = 'complete';
type ItemProgressState = 'ready' | 'comingSoon' | 'unavailable';
const itemProgressLabels: Record<ItemProgressState, string> = {
  ready: 'تم التجهيز',
  comingSoon: 'سيتوفر قريبًا',
  unavailable: 'غير متوفر',
};

interface ItemStatusPayload {
  index: number;
  sku: string | null;
  normalizedSku: string | null;
  name: string | null;
  status: ItemProgressState;
}

interface CompletionSummary {
  allReady: boolean;
  hasComingSoon: boolean;
  hasUnavailable: boolean;
  allUnavailable: boolean;
  singleUnavailable: boolean;
  missingRecordsValid: boolean;
  note: string;
  itemStatuses: ItemStatusPayload[];
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

const getStringValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.label === 'string') return obj.label;
    if (obj.value !== undefined) {
      return getStringValue(obj.value);
    }
    return JSON.stringify(obj);
  }
  return '';
};

const normalizeSku = (value: unknown): string => {
  const stringValue = getStringValue(value);
  if (!stringValue) return '';
  return stringValue.trim().toUpperCase();
};

const generateSkuVariants = (value: unknown): string[] => {
  const normalized = normalizeSku(value);
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(normalized);

  const segments = normalized.split(/[^A-Z0-9]+/).filter(Boolean);
  segments.forEach((segment) => variants.add(segment));

  const withoutTrailingLetters = normalized.replace(/[A-Z]+$/g, '');
  if (withoutTrailingLetters && withoutTrailingLetters !== normalized) {
    variants.add(withoutTrailingLetters);
  }

  const withoutTrailingDigits = normalized.replace(/\d+$/g, '');
  if (withoutTrailingDigits && withoutTrailingDigits !== normalized) {
    variants.add(withoutTrailingDigits);
  }

  return Array.from(variants).filter((sku) => sku.length >= 3);
};

const extractLineItemSku = (item: LineItem): string => {
  if (!item) return '';
  const candidates = [
    item.sku,
    item.code,
    (item.product as Record<string, unknown> | undefined)?.sku,
    (item.product as Record<string, unknown> | undefined)?.code,
    (item.variant as Record<string, unknown> | undefined)?.sku,
    (item.variant as Record<string, unknown> | undefined)?.code,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number') {
      return candidate.toString();
    }
  }

  return '';
};

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
    type: ConfirmDialogType;
    assignment: Assignment;
    completion: CompletionSummary;
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
        const assignmentsList: Assignment[] = Array.isArray(data.assignments)
          ? (data.assignments as Assignment[])
          : [];
        const prioritized =
          assignmentsList.find((assignment) => assignment.status === 'preparing') ||
          assignmentsList.find((assignment) => assignment.status === 'waiting') ||
          assignmentsList[0] ||
          null;
        setAssignments(prioritized ? [prioritized] : []);
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

  const assignNextOrder = useCallback(
    async (options: { silent?: boolean } = {}) => {
      try {
        const response = await fetch('/api/order-prep/orders/assign', {
          method: 'POST',
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'لا توجد طلبات جديدة متاحة');
        }
        if (data.assignment) {
          setAssignments([data.assignment]);
          if (!options.silent) {
            toast({ description: '✅ تم تعيين طلب جديد لك' });
          }
          setLastUpdated(new Date().toISOString());
        } else if (!options.silent) {
          toast({ description: '⚠️ لا توجد طلبات جديدة حالياً' });
        }
        return data.assignment as Assignment | null;
      } catch (err) {
        if (!options.silent) {
          toast({
            variant: 'destructive',
            description: err instanceof Error ? err.message : 'تعذر الحصول على طلب جديد',
          });
        }
        return null;
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
      await assignNextOrder();
    } finally {
      setAssigning(false);
    }
  }, [assignments.length, assignNextOrder, toast]);

  const updateStatus = useCallback(
    async (
      assignmentId: string,
      status: AssignmentStatus,
      options?: { skipSallaSync?: boolean; suppressError?: boolean; itemStatuses?: ItemStatusPayload[] },
    ) => {
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
            itemStatuses: options?.itemStatuses ?? undefined,
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
          toast({ description: '🎉 تم إنهاء الطلب، جارٍ تحميل الطلب التالي' });
        } else if (status === 'preparing') {
          toast({ description: '🔄 تم تحديث الطلب إلى جاري التجهيز' });
        } else if (status === 'waiting') {
          toast({ description: '⌛ تم وضع الطلب في قائمة الانتظار' });
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
    async (assignment: Assignment, target: SallaStatusTarget, note?: string) => {
      const actionKey = `${assignment.id}_${target}`;
      setSallaStatusAction(actionKey);

      try {
        const trimmedNote = typeof note === 'string' ? note.trim() : '';
        const response = await fetch(
          `/api/order-prep/orders/${assignment.id}/salla-status`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              target,
              note: trimmedNote ? trimmedNote : undefined,
            }),
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

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const assignmentsCount = assignments.length;
  const activeAssignment = assignments[0] ?? null;
  const isBusy =
    loading || assigning || Boolean(pendingAction || sallaStatusAction || printingOrderId);

  useEffect(() => {
    // Automatically refresh line items once per assignment to keep quantities current
    if (activeAssignment && !refreshedAssignments.current.has(activeAssignment.id)) {
      refreshedAssignments.current.add(activeAssignment.id);
      void refreshAssignmentItems(activeAssignment.id);
    }
  }, [activeAssignment, refreshAssignmentItems]);

  useEffect(() => {
    if (
      activeAssignment &&
      activeAssignment.status === 'assigned' &&
      !autoStartedAssignments.current.has(activeAssignment.id)
    ) {
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
      void updateStatus(activeAssignment.id, 'preparing', {
        skipSallaSync: true,
        suppressError: true,
      });
    }
  }, [activeAssignment, updateStatus]);

  const handleCompleteFlow = useCallback(
    async (assignment: Assignment, completion: CompletionSummary): Promise<boolean> => {
    if (completion.hasUnavailable && !completion.missingRecordsValid) {
      toast({
        variant: 'destructive',
        description: 'يرجى تسجيل النواقص لكل منتج تم وضعه كغير متوفر قبل إنهاء الطلب.',
      });
      return false;
    }

    const reference = assignment.orderNumber || assignment.orderReference || assignment.orderId;

    if (completion.allUnavailable || completion.singleUnavailable) {
      const note =
        completion.note && completion.note.trim()
          ? completion.note
          : `تم تحويل الطلب (${reference}) إلى حالة غير متوفر (إرجاع مبلغ) بعد تسجيل جميع القطع المفقودة.`;
      await handleUpdateSallaStatus(assignment, 'under_review_x4', note);
      return true;
    }

    if (completion.hasComingSoon) {
      const note =
        completion.note && completion.note.trim()
          ? completion.note
          : `تم تحويل الطلب (${reference}) إلى تحت المراجعة لوجود منتجات سيتم توفيرها لاحقاً.`;
      await handleUpdateSallaStatus(assignment, 'under_review_a', note);
      return true;
    }

    await updateStatus(assignment.id, 'completed', {
      itemStatuses: completion.itemStatuses,
    });
    const nextAssignment = await assignNextOrder({ silent: true });
    if (!nextAssignment) {
      toast({ description: 'لا توجد طلبات جديدة متاحة حالياً.' });
    }
    return true;
  },
    [assignNextOrder, handleUpdateSallaStatus, toast, updateStatus],
  );

  const runConfirmedAction = useCallback(() => {
    if (!confirmDialog) return;
    const { assignment, completion } = confirmDialog;
    void (async () => {
      const success = await handleCompleteFlow(assignment, completion);
      if (success) {
        closeConfirmDialog();
      }
    })();
  }, [confirmDialog, closeConfirmDialog, handleCompleteFlow]);

  const confirmConfig: Record<
    ConfirmDialogType,
    { message: string; confirmLabel: string; variant?: 'primary' | 'danger' }
  > = {
    complete: {
      message: 'هل أنت متأكد من إنهاء الطلب الحالي؟ سيتم اعتباره مكتمل ولن تتمكن من التعديل عليه.',
      confirmLabel: 'إنهاء الطلب',
      variant: 'danger',
    },
  };
  const notePreview =
    confirmDialog?.completion?.note && confirmDialog.completion.note.trim() ? (
      <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 whitespace-pre-line">
        {confirmDialog.completion.note}
      </div>
    ) : null;

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
          onPrintOrderNumber={handlePrintOrderNumber}
          printingOrderId={printingOrderId}
          isSallaUpdating={Boolean(sallaStatusAction)}
          onConfirmComplete={({ assignment, summary }) => {
            setConfirmDialog({
              type: 'complete',
              assignment,
              completion: summary,
            });
          }}
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
        onCancel={closeConfirmDialog}
        content={notePreview}
      />
    </section>
  );
}

interface CompletionRequest {
  assignment: Assignment;
  summary: CompletionSummary;
}

function AssignmentCard({
  assignment,
  pendingAction,
  onPrintOrderNumber,
  printingOrderId,
  isSallaUpdating,
  onConfirmComplete,
}: {
  assignment: Assignment;
  pendingAction: string | null;
  onPrintOrderNumber: (assignment: Assignment) => void;
  printingOrderId: string | null;
  isSallaUpdating: boolean;
  onConfirmComplete: (request: CompletionRequest) => void;
}) {
  const items = useMemo(() => getLineItems(assignment.orderData), [assignment.orderData]);
  const orderStatus = getOrderStatus(assignment.orderData);
  const orderNumber = assignment.orderNumber || assignment.orderReference || assignment.orderId;
  const statusMeta = assignmentStatusMeta[assignment.status];
  const actionKey = (status: AssignmentStatus) => `${assignment.id}_${status}`;
  const completedDisabled = assignment.status === 'completed';
  const itemsCount = items.reduce<number>((sum, item) => sum + (item.quantity || 0), 0);
  const orderTags = Array.isArray(assignment.orderData?.tags) ? assignment.orderData.tags : [];
  const shippingCompanyName = useMemo(
    () => getShippingCompanyName(assignment.orderData),
    [assignment.orderData],
  );
  const shippingAddress = useMemo(
    () => getShippingAddressSummary(assignment.orderData),
    [assignment.orderData],
  );
  const shippingAddressLabel =
    shippingAddress.addressLine || shippingAddress.locationLabel || null;
  const shippingLocationHint =
    shippingAddress.addressLine && shippingAddress.locationLabel
      ? shippingAddress.locationLabel
      : null;
  const { toast } = useToast();
  const getItemKey = useCallback((index: number) => `${assignment.id}_${index}`, [assignment.id]);
  const [itemProgress, setItemProgress] = useState<Record<string, ItemProgressState>>({});
  const [unavailableItems, setUnavailableItems] = useState<UnavailableItemRecord[]>([]);
  const [unavailableActionKey, setUnavailableActionKey] = useState<string | null>(null);
  const [productLocations, setProductLocations] = useState<Record<string, ProductLocation>>({});
  const [loadingProductLocations, setLoadingProductLocations] = useState(false);
  const [productLocationError, setProductLocationError] = useState<string | null>(null);
  const [printingSkuKey, setPrintingSkuKey] = useState<string | null>(null);
  const [resolvingUnavailableId, setResolvingUnavailableId] = useState<string | null>(null);
  const [itemActionDialog, setItemActionDialog] = useState<{
    type: ItemProgressState;
    itemName: string;
    sku: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const currentSkus = useMemo(() => {
    const variants = new Set<string>();
    items.forEach((item) => {
      const sku = extractLineItemSku(item);
      generateSkuVariants(sku).forEach((variant) => variants.add(variant));
    });
    return Array.from(variants);
  }, [items]);

  useEffect(() => {
    if (!assignment.orderId) {
      setUnavailableItems([]);
      return;
    }
    const controller = new AbortController();
    const loadUnavailableItems = async () => {
      try {
        const response = await fetch(
          `/api/order-prep/unavailable-items?orderId=${encodeURIComponent(assignment.orderId)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'تعذر تحميل قائمة النواقص');
        }
        setUnavailableItems(Array.isArray(data?.data) ? data.data : []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        toast({
          variant: 'destructive',
          description: error instanceof Error ? error.message : 'تعذر تحميل قائمة النواقص',
        });
      }
    };

    loadUnavailableItems();

    return () => {
      controller.abort();
    };
  }, [assignment.orderId, toast]);

  useEffect(() => {
    setItemProgress({});
    setUnavailableActionKey(null);
  }, [assignment.id]);

  useEffect(() => {
    setItemProgress((prev) => {
      const next: Record<string, ItemProgressState> = {};
      items.forEach((item, index) => {
        const key = getItemKey(index);
        const normalizedSku = normalizeSku(extractLineItemSku(item));
        if (normalizedSku) {
          const hasUnavailable = unavailableItems.some(
            (record) => record.normalizedSku === normalizedSku,
          );
          if (hasUnavailable) {
            next[key] = 'unavailable';
            return;
          }
        }
        const previous = prev[key];
        if (previous === 'comingSoon') {
          next[key] = 'comingSoon';
          return;
        }
        if (previous === 'ready') {
          next[key] = 'ready';
          return;
        }
      });
      return next;
    });
  }, [getItemKey, items, unavailableItems]);

  useEffect(() => {
    let cancelled = false;
    if (currentSkus.length === 0) {
      setProductLocations({});
      setProductLocationError(null);
      setLoadingProductLocations(false);
      return () => {
        cancelled = true;
      };
    }

    const fetchLocations = async () => {
      setLoadingProductLocations(true);
      setProductLocationError(null);
      try {
        const response = await fetch('/api/order-prep/product-locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skus: currentSkus }),
        });
        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'تعذر تحميل مواقع المنتجات');
        }
        const map: Record<string, ProductLocation> = {};
        (Array.isArray(data?.locations) ? data.locations : []).forEach((location: ProductLocation) => {
          const normalizedSku = normalizeSku(location?.sku);
          if (normalizedSku) {
            map[normalizedSku] = location;
          }
        });
        if (!cancelled) {
          setProductLocations(map);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر تحميل مواقع المنتجات';
        if (!cancelled) {
          setProductLocations({});
          setProductLocationError(message);
        }
      } finally {
        if (!cancelled) {
          setLoadingProductLocations(false);
        }
      }
    };

    fetchLocations();

    return () => {
      cancelled = true;
    };
  }, [currentSkus]);

  const getLocationForSku = useCallback(
    (sku: unknown): ProductLocation | undefined => {
      const normalizedSku = normalizeSku(sku);
      if (!normalizedSku) {
        return undefined;
      }

      const directMatch = productLocations[normalizedSku];
      if (directMatch) {
        return directMatch;
      }

      let bestMatch: ProductLocation | undefined;
      let bestMatchLength = 0;

      for (const location of Object.values(productLocations)) {
        const locationSku = normalizeSku(location?.sku);
        if (!locationSku) {
          continue;
        }
        if (normalizedSku.includes(locationSku) || locationSku.includes(normalizedSku)) {
          if (!bestMatch || locationSku.length > bestMatchLength) {
            bestMatch = location;
            bestMatchLength = locationSku.length;
          }
        }
      }

      return bestMatch;
    },
    [productLocations]
  );

  const getUnavailableRecord = useCallback(
    (normalizedSku: string): UnavailableItemRecord | null => {
      if (!normalizedSku) {
        return null;
      }
      return unavailableItems.find((record) => record.normalizedSku === normalizedSku) || null;
    },
    [unavailableItems],
  );

  const updateItemProgress = useCallback(
    (index: number, status: ItemProgressState) => {
      const key = getItemKey(index);
      setItemProgress((prev) => ({
        ...prev,
        [key]: status,
      }));
    },
    [getItemKey],
  );

  const handleMarkUnavailable = useCallback(
    async (item: LineItem, index: number) => {
      const rawSku = extractLineItemSku(item);
      const normalizedSku = normalizeSku(rawSku);
      if (!normalizedSku) {
        toast({
          variant: 'destructive',
          description: 'لا يمكن تسجيل نقص لهذا المنتج لأنه بدون SKU.',
        });
        return;
      }
      const actionKeyValue = `${assignment.id}_${normalizedSku}`;
      setUnavailableActionKey(actionKeyValue);
      try {
        const response = await fetch('/api/order-prep/unavailable-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: assignment.orderId,
            orderNumber,
            sku: rawSku || normalizedSku,
            itemName: item.name || null,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'تعذر تسجيل النقص');
        }
        const record: UnavailableItemRecord | null = data?.data || null;
        if (record) {
          setUnavailableItems((prev) => {
            const filtered = prev.filter((entry) => entry.normalizedSku !== record.normalizedSku);
            return [record, ...filtered];
          });
          updateItemProgress(index, 'unavailable');
        }
        const skuLabel = record?.sku || normalizedSku;
        toast({
          description: `تم تسجيل النقص للمنتج ${skuLabel}`,
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          description: error instanceof Error ? error.message : 'تعذر تسجيل النقص',
        });
      } finally {
        setUnavailableActionKey((current) => (current === actionKeyValue ? null : current));
      }
    },
    [assignment.id, assignment.orderId, getItemKey, orderNumber, toast, updateItemProgress],
  );

  const handleResolveUnavailable = useCallback(
    async (record: UnavailableItemRecord, index: number) => {
      if (!record?.id) {
        return;
      }
      setResolvingUnavailableId(record.id);
      try {
        const response = await fetch('/api/order-prep/unavailable-items', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordId: record.id }),
        });
        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'تعذر حذف سجل النقص');
        }
        setUnavailableItems((prev) => prev.filter((entry) => entry.id !== record.id));
        setItemProgress((prev) => {
          const key = getItemKey(index);
          if (prev[key] !== 'unavailable') {
            return prev;
          }
          const next = { ...prev };
          delete next[key];
          return next;
        });
        const skuLabel = record.sku || record.normalizedSku;
        toast({ description: `تم حذف سجل النقص للمنتج ${skuLabel}` });
      } catch (error) {
        toast({
          variant: 'destructive',
          description: error instanceof Error ? error.message : 'تعذر حذف سجل النقص',
        });
      } finally {
        setResolvingUnavailableId((current) => (current === record.id ? null : current));
      }
    },
    [getItemKey, toast],
  );

  const handlePrintSku = useCallback(
    async (item: LineItem, index: number) => {
      const rawSku = extractLineItemSku(item);
      if (!rawSku) {
        toast({
          variant: 'destructive',
          description: 'لا يمكن طباعة رمز المنتج لعدم توفر SKU واضح.',
        });
        return;
      }
      const key = `${assignment.id}_${index}`;
      setPrintingSkuKey(key);
      try {
        const response = await fetch('/api/order-prep/print-sku', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sku: rawSku,
            productName: item.name || undefined,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'تعذر طباعة رمز المنتج');
        }
        toast({ description: `تم إرسال SKU ${rawSku} للطابعة` });
      } catch (error) {
        toast({
          variant: 'destructive',
          description: error instanceof Error ? error.message : 'تعذر طباعة رمز المنتج',
        });
      } finally {
        setPrintingSkuKey((current) => (current === key ? null : current));
      }
    },
    [assignment.id, toast],
  );

  const openItemActionDialog = useCallback(
    (action: ItemProgressState, item: LineItem, index: number) => {
      const itemName = item.name || 'منتج بدون اسم';
      const sku = extractLineItemSku(item) || 'غير متوفر';
      setItemActionDialog({
        type: action,
        itemName,
        sku,
        onConfirm: () => {
          if (action === 'unavailable') {
            return handleMarkUnavailable(item, index);
          }
          updateItemProgress(index, action);
        },
      });
    },
    [handleMarkUnavailable, updateItemProgress],
  );

  const closeItemActionDialog = useCallback(() => {
    setItemActionDialog(null);
  }, []);

  const confirmItemAction = useCallback(() => {
    if (!itemActionDialog) {
      return;
    }
    const confirmAction = itemActionDialog.onConfirm;
    closeItemActionDialog();
    confirmAction();
  }, [closeItemActionDialog, itemActionDialog]);

  const progressValues = items.map((_, idx) => itemProgress[getItemKey(idx)]);
  const hasComingSoon = progressValues.includes('comingSoon');
  const hasUnavailable = progressValues.includes('unavailable');
  const allUnavailable = items.length > 0 && progressValues.every((value) => value === 'unavailable');
  const allReady = !hasComingSoon && !hasUnavailable && progressValues.every((value) => value === 'ready');
  const actionsLocked = items.length > 0 && items.some((_, idx) => !itemProgress[getItemKey(idx)]);
  const pendingItemsCount = actionsLocked
    ? items.reduce((count, _, idx) => (itemProgress[getItemKey(idx)] ? count : count + 1), 0)
    : 0;

  const missingItemsSummary = useMemo(
    () =>
      items.reduce<Array<{ sku: string; name: string; status: 'unavailable' | 'comingSoon' }>>(
        (acc, item, index) => {
          const status = itemProgress[getItemKey(index)];
          if (status === 'unavailable' || status === 'comingSoon') {
                  acc.push({
                    sku: extractLineItemSku(item) || 'غير متوفر',
                    name: item.name || 'منتج بدون اسم',
                    status: status === 'comingSoon' ? 'comingSoon' : 'unavailable',
                  });
                }
          return acc;
        },
        [],
      ),
    [getItemKey, itemProgress, items],
  );

  const autoNote = useMemo(() => {
    if (items.length === 0) {
      return 'لا توجد منتجات مرتبطة بهذا الطلب عند وقت التحديث.';
    }
    if (missingItemsSummary.length === 0 && Object.keys(itemProgress).length === items.length) {
      return `تم تجهيز جميع منتجات الطلب (${orderNumber}). لا توجد نواقص مسجلة عند تغيير حالة الطلب.`;
    }

    if (missingItemsSummary.length === 0) {
      return `لا توجد نواقص مسجلة، لكن لم يتم تأكيد تجهيز جميع المنتجات للطلب (${orderNumber}) بعد.`;
    }

    const details = missingItemsSummary
      .map((item, idx) => {
        const statusLabel = item.status === 'comingSoon' ? 'سيتوفر قريباً' : 'غير متوفر';
        return `${idx + 1}- ${item.name} (SKU: ${item.sku || 'غير متوفر'}) - ${statusLabel}`;
      })
      .join('\n');

    return `المنتجات غير الجاهزة للطلب (${orderNumber}):\n${details}`;
  }, [itemProgress, items.length, missingItemsSummary, orderNumber]);

  const missingRecordsValid = useMemo(
    () =>
      items.every((item, index) => {
        if (itemProgress[getItemKey(index)] !== 'unavailable') {
          return true;
        }
        const normalizedItemSku = normalizeSku(extractLineItemSku(item));
        if (!normalizedItemSku) {
          return false;
        }
        return Boolean(getUnavailableRecord(normalizedItemSku));
      }),
    [getItemKey, getUnavailableRecord, itemProgress, items],
  );

  const itemStatuses = useMemo<ItemStatusPayload[]>(
    () =>
      items
        .map((item, index) => {
          const status = itemProgress[getItemKey(index)];
          if (!status) return null;
          const sku = extractLineItemSku(item);
          const normalizedSku = normalizeSku(sku);
          return {
            index,
            sku: sku || null,
            normalizedSku: normalizedSku || null,
            name: item.name || null,
            status,
          };
        })
        .filter((value): value is ItemStatusPayload => Boolean(value)),
    [getItemKey, itemProgress, items],
  );

  const completionSummary = useMemo(
    () => ({
      allReady,
      hasComingSoon,
      hasUnavailable,
      allUnavailable,
      singleUnavailable: items.length === 1 && progressValues[0] === 'unavailable',
      missingRecordsValid,
      note: autoNote,
      itemStatuses,
    }),
    [
      allReady,
      allUnavailable,
      autoNote,
      hasComingSoon,
      hasUnavailable,
      itemStatuses,
      items.length,
      missingRecordsValid,
      progressValues,
    ],
  );
  const itemActionMessage = useMemo(() => {
    if (!itemActionDialog) {
      return '';
    }
    const actionLabel = itemProgressLabels[itemActionDialog.type];
    const skuLabel = itemActionDialog.sku || 'غير متوفر';
    if (itemActionDialog.type === 'unavailable') {
      return `سيتم تسجيل المنتج "${itemActionDialog.itemName}" (SKU: ${skuLabel}) كغير متوفر وإضافته إلى قائمة النواقص. هل تريد المتابعة؟`;
    }
    return `هل تريد تأكيد وضع المنتج "${itemActionDialog.itemName}" (SKU: ${skuLabel}) في حالة "${actionLabel}"؟`;
  }, [itemActionDialog]);
  const itemActionConfirmLabel = itemActionDialog
    ? `تأكيد ${itemProgressLabels[itemActionDialog.type]}`
    : 'تأكيد';
  const itemActionConfirmVariant = itemActionDialog?.type === 'unavailable' ? 'danger' : 'primary';

  return (
    <>
      <Card className="overflow-hidden border border-gray-200 shadow-sm">
      <div className="border-b border-gray-100 bg-white px-6 py-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs text-gray-400">رقم الطلب</p>
          <h2 className="text-lg font-semibold text-gray-900">#{orderNumber}</h2>
          <p className="text-sm text-gray-600 mt-1">
            شركة الشحن:{' '}
            <span className="font-semibold text-gray-900">
              {shippingCompanyName || 'غير محددة'}
            </span>
          </p>
          <p className="text-sm text-gray-600">
            عنوان الشحن:{' '}
            <span className="font-semibold text-gray-900">
              {shippingAddressLabel || 'غير متوفر'}
            </span>
          </p>
          {shippingLocationHint && (
            <p className="text-xs text-gray-500">📍 {shippingLocationHint}</p>
          )}
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
        {orderTags.length > 0 && (
          <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              <h3 className="text-sm font-bold text-blue-900">علامات الطلب (Tags)</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {orderTags.map((tag: any, idx: number) => {
                const tagLabel =
                  typeof tag === 'string' ? tag : getStringValue(tag?.name ?? tag?.value ?? tag);
                return (
                  <span
                    key={`${assignment.id}-tag-${idx}`}
                    className="inline-flex items-center px-4 py-2 rounded-full text-sm font-bold bg-blue-600 text-white shadow-md border-2 border-blue-700"
                  >
                    🏷️ {tagLabel}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">المنتجات ({itemsCount})</h3>
            <span className="text-xs text-gray-500">
              تم التحديث {formatRelativeTime(assignment.lastStatusUpdateAt || assignment.assignedAt)}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {productLocationError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {productLocationError}
              </div>
            )}
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-500">
                لا توجد بيانات للمنتجات داخل هذا الطلب حتى الآن.
              </div>
            ) : (
              items.map((item: LineItem, index: number) => {
                const rawSkuValue = extractLineItemSku(item);
                const normalizedItemSku = normalizeSku(rawSkuValue);
                const unavailableRecord = getUnavailableRecord(normalizedItemSku);
                const unavailableKey = `${assignment.id}_${normalizedItemSku}`;
                const isMarkingUnavailable =
                  Boolean(normalizedItemSku) && unavailableActionKey === unavailableKey;
                const itemStatus = itemProgress[getItemKey(index)];
                const isReady = itemStatus === 'ready';
                const isComingSoon = itemStatus === 'comingSoon';
                const isUnavailable = itemStatus === 'unavailable';
                const readyDisabled = isReady || isUnavailable;
                const unavailableDisabled =
                  !normalizedItemSku || isMarkingUnavailable || isUnavailable;
                const printingSku = printingSkuKey === `${assignment.id}_${index}`;

                return (
                  <div
                    key={`${item.sku ?? 'item'}-${index}`}
                    className="flex flex-col sm:flex-row gap-3 rounded-lg border border-gray-100 p-3"
                  >
                    {item.image && (
                      <div className="flex flex-wrap gap-2">
                        {Array.from({
                          length: Math.max(1, Math.floor(item.quantity || 1)),
                        }).map((_, copyIndex) => (
                          <Image
                            key={`${item.sku ?? 'item'}-${index}-img-${copyIndex}`}
                            src={item.image as string}
                            alt={item.name || item.sku || 'منتج'}
                            width={256}
                            height={256}
                            unoptimized
                            className="w-16 h-16 rounded-md object-cover border border-gray-100"
                          />
                        ))}
                      </div>
                    )}
                    <div className="flex-1 space-y-3">
                      <div>
                        <p className="text-base font-semibold text-gray-900">
                          {item.name || 'منتج بدون اسم'}
                        </p>
                      </div>
                      <ProductMeta
                        item={item}
                        getLocationForSku={getLocationForSku}
                        loadingProductLocations={loadingProductLocations}
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button
                          onClick={() => openItemActionDialog('ready', item, index)}
                          disabled={readyDisabled}
                          className={cn(
                            'w-full sm:w-auto bg-green-600 text-white hover:bg-green-700',
                            readyDisabled ? 'opacity-80' : '',
                          )}
                        >
                          <CheckCircle className="h-4 w-4 ml-2" />
                          تم التجهيز
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => openItemActionDialog('comingSoon', item, index)}
                          disabled={isComingSoon || isUnavailable}
                          className={cn(
                            'w-full sm:w-auto border-amber-200 text-amber-900',
                            isComingSoon ? 'bg-amber-50' : '',
                          )}
                        >
                          <AlertTriangle className="h-4 w-4 ml-2" />
                          سيتوفر قريبًا
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => openItemActionDialog('unavailable', item, index)}
                          disabled={unavailableDisabled}
                          className="w-full sm:w-auto border-rose-200 text-rose-900"
                        >
                          {isMarkingUnavailable ? (
                            <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 ml-2" />
                          )}
                          غير متوفر
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handlePrintSku(item, index)}
                          disabled={printingSku}
                          className={cn(
                            'w-full sm:w-auto border-dashed border-gray-300 text-gray-700 mt-2 sm:mt-0',
                            printingSku ? 'opacity-70' : '',
                          )}
                        >
                          {printingSku ? (
                            <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                          ) : (
                            <Printer className="h-4 w-4 ml-2" />
                          )}
                          طباعة رمز المنتج
                        </Button>
                      </div>
                      {isReady && (
                        <p className="text-xs font-semibold text-green-700 flex items-center gap-1">
                          <CheckCircle className="h-4 w-4" />
                          تم تأكيد تجهيز هذا المنتج.
                        </p>
                      )}
                      {isComingSoon && (
                        <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4" />
                          تم وضع هذا المنتج في قائمة الانتظار وسيتم توفره قريباً.
                        </p>
                      )}
                      {isUnavailable && unavailableRecord && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800">
                            تم تسجيل النقص بواسطة{' '}
                            <span className="mx-1 text-rose-900">
                              {unavailableRecord.reportedByName || 'عضو الفريق'}
                            </span>
                            قبل {formatRelativeTime(unavailableRecord.createdAt)}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={resolvingUnavailableId === unavailableRecord.id}
                            onClick={() => handleResolveUnavailable(unavailableRecord, index)}
                            className="self-start sm:self-auto text-rose-700 hover:text-rose-900"
                          >
                            {resolvingUnavailableId === unavailableRecord.id ? (
                              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                            ) : (
                              <Undo2 className="h-4 w-4 ml-2" />
                            )}
                            التراجع عن غير متوفر
                          </Button>
                        </div>
                      )}
                      {!isUnavailable && !unavailableRecord && normalizedItemSku && (
                        <span className="text-xs text-gray-500">
                          سيظهر إشعار التسجيل إذا تم اختيار &quot;غير متوفر&quot;.
                        </span>
                      )}
                      {!normalizedItemSku && (
                        <p className="text-xs text-gray-500">
                          لا يمكن تسجيل نقص لهذا المنتج لعدم توفر SKU واضح في بياناته.
                        </p>
                      )}
                      {item.options && item.options.length > 0 && (
                        <div>
                          <h4 className="text-sm font-bold text-gray-700 mb-1">خيارات المنتج:</h4>
                          <div className="flex flex-wrap gap-2">
                            {item.options.map((option: any, optionIdx: number) => (
                              <span
                                key={`${item.sku ?? 'item'}-option-${optionIdx}`}
                                className="inline-flex items-center gap-2 rounded-lg bg-purple-50 px-3 py-1 text-xs font-medium text-purple-800 border border-purple-200"
                              >
                                <span className="font-semibold">{getStringValue(option?.name)}:</span>
                                <span>{getStringValue(option?.value)}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              variant="outline"
              onClick={() => onPrintOrderNumber(assignment)}
              disabled={printingOrderId === assignment.id || actionsLocked || isSallaUpdating}
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
              onClick={() => onConfirmComplete({ assignment, summary: completionSummary })}
              disabled={
                completedDisabled ||
                pendingAction === actionKey('completed') ||
                actionsLocked ||
                isSallaUpdating
              }
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
          {actionsLocked && (
            <p className="text-xs font-semibold text-amber-600">
              يرجى تحديد حالة كل منتج (تم التجهيز أو سيتوفر قريبًا أو غير متوفر) قبل المتابعة. تبقى{' '}
              {pendingItemsCount} منتج بدون حالة.
            </p>
          )}
        </div>
      </div>
    </Card>
    <ConfirmationDialog
      open={Boolean(itemActionDialog)}
      title="تأكيد حالة المنتج"
      message={itemActionMessage}
      confirmLabel={itemActionConfirmLabel}
      confirmVariant={itemActionConfirmVariant}
      onConfirm={confirmItemAction}
      onCancel={closeItemActionDialog}
    />
    </>
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLikelyLineItem = (value: unknown): boolean => {
  if (!isPlainObject(value)) {
    return false;
  }
  const object = value as Record<string, unknown>;
  const hasName = typeof object.name === 'string' || typeof object.title === 'string';
  const hasSku =
    typeof object.sku === 'string' ||
    typeof (object.product as Record<string, unknown> | undefined)?.sku === 'string' ||
    typeof object.code === 'string';
  const rawQuantity = object.quantity ?? (object.qty as unknown);
  const quantity =
    typeof rawQuantity === 'number'
      ? rawQuantity
      : typeof rawQuantity === 'string'
        ? Number.parseFloat(rawQuantity)
        : null;
  const hasQuantity = typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0;
  const hasProduct =
    isPlainObject(object.product) ||
    isPlainObject(object.variant) ||
    Array.isArray(object.options) ||
    Array.isArray(object.images);
  return (hasQuantity && (hasName || hasSku || hasProduct)) || (hasName && hasSku);
};

function resolveItemArray(source: unknown, depth = 0): any[] {
  if (source === null || source === undefined || depth > 8) {
    return [];
  }

  if (Array.isArray(source)) {
    return source;
  }

  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return resolveItemArray(parsed, depth + 1);
      } catch {
        return [];
      }
    }
    return [];
  }

  if (!isPlainObject(source)) {
    return [];
  }

  const container = source as Record<string, unknown>;
  const directArrayKeys = [
    'items',
    'data',
    'order_items',
    'orderItems',
    'line_items',
    'lineItems',
    'line_items_data',
    'orderLines',
    'order_lines',
    'products',
  ];

  for (const key of directArrayKeys) {
    const value = container[key];
    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  const nestedKeys = [
    'order',
    'orderData',
    'order_data',
    'payload',
    'result',
    'results',
    'record',
    'records',
    'response',
    'cart',
    'content',
    'value',
  ];

  const keysToExplore = [...directArrayKeys, ...nestedKeys];
  for (const key of keysToExplore) {
    const value = container[key];
    if (!value || value === source) {
      continue;
    }
    const resolved = resolveItemArray(value, depth + 1);
    if (resolved.length > 0) {
      return resolved;
    }
  }

  const flattened: any[] = [];
  Object.values(container).forEach((value) => {
    if (Array.isArray(value) && value.length > 0) {
      value.forEach((entry) => {
        if (isLikelyLineItem(entry)) {
          flattened.push(entry);
        }
      });
    } else if (isPlainObject(value) && isLikelyLineItem(value)) {
      flattened.push(value);
    }
  });
  if (flattened.length > 0) {
    return flattened;
  }

  return [];
}

function getLineItems(order: any): LineItem[] {
  const list = resolveItemArray(order);

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
    const options = collectItemOptions(item);
    return {
      sku,
      name,
      quantity: item?.quantity || 1,
      image,
      color,
      size,
      location,
      locationNotes,
      options,
    };
  });
}

function collectItemOptions(item: any): any[] {
  const sources = [item?.options, item?.variant?.options, item?.product?.options, item?.details?.options];
  for (const source of sources) {
    if (Array.isArray(source) && source.length > 0) {
      return source;
    }
  }
  return [];
}

function ProductMeta({
  item,
  getLocationForSku,
  loadingProductLocations,
}: {
  item: LineItem;
  getLocationForSku: (sku: unknown) => ProductLocation | undefined;
  loadingProductLocations: boolean;
}) {
  const normalizedSku = normalizeSku(item?.sku);
  const skuDisplay = normalizedSku || getStringValue(item?.sku) || '';
  const locationInfo = normalizedSku ? getLocationForSku(normalizedSku) : undefined;
  const fallbackLocation = item.location ? getStringValue(item.location) : '';
  const hasLocation = Boolean(locationInfo || fallbackLocation);
  const locationUpdatedAt = locationInfo?.updatedAt
    ? new Date(locationInfo.updatedAt).toLocaleString('ar-SA')
    : null;
  const locationNotes = locationInfo?.notes || item.locationNotes;
  const locationLabel = hasLocation ? (locationInfo?.location || fallbackLocation) : 'غير مسجل';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {skuDisplay && (
          <div className="inline-flex items-center gap-2 bg-blue-50 border-2 border-blue-500 px-4 py-3 rounded-lg">
            <span className="text-sm font-semibold text-blue-700">SKU:</span>
            <span className="text-xl font-bold text-blue-900">{skuDisplay}</span>
          </div>
        )}
        {Array.from({
          length: Math.max(1, Math.floor(item.quantity || 1)),
        }).map((_, copyIndex) => (
          <div
            key={`qty-${copyIndex}`}
            className="inline-flex items-center gap-2 bg-green-50 border-2 border-green-500 px-4 py-3 rounded-lg"
          >
            <span className="text-sm font-semibold text-green-700">الكمية:</span>
            <span className="text-xl font-bold text-green-900">×1</span>
          </div>
        ))}
        {(normalizedSku || hasLocation) && (
          <div
            className={`flex flex-col gap-1 rounded-lg border-2 px-4 py-3 ${hasLocation ? 'bg-amber-50 border-amber-500' : 'bg-gray-100 border-dashed border-gray-400'}`}
          >
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${hasLocation ? 'text-amber-800' : 'text-gray-600'}`}>
                الموقع:
              </span>
              <span className={`text-base font-bold ${hasLocation ? 'text-amber-900' : 'text-gray-500'}`}>
                {loadingProductLocations && !hasLocation ? 'جاري التحميل...' : locationLabel}
              </span>
            </div>
            {locationInfo?.updatedBy && (
              <span className="text-xs text-gray-500">
                آخر تحديث بواسطة {locationInfo.updatedBy}
                {locationUpdatedAt ? ` في ${locationUpdatedAt}` : ''}
              </span>
            )}
            {locationNotes && (
              <span className="text-xs text-gray-600">ملاحظات: {locationNotes}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
        {item.color && (
          <span className="inline-flex items-center gap-1 font-semibold text-gray-900">
            <span className="text-gray-500">اللون:</span>
            <span>{item.color}</span>
          </span>
        )}
        {item.size && (
          <span className="inline-flex items-center gap-1 font-semibold text-gray-900">
            <span className="text-gray-500">المقاس:</span>
            <span>{item.size}</span>
          </span>
        )}
      </div>
    </div>
  );
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
