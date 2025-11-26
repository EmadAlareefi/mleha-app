'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
import { Select } from '@/components/ui/select';

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
  const [searchTerm, setSearchTerm] = useState('');

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
  const fetchInvoices = async () => {
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
  };

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
  }, [pagination.page, erpSyncFilter, statusFilter]);

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
      return (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
          تم المزامنة
        </span>
      );
    } else if (invoice.erpSyncError) {
      return (
        <span
          className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800 cursor-help"
          title={invoice.erpSyncError}
        >
          خطأ ({invoice.erpSyncAttempts})
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
          غير متزامن
        </span>
      );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">الفواتير</h1>
          <p className="text-gray-600">
            إدارة ومزامنة فواتير سلة مع نظام ERP
          </p>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* ERP Sync Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                حالة المزامنة مع ERP
              </label>
              <Select
                value={erpSyncFilter}
                onChange={(e) => setErpSyncFilter(e.target.value)}
              >
                <option value="all">الكل</option>
                <option value="true">تم المزامنة</option>
                <option value="false">غير متزامن</option>
              </Select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                حالة الفاتورة
              </label>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">الكل</option>
                <option value="issued">صادرة</option>
                <option value="paid">مدفوعة</option>
                <option value="unpaid">غير مدفوعة</option>
                <option value="cancelled">ملغاة</option>
              </Select>
            </div>

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
          <Card className="p-4 mb-6 bg-red-50 border-red-200">
            <p className="text-red-800">{error}</p>
          </Card>
        )}

        {/* Invoices Table */}
        <Card className="p-6">
          {loading && invoices.length === 0 ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
              <p className="mt-4 text-gray-600">جاري تحميل الفواتير...</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-600">لا توجد فواتير</p>
            </div>
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
                              <div className="text-sm text-gray-500">
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
                          <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                            {invoice.paymentStatus || invoice.status || '-'}
                          </span>
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
                              className={
                                invoice.erpSyncedAt
                                  ? 'bg-gray-400 cursor-not-allowed'
                                  : ''
                              }
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
                <div className="text-sm text-gray-700">
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
        <div className="mt-6 text-center">
          <Link href="/">
            <Button variant="outline">العودة إلى الصفحة الرئيسية</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
