'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  CheckCircle2,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';

const ERP_REFUND_INVOICE_ID_HEADER = 'رقم فاتورة المرتجع ERP';

type CellValue = string | number | null;

type InvoiceRefundRow = {
  rowKey: string;
  rowNumber: number;
  sheetName: string;
  cells: Record<string, CellValue>;
  orderNumber: string | null;
  orderFound: boolean;
  orderStatus: string | null;
  erpRefundInvoiceId: string | null;
  effectiveERPRefundInvoiceId: string | null;
  duplicateCount: number;
  hasConflictingERPRefundIds: boolean;
  status: 'ready' | 'refunded' | 'missing_order_number' | 'order_not_found' | 'conflict';
  statusLabel: string;
  statusMessage: string | null;
  canRefund: boolean;
};

type InvoiceRefundWorkbookResponse = {
  fileName: string;
  filePath: string;
  sheetName: string;
  modifiedAt: string;
  headers: string[];
  rows: InvoiceRefundRow[];
};

type FeedbackState =
  | {
      type: 'success' | 'error';
      text: string;
    }
  | null;

type RefundApiResponse = {
  success: boolean;
  alreadyRecorded: boolean;
  erpInvoiceId: string;
  updatedRowNumbers: number[];
  message: string;
};

const formatDateTime = (value: string) => {
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

const formatCellValue = (value: CellValue) => {
  if (value == null || value === '') {
    return '-';
  }

  return String(value);
};

export default function InvoiceRefundsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasAccess = hasServiceAccess(session, 'invoice-refunds');

  const [workbookData, setWorkbookData] = useState<InvoiceRefundWorkbookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [refundingRows, setRefundingRows] = useState<Record<string, boolean>>({});
  const [bulkRefunding, setBulkRefunding] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    processed: number;
    total: number;
    success: number;
    failed: number;
    currentRowNumber: number | null;
  } | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [router, status]);

  const loadWorkbook = useCallback(async (showRefreshState = false) => {
    try {
      if (showRefreshState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const response = await fetch('/api/invoice-refunds');
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'فشل في تحميل ملف invoices.xlsx');
      }

      setWorkbookData(payload);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'فشل في تحميل ملف invoices.xlsx',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && hasAccess) {
      void loadWorkbook();
    }
  }, [hasAccess, loadWorkbook, status]);

  const filteredRows = useMemo(() => {
    const rows = workbookData?.rows || [];
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return rows;
    }

    return rows.filter((row) => {
      const searchableParts = [
        row.rowNumber,
        row.orderNumber,
        row.orderStatus,
        row.effectiveERPRefundInvoiceId,
        row.statusLabel,
        row.statusMessage,
        ...Object.values(row.cells),
      ];

      return searchableParts.some((value) =>
        String(value ?? '')
          .toLowerCase()
          .includes(normalizedSearch)
      );
    });
  }, [searchTerm, workbookData?.rows]);

  const summary = useMemo(() => {
    const rows = workbookData?.rows || [];

    return {
      total: rows.length,
      refunded: rows.filter((row) => row.status === 'refunded').length,
      ready: rows.filter((row) => row.status === 'ready').length,
      review: rows.filter((row) => row.status !== 'ready' && row.status !== 'refunded').length,
    };
  }, [workbookData?.rows]);

  const pendingRows = useMemo(
    () => (workbookData?.rows || []).filter((row) => row.canRefund),
    [workbookData?.rows]
  );

  const applyRefundSuccessToState = useCallback((rowKey: string, erpInvoiceId: string) => {
    setWorkbookData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        rows: current.rows.map((row) =>
          row.rowKey === rowKey
            ? {
                ...row,
                erpRefundInvoiceId: erpInvoiceId,
                effectiveERPRefundInvoiceId: erpInvoiceId,
                status: 'refunded',
                statusLabel: 'تم تسجيل المرتجع',
                statusMessage: 'تم حفظ رقم مرتجع ERP لهذا الصف داخل الملف.',
                canRefund: false,
                hasConflictingERPRefundIds: false,
              }
            : row
        ),
      };
    });
  }, []);

  const requestRefund = useCallback(async (row: InvoiceRefundRow): Promise<RefundApiResponse> => {
    const response = await fetch('/api/invoice-refunds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rowNumber: row.rowNumber,
        sheetName: row.sheetName,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'فشل في إنشاء مرتجع ERP');
    }

    return payload as RefundApiResponse;
  }, []);

  const handleRefund = async (row: InvoiceRefundRow) => {
    if (!row.canRefund || refundingRows[row.rowKey] || bulkRefunding) {
      return;
    }

    const confirmed = confirm(
      `هل تريد إنشاء مرتجع ERP للطلب ${row.orderNumber || `في الصف ${row.rowNumber}`}؟`
    );

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setRefundingRows((current) => ({
      ...current,
      [row.rowKey]: true,
    }));

    try {
      const payload = await requestRefund(row);
      applyRefundSuccessToState(row.rowKey, payload.erpInvoiceId);

      setFeedback({
        type: 'success',
        text:
          payload.message ||
          `تم حفظ رقم مرتجع ERP ${payload.erpInvoiceId} لهذا الصف.`,
      });

      await loadWorkbook(true);
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'فشل في إنشاء مرتجع ERP',
      });
    } finally {
      setRefundingRows((current) => ({
        ...current,
        [row.rowKey]: false,
      }));
    }
  };

  const handleRefundAllPendingRows = async () => {
    if (bulkRefunding) {
      return;
    }

    if (pendingRows.length === 0) {
      setFeedback({
        type: 'error',
        text: 'لا توجد صفوف جاهزة للاسترداد حالياً.',
      });
      return;
    }

    const confirmed = confirm(
      `سيتم إنشاء مرتجع ERP مستقل لكل صف جاهز. عدد الصفوف الجاهزة حالياً: ${pendingRows.length}. هل تريد المتابعة؟`
    );

    if (!confirmed) {
      return;
    }

    setFeedback(null);
    setBulkRefunding(true);
    setBulkProgress({
      processed: 0,
      total: pendingRows.length,
      success: 0,
      failed: 0,
      currentRowNumber: pendingRows[0]?.rowNumber ?? null,
    });

    let successCount = 0;
    let failedCount = 0;
    const failedRows: number[] = [];

    for (let index = 0; index < pendingRows.length; index += 1) {
      const row = pendingRows[index];

      setRefundingRows((current) => ({
        ...current,
        [row.rowKey]: true,
      }));

      try {
        const payload = await requestRefund(row);
        successCount += 1;
        applyRefundSuccessToState(row.rowKey, payload.erpInvoiceId);
      } catch (error) {
        failedCount += 1;
        failedRows.push(row.rowNumber);
        console.error('Bulk refund failed for row', row.rowNumber, error);
      } finally {
        setRefundingRows((current) => ({
          ...current,
          [row.rowKey]: false,
        }));
      }

      setBulkProgress({
        processed: index + 1,
        total: pendingRows.length,
        success: successCount,
        failed: failedCount,
        currentRowNumber:
          index + 1 < pendingRows.length ? pendingRows[index + 1].rowNumber : null,
      });
    }

    setBulkRefunding(false);

    setFeedback({
      type: successCount > 0 ? 'success' : 'error',
      text:
        failedCount === 0
          ? `تم إنشاء ${successCount} مرتجع ERP وحفظها في الملف.`
          : `تم إنشاء ${successCount} مرتجع ERP، وفشل ${failedCount} صف. الصفوف الفاشلة: ${failedRows
              .slice(0, 10)
              .join(', ')}${failedRows.length > 10 ? ' ...' : ''}`,
    });

    await loadWorkbook(true);
    setBulkProgress(null);
  };

  const getStatusBadgeClasses = (statusValue: InvoiceRefundRow['status']) => {
    switch (statusValue) {
      case 'ready':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'refunded':
        return 'border-sky-200 bg-sky-50 text-sky-700';
      case 'conflict':
        return 'border-rose-200 bg-rose-50 text-rose-700';
      default:
        return 'border-amber-200 bg-amber-50 text-amber-700';
    }
  };

  if (status === 'loading' || (status === 'authenticated' && loading && !workbookData)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
        <AppNavbar title="مرتجعات الفواتير" subtitle="جاري تحميل بيانات الملف" />
        <main className="mx-auto flex min-h-[50vh] max-w-7xl items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <LoaderCircle className="h-5 w-5 animate-spin text-emerald-600" />
            <span className="text-sm text-slate-600">جاري تحميل الملف...</span>
          </div>
        </main>
      </div>
    );
  }

  if (status === 'authenticated' && !hasAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
        <AppNavbar title="مرتجعات الفواتير" subtitle="لا تملك صلاحية الوصول لهذه الصفحة" />
        <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <Card className="rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-sm">
            <AlertCircle className="mx-auto mb-4 h-10 w-10 text-rose-500" />
            <h2 className="text-2xl font-bold text-slate-900">لا تملك صلاحية الوصول</h2>
            <p className="mt-3 text-sm text-slate-600">
              هذه الصفحة متاحة فقط للحسابات المخولة بخدمة مرتجعات الفواتير.
            </p>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
      <AppNavbar
        title="مرتجعات الفواتير"
        subtitle="إنشاء مرتجع ERP مستقل لكل صف داخل invoices.xlsx وحفظ رقم المرتجع في نفس الصف"
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="grid gap-4 md:grid-cols-4">
          <Card className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">إجمالي الصفوف</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{summary.total}</p>
          </Card>
          <Card className="rounded-3xl border border-emerald-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">جاهزة للاسترداد</p>
            <p className="mt-2 text-3xl font-bold text-emerald-700">{summary.ready}</p>
          </Card>
          <Card className="rounded-3xl border border-sky-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">تم تسجيل المرتجع</p>
            <p className="mt-2 text-3xl font-bold text-sky-700">{summary.refunded}</p>
          </Card>
          <Card className="rounded-3xl border border-amber-100 bg-white/95 p-5 shadow-sm">
            <p className="text-sm text-slate-500">تحتاج مراجعة</p>
            <p className="mt-2 text-3xl font-bold text-amber-700">{summary.review}</p>
          </Card>
        </section>

        <Card className="mt-6 rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-slate-900">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                <h2 className="text-xl font-semibold">ملف المرتجعات</h2>
              </div>
              <p className="text-sm text-slate-600">
                الملف: <span className="font-medium text-slate-900">{workbookData?.fileName || '-'}</span>
              </p>
              <p className="text-sm text-slate-600">
                آخر تعديل: <span className="font-medium text-slate-900">{workbookData?.modifiedAt ? formatDateTime(workbookData.modifiedAt) : '-'}</span>
              </p>
              <p className="text-sm text-slate-600">
                الورقة: <span className="font-medium text-slate-900">{workbookData?.sheetName || '-'}</span>
              </p>
              <p className="text-sm text-amber-700">
                الصفوف المكررة لنفس الطلب ستُعالج كصفوف مستقلة، وليس كمرتجع واحد.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="ابحث برقم الطلب أو العميل أو رقم مرتجع ERP"
                className="w-full rounded-2xl border-slate-200 sm:w-80"
              />
              <Button
                type="button"
                className="rounded-2xl bg-emerald-600 hover:bg-emerald-700"
                onClick={handleRefundAllPendingRows}
                disabled={bulkRefunding || pendingRows.length === 0}
              >
                {bulkRefunding ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                Refund All Pending Rows ({pendingRows.length})
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl"
                onClick={() => loadWorkbook(true)}
                disabled={refreshing || bulkRefunding}
              >
                {refreshing ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                تحديث
              </Button>
            </div>
          </div>

          {bulkProgress && (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p>
                تقدم التنفيذ: {bulkProgress.processed} / {bulkProgress.total}
              </p>
              <p>
                نجاح: {bulkProgress.success} | فشل: {bulkProgress.failed}
              </p>
              <p>
                الصف الحالي: {bulkProgress.currentRowNumber ?? 'اكتمل التنفيذ'}
              </p>
            </div>
          )}

          {feedback && (
            <div
              className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
                feedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}
        </Card>

        <Card className="mt-6 rounded-3xl border border-slate-200 bg-white/95 p-0 shadow-sm">
          <Table className="min-w-[1500px]">
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="w-[80px]">الصف</TableHead>
                {workbookData?.headers.map((header) => (
                  <TableHead key={header}>{header}</TableHead>
                ))}
                <TableHead>رقم الطلب المستخرج</TableHead>
                <TableHead>حالة الطلب</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="w-[150px]">الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={(workbookData?.headers.length || 0) + 5}
                    className="py-10 text-center text-slate-500"
                  >
                    لا توجد صفوف مطابقة لنتيجة البحث.
                  </TableCell>
                </TableRow>
              )}

              {filteredRows.map((row) => (
                <TableRow key={row.rowKey} className="align-top">
                  <TableCell className="font-medium text-slate-900">{row.rowNumber}</TableCell>

                  {workbookData?.headers.map((header) => {
                    const cellValue =
                      header === ERP_REFUND_INVOICE_ID_HEADER
                        ? row.effectiveERPRefundInvoiceId || row.cells[header]
                        : row.cells[header];

                    return (
                      <TableCell key={`${row.rowKey}:${header}`} className="max-w-[220px]">
                        <div className="whitespace-pre-wrap break-words text-sm text-slate-700">
                          {formatCellValue(cellValue)}
                        </div>
                      </TableCell>
                    );
                  })}

                  <TableCell className="font-mono text-sm text-slate-700">
                    {row.orderNumber || '-'}
                    {row.duplicateCount > 1 && (
                      <div className="mt-1 text-xs text-amber-600">
                        مكرر داخل الملف × {row.duplicateCount}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="text-sm text-slate-700">
                    {row.orderFound ? row.orderStatus || 'بدون حالة' : '-'}
                  </TableCell>

                  <TableCell>
                    <div
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getStatusBadgeClasses(
                        row.status
                      )}`}
                    >
                      {row.statusLabel}
                    </div>
                    {row.statusMessage && (
                      <p className="mt-2 max-w-[240px] text-xs leading-5 text-slate-500">
                        {row.statusMessage}
                      </p>
                    )}
                  </TableCell>

                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => handleRefund(row)}
                      disabled={!row.canRefund || refundingRows[row.rowKey] || bulkRefunding}
                    >
                      {refundingRows[row.rowKey] ? (
                        <>
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          جاري التنفيذ
                        </>
                      ) : row.status === 'refunded' ? (
                        'تم الحفظ'
                      ) : (
                        'Refund'
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </main>
    </div>
  );
}
