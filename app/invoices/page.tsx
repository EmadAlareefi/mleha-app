'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Invoice {
  id: string;
  merchantId: string;
  invoiceId: string;
  orderId: string | null;
  orderNumber: string | null;
  invoiceNumber: string | null;
  status: string | null;
  paymentStatus: string | null;
  currency: string | null;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  shippingAmount: number | null;
  discountAmount: number | null;
  issueDate: string | null;
  dueDate: string | null;
  customerId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  notes: string | null;
  erpSyncedAt: string | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
  createdAt: string;
  updatedAt: string;
}

interface PaginationData {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  // Filters
  const [erpSyncFilter, setErpSyncFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Pagination
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    limit: 20,
    totalCount: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  // Fetch invoices
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });

      if (erpSyncFilter !== 'all') {
        params.append('erpSynced', erpSyncFilter);
      }

      if (statusFilter !== 'all') {
        params.append('status', statusFilter);
      }

      const response = await fetch(`/api/invoices?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في جلب الفواتير');
      }

      setInvoices(data.data);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [erpSyncFilter, pagination.limit, pagination.page, statusFilter]);

  // Sync invoice to ERP
  const handleSyncToERP = async (invoice: Invoice) => {
    if (syncing[invoice.id]) return;

    const confirmSync = confirm(
      `هل تريد مزامنة الفاتورة ${invoice.invoiceNumber || invoice.invoiceId} مع نظام ERP؟`
    );

    if (!confirmSync) return;

    setSyncing((prev) => ({ ...prev, [invoice.id]: true }));

    try {
      const response = await fetch(`/api/invoices/${invoice.id}/sync-to-erp`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في المزامنة مع نظام ERP');
      }

      alert('تم مزامنة الفاتورة بنجاح مع نظام ERP');

      // Refresh the list to show updated sync status
      fetchInvoices();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء المزامنة');
    } finally {
      setSyncing((prev) => ({ ...prev, [invoice.id]: false }));
    }
  };

  // Initial load and reload on filter/pagination changes
  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Format currency
  const formatAmount = (amount: number | null, currency: string | null = 'SAR') => {
    if (amount === null) return '-';
    return `${Number(amount).toFixed(2)} ${currency || 'SAR'}`;
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  // Get sync status badge
  const getSyncStatusBadge = (invoice: Invoice) => {
    if (invoice.erpSyncedAt) {
      return <Badge>تم المزامنة</Badge>;
    } else if (invoice.erpSyncError) {
      return (
        <Badge variant="destructive" title={invoice.erpSyncError} className="cursor-help">
          خطأ ({invoice.erpSyncAttempts})
        </Badge>
      );
    } else {
      return <Badge variant="secondary">غير متزامن</Badge>;
    }
  };

  return (
    <AppPageShell
      title="الفواتير"
      subtitle="إدارة ومزامنة فواتير سلة مع نظام ERP"
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="mb-2 text-3xl font-bold">الفواتير</h1>
          <p className="text-muted-foreground">
            إدارة ومزامنة فواتير سلة مع نظام ERP
          </p>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* ERP Sync Status Filter */}
            <Field className="gap-2">
              <FieldLabel>حالة المزامنة مع ERP</FieldLabel>
              <NativeSelect
                value={erpSyncFilter}
                onChange={(e) => setErpSyncFilter(e.target.value)}
              >
                <NativeSelectOption value="all">الكل</NativeSelectOption>
                <NativeSelectOption value="true">تم المزامنة</NativeSelectOption>
                <NativeSelectOption value="false">غير متزامن</NativeSelectOption>
              </NativeSelect>
            </Field>

            {/* Status Filter */}
            <Field className="gap-2">
              <FieldLabel>حالة الفاتورة</FieldLabel>
              <NativeSelect
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <NativeSelectOption value="all">الكل</NativeSelectOption>
                <NativeSelectOption value="issued">صادرة</NativeSelectOption>
                <NativeSelectOption value="paid">مدفوعة</NativeSelectOption>
                <NativeSelectOption value="unpaid">غير مدفوعة</NativeSelectOption>
                <NativeSelectOption value="cancelled">ملغاة</NativeSelectOption>
              </NativeSelect>
            </Field>

            {/* Refresh Button */}
            <div className="flex items-end">
              <Button
                onClick={() => fetchInvoices()}
                disabled={loading}
                className="w-full"
              >
                {loading ? 'جاري التحميل...' : 'تحديث'}
              </Button>
            </div>
          </div>
        </Card>

        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Invoices Table */}
        <Card className="p-6">
          {loading && invoices.length === 0 ? (
            <LoadingState label="جاري تحميل الفواتير..." />
          ) : invoices.length === 0 ? (
            <EmptyState title="لا توجد فواتير" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الفاتورة</TableHead>
                      <TableHead>رقم الطلب</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>المبلغ الإجمالي</TableHead>
                      <TableHead>تاريخ الإصدار</TableHead>
                      <TableHead>حالة الدفع</TableHead>
                      <TableHead>حالة ERP</TableHead>
                      <TableHead>الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">
                          {invoice.invoiceNumber || invoice.invoiceId}
                        </TableCell>
                        <TableCell>
                          {invoice.orderNumber || invoice.orderId || '-'}
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">
                              {invoice.customerName || '-'}
                            </div>
                            {invoice.customerMobile && (
                              <div className="text-sm text-muted-foreground">
                                {invoice.customerMobile}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatAmount(invoice.totalAmount, invoice.currency)}
                        </TableCell>
                        <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {invoice.paymentStatus || invoice.status || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell>{getSyncStatusBadge(invoice)}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Link href={`/invoices/${invoice.id}`}>
                              <Button variant="outline" size="sm">
                                عرض
                              </Button>
                            </Link>
                            <Button
                              size="sm"
                              onClick={() => handleSyncToERP(invoice)}
                              disabled={
                                syncing[invoice.id] || !!invoice.erpSyncedAt
                              }
                              variant={invoice.erpSyncedAt ? 'secondary' : 'default'}
                            >
                              {syncing[invoice.id]
                                ? 'جاري المزامنة...'
                                : invoice.erpSyncedAt
                                ? 'تمت المزامنة'
                                : 'مزامنة ERP'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-6 pt-6 border-t">
                <div className="text-sm text-muted-foreground">
                  عرض {invoices.length} من أصل {pagination.totalCount} فاتورة
                  (صفحة {pagination.page} من {pagination.totalPages})
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setPagination((prev) => ({ ...prev, page: prev.page - 1 }))
                    }
                    disabled={!pagination.hasPreviousPage || loading}
                  >
                    السابق
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setPagination((prev) => ({ ...prev, page: prev.page + 1 }))
                    }
                    disabled={!pagination.hasNextPage || loading}
                  >
                    التالي
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Back to Home */}
        <div className="text-center">
          <Link href="/">
            <Button variant="outline">العودة إلى الصفحة الرئيسية</Button>
          </Link>
        </div>
      </div>
    </AppPageShell>
  );
}
