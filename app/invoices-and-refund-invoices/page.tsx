'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  Package,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
} from 'lucide-react';

type OrderQueueRow = {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  statusSlug: string | null;
  statusName: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  totalAmount: number | null;
  customerName: string | null;
  customerMobile: string | null;
  placedAt: string | null;
  erpInvoiceId: string | null;
  erpSyncedAt: string | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
  queueStatus: 'ready' | 'error' | 'synced' | 'internal-transfer';
  queueStatusLabel: string;
  queueStatusMessage: string | null;
  canSync: boolean;
};

type RefundQueueRow = {
  id: string;
  merchantId: string;
  orderRecordId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderStatusSlug: string | null;
  orderStatusName: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  currency: string | null;
  totalAmount: number | null;
  customerName: string | null;
  customerMobile: string | null;
  placedAt: string | null;
  refundInvoiceRecordId: string | null;
  refundInvoiceId: string | null;
  refundInvoiceNumber: string | null;
  refundInvoiceStatus: string | null;
  refundInvoicePaymentStatus: string | null;
  refundInvoiceIssueDate: string | null;
  refundSource: 'order' | 'invoice' | 'order+invoice';
  refundSourceLabel: string;
  erpSyncedAt: string | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
  queueStatus: 'ready' | 'error' | 'waiting';
  queueStatusLabel: string;
  queueStatusMessage: string | null;
  canSync: boolean;
};

type InvoicesAndRefundInvoicesResponse = {
  generatedAt: string;
  orders: OrderQueueRow[];
  refunds: RefundQueueRow[];
};

type FeedbackState =
  | {
      type: 'success' | 'error';
      text: string;
    }
  | null;

type SyncApiResponse =
  | {
      success: boolean;
      queueType: 'order';
      alreadyRecorded: boolean;
      erpInvoiceId: string;
      message: string;
      orderId: string;
      orderNumber: string | null;
    }
  | {
      success: boolean;
      queueType: 'refund';
      alreadyRecorded: boolean;
      erpInvoiceId: string;
      message: string;
      orderId: string | null;
      orderNumber: string | null;
      invoiceId: string | null;
      invoiceNumber: string | null;
    };

type DateRangePreset = 'today' | 'yesterday' | 'last3days' | 'last7days';

const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatCurrency = (value: number | null, currency: string | null) => {
  if (value == null) {
    return '-';
  }

  return `${value.toLocaleString('en-US')} ${currency || ''}`.trim();
};

const formatDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftDate = (date: Date, days: number) => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

export default function InvoicesAndRefundInvoicesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasAccess = hasServiceAccess(session, [
    'invoices-and-refund-invoices',
    'invoice-refunds',
    'order-reports',
  ]);

  const [pageData, setPageData] = useState<InvoicesAndRefundInvoicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingSalla, setRefreshingSalla] = useState(false);
  const [appliedStartDate, setAppliedStartDate] = useState(() => formatDateInputValue(new Date()));
  const [appliedEndDate, setAppliedEndDate] = useState(() => formatDateInputValue(new Date()));
  const [draftStartDate, setDraftStartDate] = useState(() => formatDateInputValue(new Date()));
  const [draftEndDate, setDraftEndDate] = useState(() => formatDateInputValue(new Date()));
  const [searchTerm, setSearchTerm] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [syncingOrders, setSyncingOrders] = useState<Record<string, boolean>>({});
  const [syncingRefunds, setSyncingRefunds] = useState<Record<string, boolean>>({});
  const [bulkProgress, setBulkProgress] = useState<{
    kind: 'orders' | 'new-orders' | 'refunds';
    processed: number;
    total: number;
    success: number;
    failed: number;
    currentLabel: string | null;
  } | null>(null);

  const isBulkProcessing = Boolean(bulkProgress);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const todayString = useMemo(() => formatDateInputValue(new Date()), []);
  const yesterdayString = useMemo(() => formatDateInputValue(shiftDate(new Date(), -1)), []);
  const last3DaysStartString = useMemo(
    () => formatDateInputValue(shiftDate(new Date(), -2)),
    []
  );
  const last7DaysStartString = useMemo(
    () => formatDateInputValue(shiftDate(new Date(), -6)),
    []
  );
  const hasDateRange = Boolean(appliedStartDate || appliedEndDate);
  const isTodayRange = appliedStartDate === todayString && appliedEndDate === todayString;
  const draftIsTodayRange = draftStartDate === todayString && draftEndDate === todayString;
  const draftIsYesterdayRange = draftStartDate === yesterdayString && draftEndDate === yesterdayString;
  const draftIsLast3DaysRange = draftStartDate === last3DaysStartString && draftEndDate === todayString;
  const draftIsLast7DaysRange = draftStartDate === last7DaysStartString && draftEndDate === todayString;
  const hasPendingDateChanges =
    draftStartDate !== appliedStartDate || draftEndDate !== appliedEndDate;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [router, status]);

  const loadData = useCallback(
    async (showRefreshState = false) => {
      try {
        if (showRefreshState) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const params = new URLSearchParams();
        if (appliedStartDate) {
          params.set('startDate', appliedStartDate);
        }
        if (appliedEndDate) {
          params.set('endDate', appliedEndDate);
        }

        const response = await fetch(
          `/api/invoices-and-refund-invoices${params.toString() ? `?${params.toString()}` : ''}`
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || 'فشل في تحميل البيانات');
        }

        setPageData(payload);
      } catch (error) {
        setFeedback({
          type: 'error',
          text: error instanceof Error ? error.message : 'فشل في تحميل البيانات',
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appliedEndDate, appliedStartDate]
  );

  useEffect(() => {
    if (status === 'authenticated' && hasAccess) {
      void loadData();
    }
  }, [hasAccess, loadData, status]);

  const filteredOrders = useMemo(() => {
    const orders = pageData?.orders || [];
    const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return orders;
    }

    return orders.filter((order) => {
      const searchableParts = [
        order.orderNumber,
        order.orderId,
        order.customerName,
        order.customerMobile,
        order.statusName,
        order.statusSlug,
        order.paymentStatus,
        order.paymentMethod,
        order.erpInvoiceId,
        order.queueStatusLabel,
        order.queueStatusMessage,
      ];

      return searchableParts.some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(normalizedSearch)
      );
    });
  }, [deferredSearchTerm, pageData?.orders]);

  const filteredRefunds = useMemo(() => {
    const refunds = pageData?.refunds || [];
    const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return refunds;
    }

    return refunds.filter((refund) => {
      const searchableParts = [
        refund.orderNumber,
        refund.orderId,
        refund.customerName,
        refund.customerMobile,
        refund.orderStatusName,
        refund.orderStatusSlug,
        refund.paymentStatus,
        refund.paymentMethod,
        refund.refundInvoiceNumber,
        refund.refundInvoiceId,
        refund.refundInvoiceStatus,
        refund.refundSourceLabel,
        refund.queueStatusLabel,
        refund.queueStatusMessage,
      ];

      return searchableParts.some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(normalizedSearch)
      );
    });
  }, [deferredSearchTerm, pageData?.refunds]);

  const pendingOrders = useMemo(
    () => (pageData?.orders || []).filter((order) => order.canSync),
    [pageData?.orders]
  );

  const newPendingOrders = useMemo(
    () =>
      (pageData?.orders || []).filter(
        (order) => order.canSync && order.queueStatus === 'ready' && !order.erpSyncError
      ),
    [pageData?.orders]
  );

  const pendingRefunds = useMemo(
    () => (pageData?.refunds || []).filter((refund) => refund.canSync),
    [pageData?.refunds]
  );

  const summary = useMemo(() => {
    const orders = pageData?.orders || [];
    const refunds = pageData?.refunds || [];

    return {
      pendingOrders: orders.filter((order) => order.canSync).length,
      orderErrors: orders.filter((order) => order.queueStatus === 'error').length,
      internalTransferOrders: orders.filter((order) => order.queueStatus === 'internal-transfer').length,
      pendingRefunds: refunds.filter((refund) => refund.canSync).length,
      refundIssues: refunds.filter((refund) => refund.queueStatus !== 'ready').length,
    };
  }, [pageData?.orders, pageData?.refunds]);

  const requestOrderSync = useCallback(async (order: OrderQueueRow): Promise<SyncApiResponse> => {
    const response = await fetch('/api/invoices-and-refund-invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        queueType: 'order',
        id: order.id,
        orderId: order.orderId,
        orderNumber: order.orderNumber,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'فشل في إرسال فاتورة البيع إلى ERP');
    }

    return payload as SyncApiResponse;
  }, []);

  const requestRefundSync = useCallback(async (refund: RefundQueueRow): Promise<SyncApiResponse> => {
    const response = await fetch('/api/invoices-and-refund-invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        queueType: 'refund',
        orderRecordId: refund.orderRecordId,
        orderId: refund.orderId,
        orderNumber: refund.orderNumber,
        invoiceRecordId: refund.refundInvoiceRecordId,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'فشل في إرسال المرتجع إلى ERP');
    }

    return payload as SyncApiResponse;
  }, []);

  const refreshFromSalla = useCallback(async () => {
    const response = await fetch('/api/invoices-and-refund-invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'refresh-salla',
        startDate: appliedStartDate || undefined,
        endDate: appliedEndDate || undefined,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'فشل في تحديث بيانات سلة');
    }

    return payload as {
      success: true;
      action: 'refresh-salla';
      summary: {
        ordersMerchantsProcessed: number;
        ordersFetched: number;
        ordersStored: number;
        orderErrors: number;
        invoicesMerchantsProcessed: number;
        invoicesFetched: number;
        invoicesStored: number;
        invoiceErrors: number;
      };
    };
  }, [appliedEndDate, appliedStartDate]);

  const handleRefreshFromSalla = async () => {
    if (refreshingSalla || isBulkProcessing) {
      return;
    }

    const confirmed = confirm(
      appliedStartDate || appliedEndDate
        ? `سيتم تحديث طلبات سلة وفواتير سلة من Salla API ضمن النطاق ${appliedStartDate || 'البداية'} إلى ${appliedEndDate || 'النهاية'}. هل تريد المتابعة؟`
        : 'سيتم تحديث طلبات سلة وفواتير سلة من Salla API قبل الإرسال إلى ERP. هل تريد المتابعة؟'
    );

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setRefreshingSalla(true);

    try {
      const result = await refreshFromSalla();
      setFeedback({
        type: 'success',
        text: `تم تحديث سلة: ${result.summary.ordersStored} طلب و${result.summary.invoicesStored} فاتورة. أخطاء الطلبات: ${result.summary.orderErrors}، أخطاء الفواتير: ${result.summary.invoiceErrors}.`,
      });
      await loadData(true);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'فشل في تحديث بيانات سلة',
      });
    } finally {
      setRefreshingSalla(false);
    }
  };

  const handleSyncOrder = async (order: OrderQueueRow) => {
    if (!order.canSync || syncingOrders[order.id] || isBulkProcessing || refreshingSalla) {
      return;
    }

    const confirmed = confirm(
      `هل تريد إرسال فاتورة البيع للطلب ${order.orderNumber || order.orderId} إلى ERP؟`
    );

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setSyncingOrders((current) => ({
      ...current,
      [order.id]: true,
    }));

    try {
      const payload = await requestOrderSync(order);
      setFeedback({
        type: 'success',
        text:
          payload.queueType === 'order'
            ? payload.message ||
              `تم إرسال فاتورة البيع للطلب ${order.orderNumber || order.orderId} إلى ERP`
            : 'تم التنفيذ بنجاح',
      });
      await loadData(true);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'فشل في إرسال فاتورة البيع إلى ERP',
      });
    } finally {
      setSyncingOrders((current) => ({
        ...current,
        [order.id]: false,
      }));
    }
  };

  const handleSyncRefund = async (refund: RefundQueueRow) => {
    if (!refund.canSync || syncingRefunds[refund.id] || isBulkProcessing || refreshingSalla) {
      return;
    }

    const confirmed = confirm(
      `هل تريد إرسال مرتجع الطلب ${refund.orderNumber || refund.orderId || refund.refundInvoiceNumber || refund.refundInvoiceId} إلى ERP كفاتورة مرتجع؟`
    );

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setSyncingRefunds((current) => ({
      ...current,
      [refund.id]: true,
    }));

    try {
      const payload = await requestRefundSync(refund);
      setFeedback({
        type: 'success',
        text:
          payload.queueType === 'refund'
            ? payload.message ||
              `تم إرسال مرتجع الطلب ${refund.orderNumber || refund.orderId} إلى ERP`
            : 'تم التنفيذ بنجاح',
      });
      await loadData(true);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'فشل في إرسال المرتجع إلى ERP',
      });
    } finally {
      setSyncingRefunds((current) => ({
        ...current,
        [refund.id]: false,
      }));
    }
  };

  const syncOrderBatch = async (
    ordersToSync: OrderQueueRow[],
    options: {
      kind: 'orders' | 'new-orders';
      emptyMessage: string;
      confirmMessage: string;
      successMessage: (successCount: number) => string;
      partialMessage: (successCount: number, failedCount: number, failedOrders: string[]) => string;
    }
  ) => {
    if (isBulkProcessing || refreshingSalla) {
      return;
    }

    if (ordersToSync.length === 0) {
      setFeedback({
        type: 'error',
        text: options.emptyMessage,
      });
      return;
    }

    const confirmed = confirm(options.confirmMessage);

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setBulkProgress({
      kind: options.kind,
      processed: 0,
      total: ordersToSync.length,
      success: 0,
      failed: 0,
      currentLabel: ordersToSync[0]?.orderNumber || ordersToSync[0]?.orderId || null,
    });

    let successCount = 0;
    let failedCount = 0;
    const failedOrders: string[] = [];

    for (let index = 0; index < ordersToSync.length; index += 1) {
      const order = ordersToSync[index];

      setSyncingOrders((current) => ({
        ...current,
        [order.id]: true,
      }));

      try {
        await requestOrderSync(order);
        successCount += 1;
      } catch (error) {
        failedCount += 1;
        failedOrders.push(order.orderNumber || order.orderId);
        console.error('Bulk order sync failed', order.id, error);
      } finally {
        setSyncingOrders((current) => ({
          ...current,
          [order.id]: false,
        }));
      }

      setBulkProgress({
        kind: options.kind,
        processed: index + 1,
        total: ordersToSync.length,
        success: successCount,
        failed: failedCount,
        currentLabel:
          index + 1 < ordersToSync.length
            ? ordersToSync[index + 1].orderNumber || ordersToSync[index + 1].orderId
            : null,
      });
    }

    setFeedback({
      type: successCount > 0 ? 'success' : 'error',
      text:
        failedCount === 0
          ? options.successMessage(successCount)
          : options.partialMessage(successCount, failedCount, failedOrders),
    });

    await loadData(true);
    setBulkProgress(null);
  };

  const handleSyncAllOrders = async () => {
    await syncOrderBatch(pendingOrders, {
      kind: 'orders',
      emptyMessage: 'لا توجد فواتير بيع جاهزة للإرسال إلى ERP.',
      confirmMessage: `سيتم إرسال ${pendingOrders.length} فاتورة بيع من SallaOrder إلى ERP. هل تريد المتابعة؟`,
      successMessage: (successCount) => `تم إرسال ${successCount} فاتورة بيع إلى ERP.`,
      partialMessage: (successCount, failedCount, failedOrders) =>
        `تم إرسال ${successCount} فاتورة بيع، وفشل ${failedCount} طلب. الطلبات الفاشلة: ${failedOrders
          .slice(0, 10)
          .join(', ')}${failedOrders.length > 10 ? ' ...' : ''}`,
    });
  };

  const handleSyncNewOrders = async () => {
    await syncOrderBatch(newPendingOrders, {
      kind: 'new-orders',
      emptyMessage: 'لا توجد فواتير بيع جديدة بدون أخطاء جاهزة للإرسال إلى ERP.',
      confirmMessage: `سيتم إرسال ${newPendingOrders.length} فاتورة بيع جديدة بدون أخطاء إلى ERP. هل تريد المتابعة؟`,
      successMessage: (successCount) => `تم إرسال ${successCount} فاتورة بيع جديدة إلى ERP.`,
      partialMessage: (successCount, failedCount, failedOrders) =>
        `تم إرسال ${successCount} فاتورة بيع جديدة، وفشل ${failedCount} طلب. الطلبات الفاشلة: ${failedOrders
          .slice(0, 10)
          .join(', ')}${failedOrders.length > 10 ? ' ...' : ''}`,
    });
  };

  const handleSyncAllRefunds = async () => {
    if (isBulkProcessing || refreshingSalla) {
      return;
    }

    if (pendingRefunds.length === 0) {
      setFeedback({
        type: 'error',
        text: 'لا توجد مرتجعات جاهزة للإرسال إلى ERP.',
      });
      return;
    }

    const confirmed = confirm(
      `سيتم إرسال ${pendingRefunds.length} مرتجع إلى ERP كفواتير مرتجع. هل تريد المتابعة؟`
    );

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setBulkProgress({
      kind: 'refunds',
      processed: 0,
      total: pendingRefunds.length,
      success: 0,
      failed: 0,
      currentLabel:
        pendingRefunds[0]?.orderNumber ||
        pendingRefunds[0]?.refundInvoiceNumber ||
        pendingRefunds[0]?.orderId ||
        null,
    });

    let successCount = 0;
    let failedCount = 0;
    const failedRefunds: string[] = [];

    for (let index = 0; index < pendingRefunds.length; index += 1) {
      const refund = pendingRefunds[index];

      setSyncingRefunds((current) => ({
        ...current,
        [refund.id]: true,
      }));

      try {
        await requestRefundSync(refund);
        successCount += 1;
      } catch (error) {
        failedCount += 1;
        failedRefunds.push(
          refund.orderNumber || refund.refundInvoiceNumber || refund.orderId || refund.id
        );
        console.error('Bulk refund sync failed', refund.id, error);
      } finally {
        setSyncingRefunds((current) => ({
          ...current,
          [refund.id]: false,
        }));
      }

      setBulkProgress({
        kind: 'refunds',
        processed: index + 1,
        total: pendingRefunds.length,
        success: successCount,
        failed: failedCount,
        currentLabel:
          index + 1 < pendingRefunds.length
            ? pendingRefunds[index + 1].orderNumber ||
              pendingRefunds[index + 1].refundInvoiceNumber ||
              pendingRefunds[index + 1].orderId
            : null,
      });
    }

    setFeedback({
      type: successCount > 0 ? 'success' : 'error',
      text:
        failedCount === 0
          ? `تم إرسال ${successCount} مرتجع إلى ERP.`
          : `تم إرسال ${successCount} مرتجع، وفشل ${failedCount} مرتجع. العناصر الفاشلة: ${failedRefunds
              .slice(0, 10)
              .join(', ')}${failedRefunds.length > 10 ? ' ...' : ''}`,
    });

    await loadData(true);
    setBulkProgress(null);
  };

  const getQueueStatusBadgeClasses = (
    statusValue: 'ready' | 'error' | 'waiting' | 'synced' | 'internal-transfer'
  ) => {
    switch (statusValue) {
      case 'error':
        return 'border-rose-200 bg-rose-50 text-rose-700';
      case 'waiting':
        return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'synced':
        return 'border-sky-200 bg-sky-50 text-sky-700';
      case 'internal-transfer':
        return 'border-violet-200 bg-violet-50 text-violet-700';
      default:
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    }
  };

  const applyPresetRange = useCallback((preset: DateRangePreset) => {
    const today = new Date();
    let nextStart = today;
    let nextEnd = today;

    switch (preset) {
      case 'yesterday':
        nextStart = shiftDate(today, -1);
        nextEnd = shiftDate(today, -1);
        break;
      case 'last3days':
        nextStart = shiftDate(today, -2);
        nextEnd = today;
        break;
      case 'last7days':
        nextStart = shiftDate(today, -6);
        nextEnd = today;
        break;
      default:
        nextStart = today;
        nextEnd = today;
        break;
    }

    setDraftStartDate(formatDateInputValue(nextStart));
    setDraftEndDate(formatDateInputValue(nextEnd));
  }, []);

  const handleResetToToday = useCallback(() => {
    setDraftStartDate(todayString);
    setDraftEndDate(todayString);
  }, [todayString]);

  const handleApplyDateRange = useCallback(() => {
    if (refreshing || refreshingSalla || isBulkProcessing || !hasPendingDateChanges) {
      return;
    }

    setFeedback(null);
    setAppliedStartDate(draftStartDate);
    setAppliedEndDate(draftEndDate);
  }, [
    draftEndDate,
    draftStartDate,
    hasPendingDateChanges,
    isBulkProcessing,
    refreshing,
    refreshingSalla,
  ]);

  const activeRangeLabel = useMemo(() => {
    if (appliedStartDate && appliedEndDate && appliedStartDate === appliedEndDate) {
      return `يوم واحد: ${appliedStartDate}`;
    }

    if (appliedStartDate && appliedEndDate) {
      return `${appliedStartDate} → ${appliedEndDate}`;
    }

    if (appliedStartDate) {
      return `من ${appliedStartDate}`;
    }

    if (appliedEndDate) {
      return `حتى ${appliedEndDate}`;
    }

    return 'كل البيانات';
  }, [appliedEndDate, appliedStartDate]);

  if (status === 'loading' || (status === 'authenticated' && loading && !pageData)) {
    return (
      <AppPageShell title="مزامنة ERP" subtitle="جاري تحميل طوابير الطلبات والمرتجعات">
        <Card>
          <LoadingState label="جاري تحميل البيانات..." />
        </Card>
      </AppPageShell>
    );
  }

  if (status === 'authenticated' && !hasAccess) {
    return (
      <AppPageShell title="مزامنة ERP" subtitle="لا تملك صلاحية الوصول لهذه الصفحة">
        <EmptyState
          title="لا تملك صلاحية الوصول"
          description="هذه الصفحة متاحة فقط للحسابات المخولة بمزامنة ERP للطلبات والمرتجعات."
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      title="مزامنة ERP"
      subtitle="مزامنة طلبات البيع والمرتجعات مع ERP حسب اليوم أو النطاق الزمني"
    >
      <div className="mx-auto w-full max-w-7xl">
        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          <Card className="rounded-3xl border border-indigo-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">طلبات بيع جاهزة للإرسال</p>
            <p className="mt-2 text-3xl font-bold text-indigo-700">{summary.pendingOrders}</p>
          </Card>
          <Card className="rounded-3xl border border-rose-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">طلبات بيع تحتاج إعادة محاولة</p>
            <p className="mt-2 text-3xl font-bold text-rose-700">{summary.orderErrors}</p>
          </Card>
          <Card className="rounded-3xl border border-violet-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">طلبات مجانية تحتاج تحويل مخزني داخلي</p>
            <p className="mt-2 text-3xl font-bold text-violet-700">{summary.internalTransferOrders}</p>
          </Card>
          <Card className="rounded-3xl border border-emerald-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">مرتجعات جاهزة للإرسال</p>
            <p className="mt-2 text-3xl font-bold text-emerald-700">{summary.pendingRefunds}</p>
          </Card>
          <Card className="rounded-3xl border border-amber-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">مرتجعات تحتاج متابعة</p>
            <p className="mt-2 text-3xl font-bold text-amber-700">{summary.refundIssues}</p>
          </Card>
        </section>

        <Card className="mt-6 rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,420px)]">
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                  <CalendarDays className="h-3.5 w-3.5" />
                  النطاق الافتراضي عند الدخول: اليوم
                </div>
                <h2 className="text-xl font-semibold text-slate-900">لوحة تنفيذ مزامنة ERP</h2>
                <p className="text-sm leading-6 text-slate-600">
                  تعرض هذه اللوحة الطلبات والمرتجعات غير المرسلة إلى ERP أو التي تحتاج إعادة
                  محاولة داخل النطاق المحدد. طلبات البيع تُقرأ من{' '}
                  <span className="font-medium text-slate-900">SallaOrder</span>، بينما تُجمع
                  المرتجعات من <span className="font-medium text-slate-900">SallaOrder</span>{' '}
                  و<span className="font-medium text-slate-900">SallaInvoice</span> حتى لا يفوتك
                  أي مرتجع قابل للإرسال. يتم أولاً إرسال فاتورة البيع الأصلية لكل طلب، ثم يصبح
                  المرتجع قابلاً للإرسال بعد نجاح فاتورة البيع، حتى لو لم تصل فاتورة المرتجع من
                  سلة بعد.
                </p>
                <p className="text-sm leading-6 text-slate-600">
                  إذا أردت مزامنة يوم كامل، اجعل تاريخ البداية وتاريخ النهاية نفس اليوم. عدّل
                  التاريخين أولاً ثم اضغط تأكيد النطاق ليتم تحديث البيانات المعروضة.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-xs font-medium text-slate-500">النطاق الحالي</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{activeRangeLabel}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {isTodayRange ? 'يعرض عناصر اليوم فقط' : 'يعرض العناصر داخل هذا النطاق'}
                  </p>
                  {hasPendingDateChanges && (
                    <p className="mt-2 text-xs text-amber-600">هناك تغييرات نطاق غير مطبقة بعد</p>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-xs font-medium text-slate-500">آخر تحديث محلي</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {formatDateTime(pageData?.generatedAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">هذا هو وقت آخر قراءة للبيانات المعروضة</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-xs font-medium text-slate-500">ما الذي يظهر هنا؟</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {filteredOrders.length} فاتورة بيع و{filteredRefunds.length} مرتجع في العرض الحالي
                  </p>
                  <p className="mt-1 text-xs text-slate-500">يشمل نتائج البحث والنطاق المحدد</p>
                </div>
              </div>

              {bulkProgress && (
                <Alert className="border-blue-200 bg-blue-50 text-blue-900">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <AlertTitle>
                    العملية الحالية:{' '}
                    {bulkProgress.kind === 'refunds'
                      ? 'إرسال المرتجعات'
                      : bulkProgress.kind === 'new-orders'
                        ? 'إرسال فواتير البيع الجديدة'
                        : 'إرسال فواتير البيع'}
                  </AlertTitle>
                  <AlertDescription className="text-blue-800">
                    تقدم التنفيذ: {bulkProgress.processed} / {bulkProgress.total}، نجاح:{' '}
                    {bulkProgress.success}، فشل: {bulkProgress.failed}. العنصر الحالي:{' '}
                    {bulkProgress.currentLabel ?? 'اكتمل التنفيذ'}
                  </AlertDescription>
                </Alert>
              )}

              {feedback && (
                <Alert
                  variant={feedback.type === 'error' ? 'destructive' : 'default'}
                  className={feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : ''}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertDescription>{feedback.text}</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 shadow-inner">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <Field>
                    <FieldLabel>من تاريخ</FieldLabel>
                    <Input
                      type="date"
                      value={draftStartDate}
                      onChange={(event) => setDraftStartDate(event.target.value)}
                      max={draftEndDate || undefined}
                      className="w-full rounded-2xl border-slate-200 bg-white text-sm text-slate-700"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>إلى تاريخ</FieldLabel>
                    <Input
                      type="date"
                      value={draftEndDate}
                      onChange={(event) => setDraftEndDate(event.target.value)}
                      min={draftStartDate || undefined}
                      className="w-full rounded-2xl border-slate-200 bg-white text-sm text-slate-700"
                    />
                  </Field>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">نطاقات سريعة</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={draftIsTodayRange ? 'default' : 'outline'}
                      className="rounded-full"
                      onClick={() => applyPresetRange('today')}
                      disabled={refreshing || refreshingSalla || isBulkProcessing}
                    >
                      اليوم
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={draftIsYesterdayRange ? 'default' : 'outline'}
                      className="rounded-full"
                      onClick={() => applyPresetRange('yesterday')}
                      disabled={refreshing || refreshingSalla || isBulkProcessing}
                    >
                      أمس
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={draftIsLast3DaysRange ? 'default' : 'outline'}
                      className="rounded-full"
                      onClick={() => applyPresetRange('last3days')}
                      disabled={refreshing || refreshingSalla || isBulkProcessing}
                    >
                      آخر 3 أيام
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={draftIsLast7DaysRange ? 'default' : 'outline'}
                      className="rounded-full"
                      onClick={() => applyPresetRange('last7days')}
                      disabled={refreshing || refreshingSalla || isBulkProcessing}
                    >
                      آخر 7 أيام
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-slate-600 hover:text-slate-900"
                      onClick={handleResetToToday}
                      disabled={draftIsTodayRange || refreshing || refreshingSalla || isBulkProcessing}
                    >
                      العودة إلى اليوم
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="ابحث برقم الطلب أو فاتورة المرتجع أو العميل أو رقم ERP"
                    className="w-full rounded-2xl border-slate-200 bg-white pr-10"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <Button
                    type="button"
                    variant={hasPendingDateChanges ? 'default' : 'outline'}
                    className="h-auto min-h-11 whitespace-normal rounded-2xl py-3 text-center leading-5"
                    onClick={handleApplyDateRange}
                    disabled={!hasPendingDateChanges || refreshing || refreshingSalla || isBulkProcessing}
                  >
                    <CalendarDays className="h-4 w-4" />
                    تأكيد النطاق
                  </Button>
                  <Button
                    type="button"
                    className="h-auto min-h-11 whitespace-normal rounded-2xl bg-sky-600 py-3 text-center leading-5 hover:bg-sky-700"
                    onClick={handleRefreshFromSalla}
                    disabled={refreshingSalla || isBulkProcessing}
                  >
                    {refreshingSalla ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    تحديث بيانات سلة
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-11 whitespace-normal rounded-2xl bg-white py-3 text-center leading-5"
                    onClick={() => loadData(true)}
                    disabled={refreshing || refreshingSalla || isBulkProcessing}
                  >
                    {refreshing ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    تحديث القائمة
                  </Button>
                  <Button
                    type="button"
                    className="h-auto min-h-11 whitespace-normal rounded-2xl bg-indigo-600 py-3 text-center leading-5 hover:bg-indigo-700"
                    onClick={handleSyncNewOrders}
                    disabled={refreshingSalla || isBulkProcessing || newPendingOrders.length === 0}
                  >
                    {bulkProgress?.kind === 'new-orders' ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    إرسال فواتير البيع الجديدة ({newPendingOrders.length})
                  </Button>
                  <Button
                    type="button"
                    className="h-auto min-h-11 whitespace-normal rounded-2xl bg-violet-600 py-3 text-center leading-5 hover:bg-violet-700"
                    onClick={handleSyncAllOrders}
                    disabled={refreshingSalla || isBulkProcessing || pendingOrders.length === 0}
                  >
                    {bulkProgress?.kind === 'orders' ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    إرسال فواتير البيع ({pendingOrders.length})
                  </Button>
                  <Button
                    type="button"
                    className="h-auto min-h-11 whitespace-normal rounded-2xl bg-emerald-600 py-3 text-center leading-5 hover:bg-emerald-700"
                    onClick={handleSyncAllRefunds}
                    disabled={refreshingSalla || isBulkProcessing || pendingRefunds.length === 0}
                  >
                    {bulkProgress?.kind === 'refunds' ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    إرسال المرتجعات ({pendingRefunds.length})
                  </Button>
                </div>

                <p className="text-xs leading-5 text-slate-500">
                  {hasDateRange
                    ? 'التواريخ في الأعلى لا تغيّر الجدول مباشرة. بعد ضبط البداية والنهاية اضغط تأكيد النطاق لتحديث البيانات.'
                    : 'عند عدم تحديد نطاق، ستُعرض كل العناصر المعلقة.'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="mt-6 rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3 text-slate-900">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-indigo-600" />
              <h2 className="text-xl font-semibold">طلبات البيع</h2>
            </div>
            <div className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              {filteredOrders.length} عنصر
            </div>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            تعرض هذه القائمة طلبات <span className="font-medium">SallaOrder</span> داخل النطاق
            الحالي سواء كانت بانتظار الإرسال أو أُرسلت بالفعل. يظهر هنا رقم فاتورة ERP بعد نجاح
            الإرسال، وحتى الطلبات التي أصبحت لاحقاً مرتجعات أو إلغاءات يجب إرسال فاتورة بيعها
            الأصلية أولاً من هنا. الطلبات المجانية بالكامل (بدون قيمة بعد الخصم) لا تُرسل كفاتورة
            بيع، وتظهر بدلاً من ذلك بحالة &quot;يتطلب تحويل مخزني داخلي&quot; ليقوم فريق العمليات
            بإنشاء تحويل مخزني يدوياً داخل ERP.
          </p>

          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <div className="overflow-x-auto">
              <Table className="min-w-[1420px]">
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>رقم الطلب</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>حالة الطلب</TableHead>
                    <TableHead>الدفع</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>تاريخ الطلب</TableHead>
                    <TableHead>رقم فاتورة ERP</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="w-[160px]">الإجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-6">
                        <EmptyState
                          title="لا توجد طلبات مطابقة"
                          description="لا توجد طلبات بيع داخل النطاق أو البحث الحالي."
                        />
                      </TableCell>
                    </TableRow>
                  )}

                  {filteredOrders.map((order) => (
                    <TableRow key={order.id} className="align-top">
                      <TableCell className="font-medium text-slate-900">
                        <div>{order.orderNumber || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">{order.orderId}</div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{order.customerName || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">{order.customerMobile || '-'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{order.statusName || order.statusSlug || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">{order.statusSlug || '-'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{order.paymentStatus || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">{order.paymentMethod || '-'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {formatCurrency(order.totalAmount, order.currency)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {formatDateTime(order.placedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{order.erpInvoiceId || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {order.erpSyncedAt ? formatDateTime(order.erpSyncedAt) : '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getQueueStatusBadgeClasses(order.queueStatus)}>
                          {order.queueStatusLabel}
                        </Badge>
                        {order.queueStatusMessage && (
                          <p className="mt-2 max-w-[240px] text-xs leading-5 text-slate-500">
                            {order.queueStatusMessage}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-xl"
                          onClick={() => handleSyncOrder(order)}
                          disabled={
                            !order.canSync ||
                            syncingOrders[order.id] ||
                            isBulkProcessing ||
                            refreshingSalla
                          }
                        >
                          {syncingOrders[order.id] ? (
                            <>
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                              جاري الإرسال
                            </>
                          ) : order.queueStatus === 'synced' ? (
                            'تم الإرسال'
                          ) : order.queueStatus === 'internal-transfer' ? (
                            'يتطلب تحويل مخزني يدوي'
                          ) : (
                            'إرسال فاتورة البيع'
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </Card>

        <Card className="mt-6 rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3 text-slate-900">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600" />
              <h2 className="text-xl font-semibold">المرتجعات</h2>
            </div>
            <div className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              {filteredRefunds.length} عنصر
            </div>
          </div>
          <p className="mb-4 text-sm text-slate-600">
            تعرض هذه القائمة كل المرتجعات المرصودة من <span className="font-medium">SallaOrder</span>{' '}
            و<span className="font-medium">SallaInvoice</span>. يتم إرسالها إلى ERP كفواتير
            مرتجع باستخدام بيانات الطلب الأصلية، لكن لا يمكن إرسال المرتجع قبل إرسال فاتورة
            البيع الأصلية إلى ERP أولاً.
          </p>

          <div className="overflow-hidden rounded-2xl border border-slate-100">
            <div className="overflow-x-auto">
              <Table className="min-w-[1500px]">
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>رقم الطلب</TableHead>
                    <TableHead>فاتورة المرتجع من سلة</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>المصدر</TableHead>
                    <TableHead>حالة المرتجع</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="w-[170px]">الإجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRefunds.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-6">
                        <EmptyState
                          title="لا توجد مرتجعات مطابقة"
                          description="لا توجد مرتجعات مطابقة أو لا توجد مرتجعات معلقة للإرسال."
                        />
                      </TableCell>
                    </TableRow>
                  )}

                  {filteredRefunds.map((refund) => (
                    <TableRow key={refund.id} className="align-top">
                      <TableCell className="font-medium text-slate-900">
                        <div>{refund.orderNumber || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">{refund.orderId || '-'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{refund.refundInvoiceNumber || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {refund.refundInvoiceId || 'لا توجد فاتورة مرتجع بعد'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{refund.customerName || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">{refund.customerMobile || '-'}</div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{refund.refundSourceLabel}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {refund.refundInvoiceStatus || refund.orderStatusName || refund.orderStatusSlug || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        <div>{refund.orderStatusName || refund.orderStatusSlug || '-'}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {refund.refundInvoiceStatus || refund.refundInvoicePaymentStatus || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {formatCurrency(refund.totalAmount, refund.currency)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-700">
                        {formatDateTime(refund.refundInvoiceIssueDate || refund.placedAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getQueueStatusBadgeClasses(refund.queueStatus)}>
                          {refund.queueStatusLabel}
                        </Badge>
                        {refund.queueStatusMessage && (
                          <p className="mt-2 max-w-[260px] text-xs leading-5 text-slate-500">
                            {refund.queueStatusMessage}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          className="rounded-xl"
                          onClick={() => handleSyncRefund(refund)}
                          disabled={
                            !refund.canSync ||
                            syncingRefunds[refund.id] ||
                            isBulkProcessing ||
                            refreshingSalla
                          }
                        >
                          {syncingRefunds[refund.id] ? (
                            <>
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                              جاري الإرسال
                            </>
                          ) : (
                            'إرسال المرتجع'
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </Card>
      </div>
    </AppPageShell>
  );
}
