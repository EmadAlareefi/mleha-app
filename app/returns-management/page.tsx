'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  CONDITION_LABELS,
  ReturnItemCondition,
  summarizeItemConditions,
} from '@/app/lib/returns/inspection';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  INSPECTION_BADGE_STYLES,
} from '@/app/lib/returns/status';
import type { SmsaLiveStatus } from '@/types/smsa';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';

interface ReturnItem {
  id: string;
  productName: string;
  productSku?: string;
  variantName?: string;
  quantity: number;
  price: number | string;
  conditionStatus?: ReturnItemCondition | null;
  conditionNotes?: string | null;
  preInspectionNotes?: string | null;
  inspectedBy?: string | null;
  inspectedAt?: string | null;
}

interface ReturnRequest {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string;
  type: 'return' | 'exchange';
  status: string;
  reason: string;
  reasonDetails?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  smsaTrackingNumber?: string;
  smsaAwbNumber?: string;
  smsaLiveStatus?: SmsaLiveStatus | null;
  smsaLiveStatusUpdatedAt?: string | null;
  totalRefundAmount?: number | string | null;
  returnFee?: number;
  couponCode?: string;
  couponId?: string;
  adminNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  items: ReturnItem[];
  sallaStatus?: {
    name?: string;
    slug?: string;
  } | null;
}

const gregorianDateFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const trackingTimestampFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const formatTrackingTimestamp = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return trackingTimestampFormatter.format(date);
};


const formatPrice = (value: number | string) => {
  const amount = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(amount)) {
    return amount.toFixed(2);
  }
  return '0.00';
};

const resolveRefundAmount = (request: ReturnRequest): number | null => {
  if (request.totalRefundAmount == null) {
    return null;
  }
  const amount =
    typeof request.totalRefundAmount === 'number'
      ? request.totalRefundAmount
      : Number(request.totalRefundAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount;
};

const STATUS_FILTER_OPTIONS = [
  { key: 'pending_review', label: 'تحت المراجعة' },
  { key: 'delivered', label: 'تم التسليم' },
  { key: 'completed', label: 'مكتمل' },
] as const;

type StatusFilterKey = (typeof STATUS_FILTER_OPTIONS)[number]['key'];

const TYPE_FILTER_OPTIONS = [
  { key: 'return', label: 'طلبات استرداد' },
  { key: 'exchange', label: 'طلبات استبدال' },
] as const;

type TypeFilterKey = (typeof TYPE_FILTER_OPTIONS)[number]['key'];

type NoteEditorState = {
  requestId: string;
  orderNumber: string;
  items: ReturnItem[];
  notes: Record<string, string>;
  saving: boolean;
  error: string;
};

export default function ReturnsManagementPage() {
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoCompleting, setAutoCompleting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [inspectionFilters, setInspectionFilters] = useState<{ inspected: boolean; review: boolean }>({
    inspected: true,
    review: false,
  });
  const [statusFilters, setStatusFilters] = useState<Record<StatusFilterKey, boolean>>({
    pending_review: true,
    delivered: true,
    completed: false,
  });
  const [typeFilters, setTypeFilters] = useState<Record<TypeFilterKey, boolean>>({
    return: true,
    exchange: true,
  });

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const paginationRange = useMemo<(number | 'left-ellipsis' | 'right-ellipsis')[]>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const range: (number | 'left-ellipsis' | 'right-ellipsis')[] = [1];
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    if (start > 2) {
      range.push('left-ellipsis');
    }

    for (let current = start; current <= end; current += 1) {
      range.push(current);
    }

    if (end < totalPages - 1) {
      range.push('right-ellipsis');
    }

    range.push(totalPages);
    return range;
  }, [page, totalPages]);
  const [total, setTotal] = useState(0);

  // Selected request for modal
  const [selectedRequest, setSelectedRequest] = useState<ReturnRequest | null>(null);
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null);


  const handleInspectionFilterChange = (key: 'inspected' | 'review') => {
    setInspectionFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setPage(1);
  };

  const handleStatusFilterChange = (key: StatusFilterKey) => {
    setStatusFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setPage(1);
  };

  const handleTypeFilterChange = (key: TypeFilterKey) => {
    setTypeFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setPage(1);
  };

  const autoUpdateStatus = useCallback(async (requestId: string, newStatus: string) => {
    try {
      const response = await fetch('/api/returns/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: requestId,
          status: newStatus,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.warn('Failed to auto update status', data);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Auto status update failed', err);
      return false;
    }
  }, []);

  const checkAndAutoCompleteFromSalla = useCallback(async (requests: ReturnRequest[]) => {
    if (autoCompleting) {
      return false;
    }

    const toComplete = requests.filter((req) => {
      const statusName = req.sallaStatus?.name?.trim();
      const statusSlug = req.sallaStatus?.slug?.trim();
      return (
        (statusName === 'مسترجع' || statusSlug === 'returned') &&
        req.status !== 'completed'
      );
    });

    if (toComplete.length === 0) {
      return false;
    }

    setAutoCompleting(true);
    let hasUpdates = false;

    for (const request of toComplete) {
      const success = await autoUpdateStatus(request.id, 'completed');
      if (success) {
        hasUpdates = true;
      }
    }

    setAutoCompleting(false);
    return hasUpdates;
  }, [autoCompleting, autoUpdateStatus]);

  const loadReturnRequests = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '100',
      });

      const activeTypes = TYPE_FILTER_OPTIONS.filter((option) => typeFilters[option.key]).map(
        (option) => option.key,
      );
      if (activeTypes.length > 0 && activeTypes.length < TYPE_FILTER_OPTIONS.length) {
        activeTypes.forEach((typeKey) => params.append('type', typeKey));
      }

      const activeStatuses = STATUS_FILTER_OPTIONS.filter((option) => statusFilters[option.key]).map(
        (option) => option.key,
      );
      activeStatuses.forEach((status) => {
        params.append('status', status);
      });

      if (inspectionFilters.inspected) {
        params.append('inspection', 'inspected');
      }

      if (inspectionFilters.review) {
        params.append('inspection', 'review');
      }

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      const response = await fetch(`/api/returns/list?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل جلب طلبات الإرجاع');
      }

      setReturnRequests(data.data);
      const hadAutoUpdates = await checkAndAutoCompleteFromSalla(data.data);
      if (hadAutoUpdates) {
        await loadReturnRequests();
        return;
      }
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [checkAndAutoCompleteFromSalla, inspectionFilters, page, searchQuery, statusFilters, typeFilters]);

  useEffect(() => {
    loadReturnRequests();
  }, [loadReturnRequests]);

  const openPreInspectionNotes = (request: ReturnRequest) => {
    const pendingItems = request.items.filter((item) => !item.conditionStatus);
    if (pendingItems.length === 0) {
      alert('تم فحص جميع العناصر بالفعل.');
      return;
    }

    const notes = pendingItems.reduce<Record<string, string>>((acc, item) => {
      acc[item.id] = item.preInspectionNotes || '';
      return acc;
    }, {});

    setNoteEditor({
      requestId: request.id,
      orderNumber: request.orderNumber,
      items: pendingItems,
      notes,
      saving: false,
      error: '',
    });
  };

  const closePreInspectionNotes = () => {
    setNoteEditor(null);
  };

  const updatePreInspectionNote = (itemId: string, value: string) => {
    setNoteEditor((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        notes: {
          ...prev.notes,
          [itemId]: value,
        },
      };
    });
  };

  const savePreInspectionNotes = async () => {
    if (!noteEditor) {
      return;
    }
    if (noteEditor.items.length === 0) {
      setNoteEditor((prev) => (prev ? { ...prev, error: 'لا توجد عناصر لتحديثها' } : prev));
      return;
    }

    const payload = noteEditor.items.map((item) => ({
      itemId: item.id,
      note: noteEditor.notes[item.id] ?? '',
    }));

    setNoteEditor((prev) => (prev ? { ...prev, saving: true, error: '' } : prev));

    try {
      const response = await fetch('/api/returns/pre-inspection-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: noteEditor.requestId,
          notes: payload,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'تعذر حفظ الملاحظات');
      }

      setNoteEditor(null);
      loadReturnRequests();
    } catch (err) {
      setNoteEditor((prev) =>
        prev
          ? {
              ...prev,
              saving: false,
              error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
            }
          : prev,
      );
    }
  };

  const describeNotificationResult = (notification?: { status?: string; error?: string; reason?: string }) => {
    if (!notification || !notification.status) {
      return '';
    }

    if (notification.status === 'sent') {
      return '\nتم إرسال الكوبون للعميل عبر واتساب.';
    }

    if (notification.status === 'skipped') {
      return '\nلم يتم إرسال رسالة واتساب (رقم العميل غير متوفر).';
    }

    if (notification.status === 'failed') {
      return `\nلم يتم إرسال رسالة واتساب: ${notification.error || 'خطأ غير معروف'}.`;
    }

    return '';
  };

  const updateStatus = async (requestId: string, newStatus: string) => {
    try {
      const response = await fetch('/api/returns/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: requestId,
          status: newStatus,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تحديث الحالة');
      }

      // Reload data
      loadReturnRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  const updateRequestType = async (requestId: string, newType: 'return' | 'exchange') => {
    try {
      const response = await fetch('/api/returns/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: requestId,
          type: newType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تحديث النوع');
      }

      loadReturnRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };


  const createCoupon = async (
    requestId: string,
    amount: number,
    options: { autoComplete?: boolean } = {},
  ) => {
    try {
      const response = await fetch('/api/returns/create-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: requestId,
          amount,
          expiryDays: 30,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Check if it's a permission error
        if (data.error?.includes('صلاحيات') || data.error?.includes('marketing')) {
          // Show manual coupon entry option
          const manualCode = prompt(
            'لا يمكن إنشاء الكوبون تلقائياً بسبب صلاحيات غير كافية.\n\n' +
            'يرجى إنشاء الكوبون يدوياً من لوحة تحكم سلة ثم إدخال رمز الكوبون هنا:\n\n' +
            `المبلغ المقترح: ${amount.toFixed(2)} ر.س`
          );

          if (manualCode && manualCode.trim()) {
            await assignManualCoupon(requestId, manualCode.trim(), options);
            return;
          }
        }

        throw new Error(data.error || 'فشل إنشاء الكوبون');
      }

      const notificationMessage = describeNotificationResult(data.notification);
      alert(`تم إنشاء الكوبون بنجاح: ${data.coupon.code}${notificationMessage}`);
      if (options.autoComplete) {
        await updateStatus(requestId, 'completed');
      } else {
        loadReturnRequests();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  const assignManualCoupon = async (
    requestId: string,
    couponCode: string,
    options: { autoComplete?: boolean } = {},
  ) => {
    try {
      const response = await fetch('/api/returns/manual-coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: requestId,
          couponCode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل تعيين الكوبون');
      }

      const notificationMessage = describeNotificationResult(data.notification);
      alert(`تم تعيين الكوبون بنجاح: ${couponCode}${notificationMessage}`);
      if (options.autoComplete) {
        await updateStatus(requestId, 'completed');
      } else {
        loadReturnRequests();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ');
    }
  };

  const handleRefundCompletion = async (request: ReturnRequest) => {
    const amount = resolveRefundAmount(request);
    if (amount == null) {
      alert('يرجى تحديد مبلغ الاسترداد قبل إنهاء الطلب.');
      return;
    }

    const confirmed = window.confirm(
      `هل تم صرف مبلغ ${formatPrice(amount)} ر.س للعميل؟ سيتم تعليم الطلب كمكتمل.`,
    );
    if (!confirmed) {
      return;
    }

    await updateStatus(request.id, 'completed');
  };

  const handleExchangeCompletion = async (request: ReturnRequest) => {
    const amount = resolveRefundAmount(request);
    if (amount == null) {
      alert('يرجى تحديد قيمة الكوبون قبل الإنشاء.');
      return;
    }

    await createCoupon(request.id, amount, { autoComplete: true });
  };

  const handleExchangeFinalize = async (request: ReturnRequest) => {
    if (!request.couponCode) {
      alert('لا يوجد كوبون مرتبط بالطلب، قم بإنشائه أولاً.');
      return;
    }

    const confirmed = window.confirm('سيتم تعليم الطلب كمكتمل بعد تسليم الكوبون للعميل. المتابعة؟');
    if (!confirmed) {
      return;
    }

    await updateStatus(request.id, 'completed');
  };

  const handleReopenRequest = async (request: ReturnRequest) => {
    const confirmed = window.confirm('سيتم إعادة الطلب للمراجعة. هل تريد المتابعة؟');
    if (!confirmed) {
      return;
    }

    await updateStatus(request.id, 'pending_review');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">إدارة طلبات الإرجاع والاستبدال</h1>
            <p className="text-gray-600">
              إجمالي الطلبات: {total}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/returns-priority">
              <Button className="bg-orange-600 hover:bg-orange-700 text-white">
                ⚡ الطلبات عالية الأولوية
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline">← العودة للرئيسية</Button>
            </Link>
          </div>
        </div>

        <Card className="p-6 mb-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold mb-1">تدفق مبسط للطلبات</h2>
            <p className="text-sm text-gray-600">
              تحقق من الطلب، حدّد نوعه، ثم قم بإصدار الاسترداد أو إنشاء كوبون الاستبدال لإنهائه دون المرور بحالات متعددة.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">بحث سريع</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="رقم الطلب، اسم العميل، رقم التتبع..."
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">تصفية حسب حالة الفحص</label>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'review' as const, label: 'تحت المراجعة' },
                { key: 'inspected' as const, label: 'تم فحص القطع' },
              ].map((option) => (
                <label
                  key={option.key}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm cursor-pointer hover:border-blue-400"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={inspectionFilters[option.key]}
                    onChange={() => handleInspectionFilterChange(option.key)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">تصفية حسب نوع الطلب</label>
            <div className="flex flex-wrap gap-4">
              {TYPE_FILTER_OPTIONS.map((option) => (
                <label
                  key={option.key}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm cursor-pointer hover:border-blue-400"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={typeFilters[option.key]}
                    onChange={() => handleTypeFilterChange(option.key)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">تصفية حسب حالة الطلب</label>
            <div className="flex flex-wrap gap-4">
              {STATUS_FILTER_OPTIONS.map((option) => (
                <label
                  key={option.key}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm cursor-pointer hover:border-blue-400"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    checked={statusFilters[option.key]}
                    onChange={() => handleStatusFilterChange(option.key)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </Card>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        ) : returnRequests.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-gray-500 text-lg">لا توجد طلبات</p>
          </Card>
        ) : (
          <>
            {/* Return Requests List */}
            <div className="space-y-4">
              {returnRequests.map((request) => {
                const inspectionSummary = summarizeItemConditions(request.items);
                const sallaStatus = request.sallaStatus;
                const trackingNumber = request.smsaTrackingNumber?.trim() || '';
                const awbNumber = request.smsaAwbNumber?.trim() || '';
                const displayTrackingNumber = trackingNumber || awbNumber;
                const trackingLookupKey = awbNumber || trackingNumber;
                const trackingInfo = request.smsaLiveStatus || null;
                const formattedTrackingTimestamp =
                  trackingInfo?.timestamp ? formatTrackingTimestamp(trackingInfo.timestamp) : null;
                const majorTrackingLabel = resolveMajorSmsaStatus(trackingInfo);
                const hasLiveStatus = Boolean(trackingInfo);
                const canAddInspectorNotes = request.items.some((item) => !item.conditionStatus);
                const inspectorNotesCount = request.items.filter(
                  (item) => item.preInspectionNotes?.trim(),
                ).length;
                const hasPendingInspectorNotes = inspectorNotesCount > 0;
                return (
                  <Card key={request.id} className="p-6 hover:shadow-lg transition-shadow">
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                      {/* Request Info */}
                      <div className="lg:col-span-2">
                        <div className="flex items-start gap-3 mb-3">
                          <div
                            className={`px-3 py-1 rounded-full text-sm font-medium border ${
                              request.type === 'return'
                                ? 'bg-orange-100 text-orange-800 border-orange-300'
                                : 'bg-blue-100 text-blue-800 border-blue-300'
                            }`}
                          >
                            {request.type === 'return' ? 'إرجاع' : 'استبدال'}
                          </div>
                          <div
                            className={`px-3 py-1 rounded-full text-sm font-medium border ${
                              STATUS_COLORS[request.status] || 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {STATUS_LABELS[request.status] || request.status}
                          </div>
                        </div>

                        <h3 className="font-semibold text-lg mb-2">
                          <Link
                            href={`/returns-management/${request.id}`}
                            className="text-blue-700 hover:text-blue-900 hover:underline focus-visible:underline focus-visible:outline-none"
                          >
                            طلب #{request.orderNumber}
                          </Link>
                          {request.orderId && (
                            <div className="text-sm mt-1">
                              <a
                                href={`https://s.salla.sa/orders/order/${request.orderId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-600 hover:text-indigo-800 underline"
                              >
                                فتح الطلب في سلة
                              </a>
                            </div>
                          )}
                        </h3>

                        <div className="text-sm text-gray-600 space-y-1">
                          <p><strong>العميل:</strong> {request.customerName}</p>
                          <p><strong>الهاتف:</strong> {request.customerPhone}</p>
                          {displayTrackingNumber && (
                            <div>
                              <p><strong>رقم التتبع:</strong> {displayTrackingNumber}</p>
                              {hasLiveStatus ? (
                                <p className="text-xs text-indigo-700 mt-1">
                                  <strong>حالة سمسا:</strong>{' '}
                                  <>
                                    {majorTrackingLabel ||
                                      trackingInfo?.description ||
                                      trackingInfo?.code ||
                                      '—'}
                                    {trackingInfo?.city ? ` • ${trackingInfo.city}` : ''}
                                    {formattedTrackingTimestamp ? ` • ${formattedTrackingTimestamp}` : ''}
                                  </>
                                </p>
                              ) : (
                                <p className="text-xs text-gray-500 mt-1">
                                  لا يوجد تحديث من ويب هوك سمسا حتى الآن
                                </p>
                              )}
                              {trackingLookupKey && (
                                <p className="text-xs mt-1">
                                  <a
                                    href={`https://www.smsaexpress.com/sa/ar/trackingdetails?tracknumbers%5B0%5D=${trackingLookupKey}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-indigo-600 hover:text-indigo-800 underline"
                                  >
                                    فتح تتبع سمسا
                                  </a>
                                </p>
                              )}
                            </div>
                          )}
                          <p>
                            <strong>التاريخ:</strong> {gregorianDateFormatter.format(new Date(request.createdAt))}
                          </p>
                          <p><strong>السبب:</strong> {request.reason}</p>
                          {request.reasonDetails && (
                            <p className="text-gray-500 text-xs mt-1">{request.reasonDetails}</p>
                          )}
                          {sallaStatus?.name && (
                            <p>
                              <strong>حالة سلة:</strong> {sallaStatus.name}
                              {sallaStatus.slug ? (
                                <span className="text-xs text-gray-500 ml-2">({sallaStatus.slug})</span>
                              ) : null}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Items */}
                      <div className="lg:col-span-2">
                        <h4 className="font-medium mb-2">المنتجات:</h4>
                        <div className="space-y-1 text-sm">
                          {request.items.map((item) => (
                            <div key={item.id} className="flex justify-between">
                              <span>{item.productName} {item.variantName ? `(${item.variantName})` : ''}</span>
                              <span className="text-gray-600">x{item.quantity}</span>
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-wrap gap-2 mt-3">
                          {inspectionSummary.badges.map((badge, index) => (
                            <span
                              key={`${request.id}-${badge.label}-${index}`}
                              className={`px-3 py-1 rounded-full text-xs font-medium border ${
                                INSPECTION_BADGE_STYLES[badge.tone] || INSPECTION_BADGE_STYLES.muted
                              }`}
                            >
                              {badge.label}
                            </span>
                          ))}
                        </div>

                        {hasPendingInspectorNotes && (
                          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            تم تسجيل ملاحظات للمفتش لـ {inspectorNotesCount} عنصر
                            {inspectorNotesCount > 1 ? '، يمكن تعديلها قبل الفحص.' : '، ويمكن تعديلها قبل الفحص.'}
                          </div>
                        )}

                        {request.totalRefundAmount != null && (
                          <div className="mt-3 pt-3 border-t">
                            <div className="flex justify-between font-semibold">
                              <span>المبلغ المسترد:</span>
                              <span className="text-green-600">
                                {formatPrice(request.totalRefundAmount ?? 0)} ر.س
                              </span>
                            </div>
                          </div>
                        )}

                        {request.couponCode && (
                          <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded">
                            <p className="text-sm font-medium text-green-800">
                              كود الكوبون: {request.couponCode}
                            </p>
                          </div>
                        )}

                        {request.adminNotes && (
                          <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                            <p className="text-xs font-medium text-blue-800 mb-1">ملاحظات الإدارة:</p>
                            <p className="text-sm text-blue-900">{request.adminNotes}</p>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="space-y-3">
                        {canAddInspectorNotes && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => openPreInspectionNotes(request)}
                          >
                            إضافة ملاحظات للمفتش
                          </Button>
                        )}
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            نوع المعالجة
                          </label>
                          <select
                            value={request.type}
                            onChange={(e) =>
                              updateRequestType(request.id, e.target.value as 'return' | 'exchange')
                            }
                            className="w-full px-3 py-2 border rounded-lg text-sm"
                            aria-label="نوع طلب الإرجاع"
                          >
                            <option value="return">استرداد مبلغ</option>
                            <option value="exchange">استبدال بكوبون</option>
                          </select>
                        </div>

                        {request.status !== 'completed' ? (
                          <>
                            {request.type === 'return' && (
                              <Button className="w-full" onClick={() => handleRefundCompletion(request)}>
                                تأكيد الاسترداد وإنهاء الطلب
                              </Button>
                            )}

                            {request.type === 'exchange' && (
                              <>
                                {!request.couponCode ? (
                                  <Button
                                    className="w-full"
                                    variant="outline"
                                    onClick={() => handleExchangeCompletion(request)}
                                  >
                                    إنشاء كوبون وإنهاء الطلب
                                  </Button>
                                ) : (
                                  <Button className="w-full" onClick={() => handleExchangeFinalize(request)}>
                                    إنهاء الطلب بعد إرسال الكوبون
                                  </Button>
                                )}
                              </>
                            )}
                          </>
                        ) : (
                          <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-3 py-2 text-center">
                            تم إنهاء الطلب
                          </div>
                        )}

                        {request.status === 'completed' && (
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => handleReopenRequest(request)}
                          >
                            إعادة للمراجعة
                          </Button>
                        )}

                        <Button onClick={() => setSelectedRequest(request)} variant="outline" className="w-full">
                          التفاصيل
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  variant="outline"
                  className="flex flex-col items-center leading-tight"
                >
                  <span>السابق</span>
                  {page > 1 && (
                    <span className="text-xs text-muted-foreground">صفحة {page - 1}</span>
                  )}
                </Button>
                <div className="flex items-center gap-2 px-2">
                  {paginationRange.map((entry, index) =>
                    typeof entry === 'number' ? (
                      <Button
                        key={`page-${entry}`}
                        variant={entry === page ? 'default' : 'outline'}
                        onClick={() => setPage(entry)}
                        aria-current={entry === page ? 'page' : undefined}
                      >
                        {entry}
                      </Button>
                    ) : (
                      <span key={`ellipsis-${entry}-${index}`} className="px-1 text-sm text-muted-foreground">
                        ...
                      </span>
                    ),
                  )}
                </div>
                <Button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  variant="outline"
                  className="flex flex-col items-center leading-tight"
                >
                  <span>التالي</span>
                  {page < totalPages && (
                    <span className="text-xs text-muted-foreground">صفحة {page + 1}</span>
                  )}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Details Modal */}
        {selectedRequest && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold">تفاصيل الطلب #{selectedRequest.orderNumber}</h2>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">معلومات العميل</h3>
                  <div className="text-sm space-y-1">
                    <p><strong>الاسم:</strong> {selectedRequest.customerName}</p>
                    <p><strong>الهاتف:</strong> {selectedRequest.customerPhone}</p>
                    <p><strong>البريد:</strong> {selectedRequest.customerEmail}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">السبب</h3>
                  <p className="text-sm">{selectedRequest.reason}</p>
                  {selectedRequest.reasonDetails && (
                    <p className="text-sm text-gray-600 mt-1">{selectedRequest.reasonDetails}</p>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold mb-2">المنتجات</h3>
                  {selectedRequest.items.map((item) => (
                    <div key={item.id} className="py-2 border-b">
                      <div className="flex justify-between text-sm">
                        <span>{item.productName}</span>
                        <span>x{item.quantity} - {formatPrice(item.price)} ر.س</span>
                      </div>
                      {item.conditionStatus && (
                        <p className="text-xs text-gray-600 mt-1">
                          حالة الفحص: {CONDITION_LABELS[item.conditionStatus]}{' '}
                          {item.inspectedBy && (
                            <>— {item.inspectedBy}</>
                          )}
                        </p>
                      )}
                      {item.conditionNotes && (
                        <p className="text-xs text-gray-500 mt-1">{item.conditionNotes}</p>
                      )}
                      {item.preInspectionNotes && (
                        <p className="text-xs text-amber-700 mt-1">
                          ملاحظة للمفتش: {item.preInspectionNotes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {selectedRequest.adminNotes && (
                  <div>
                    <h3 className="font-semibold mb-2">ملاحظات الإدارة</h3>
                    <p className="text-sm">{selectedRequest.adminNotes}</p>
                  </div>
                )}
              </div>

              <div className="mt-6 flex gap-3">
                <Button onClick={() => setSelectedRequest(null)} className="flex-1">
                  إغلاق
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Pre-Inspection Notes Modal */}
        {noteEditor && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">ملاحظات للمفتش</h2>
                  <p className="text-sm text-gray-500">طلب #{noteEditor.orderNumber}</p>
                </div>
                <button
                  onClick={closePreInspectionNotes}
                  className="text-gray-500 hover:text-gray-700"
                  aria-label="إغلاق"
                >
                  ✕
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                اكتب ملاحظات حول العيوب التي اكتشفها فريق خدمة العملاء ليطلع عليها فريق الفحص عند وصول الشحنة.
              </p>

              {noteEditor.error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {noteEditor.error}
                </div>
              )}

              {noteEditor.items.length > 0 ? (
                <div className="space-y-4">
                  {noteEditor.items.map((item) => (
                    <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                      <div className="flex flex-wrap justify-between gap-3 text-sm">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {item.productName} {item.variantName ? `(${item.variantName})` : ''}
                          </p>
                          <p className="text-xs text-gray-500">
                            SKU: {item.productSku || '—'}
                          </p>
                        </div>
                        <div className="text-xs text-gray-500">
                          الكمية: x{item.quantity}
                        </div>
                      </div>
                      <textarea
                        rows={3}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="اشرح ما لاحظه العميل أو فريق خدمة العملاء"
                        value={noteEditor.notes[item.id] ?? ''}
                        onChange={(e) => updatePreInspectionNote(item.id, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                  تم فحص جميع العناصر في هذا الطلب.
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={closePreInspectionNotes}
                  disabled={noteEditor.saving}
                >
                  إلغاء
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  onClick={savePreInspectionNotes}
                  disabled={noteEditor.saving || noteEditor.items.length === 0}
                >
                  {noteEditor.saving ? 'جاري الحفظ...' : 'حفظ الملاحظات'}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
