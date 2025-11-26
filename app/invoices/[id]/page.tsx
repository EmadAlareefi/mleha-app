'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
  rawInvoice: any;
  rawOrder: any;
  erpSyncedAt: string | null;
  erpSyncError: string | null;
  erpSyncAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showRawData, setShowRawData] = useState(false);

  // Fetch invoice details
  const fetchInvoice = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/invoices/${invoiceId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في جلب تفاصيل الفاتورة');
      }

      setInvoice(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  // Sync invoice to ERP
  const handleSyncToERP = async () => {
    if (!invoice || syncing) return;

    const confirmSync = confirm(
      `هل تريد مزامنة الفاتورة ${invoice.invoiceNumber || invoice.invoiceId} مع نظام ERP؟`
    );

    if (!confirmSync) return;

    setSyncing(true);

    try {
      const response = await fetch(`/api/invoices/${invoiceId}/sync-to-erp`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في المزامنة مع نظام ERP');
      }

      alert('تم مزامنة الفاتورة بنجاح مع نظام ERP');

      // Refresh invoice details
      fetchInvoice();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء المزامنة');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  // Format currency
  const formatAmount = (amount: number | null, currency: string | null = 'SAR') => {
    if (amount === null) return '-';
    return `${Number(amount).toFixed(2)} ${currency || 'SAR'}`;
  };

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <div className="max-w-4xl mx-auto">
          <Card className="p-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
              <p className="mt-4 text-gray-600">جاري تحميل تفاصيل الفاتورة...</p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <div className="max-w-4xl mx-auto">
          <Card className="p-12 bg-red-50 border-red-200">
            <div className="text-center">
              <p className="text-red-800 text-lg mb-4">{error || 'الفاتورة غير موجودة'}</p>
              <Link href="/invoices">
                <Button>العودة إلى قائمة الفواتير</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              تفاصيل الفاتورة
            </h1>
            <p className="text-gray-600">
              {invoice.invoiceNumber || invoice.invoiceId}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSyncToERP}
              disabled={syncing || !!invoice.erpSyncedAt}
              className={
                invoice.erpSyncedAt ? 'bg-gray-400 cursor-not-allowed' : ''
              }
            >
              {syncing
                ? 'جاري المزامنة...'
                : invoice.erpSyncedAt
                ? 'تمت المزامنة'
                : 'مزامنة مع ERP'}
            </Button>
            <Link href="/invoices">
              <Button variant="outline">العودة</Button>
            </Link>
          </div>
        </div>

        {/* ERP Sync Status */}
        {invoice.erpSyncedAt && (
          <Card className="p-4 mb-6 bg-green-50 border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-green-900">
                  تم مزامنة الفاتورة مع نظام ERP
                </p>
                <p className="text-sm text-green-700">
                  تاريخ المزامنة: {formatDate(invoice.erpSyncedAt)}
                </p>
              </div>
              <span className="inline-flex items-center px-3 py-1 text-sm font-medium rounded-full bg-green-100 text-green-800">
                متزامن
              </span>
            </div>
          </Card>
        )}

        {invoice.erpSyncError && (
          <Card className="p-4 mb-6 bg-red-50 border-red-200">
            <div>
              <p className="font-medium text-red-900 mb-2">
                خطأ في المزامنة مع ERP (محاولات: {invoice.erpSyncAttempts})
              </p>
              <p className="text-sm text-red-700">{invoice.erpSyncError}</p>
            </div>
          </Card>
        )}

        {/* Invoice Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* General Information */}
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">معلومات عامة</h2>
            <div className="space-y-3">
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">رقم الفاتورة:</span>
                <span className="font-medium">
                  {invoice.invoiceNumber || invoice.invoiceId}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">رقم الطلب:</span>
                <span className="font-medium">
                  {invoice.orderNumber || invoice.orderId || '-'}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">الحالة:</span>
                <span className="font-medium">{invoice.status || '-'}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">حالة الدفع:</span>
                <span className="font-medium">
                  {invoice.paymentStatus || '-'}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">تاريخ الإصدار:</span>
                <span className="font-medium">{formatDate(invoice.issueDate)}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">تاريخ الاستحقاق:</span>
                <span className="font-medium">{formatDate(invoice.dueDate)}</span>
              </div>
            </div>
          </Card>

          {/* Customer Information */}
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">معلومات العميل</h2>
            <div className="space-y-3">
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">اسم العميل:</span>
                <span className="font-medium">
                  {invoice.customerName || '-'}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">رقم الجوال:</span>
                <span className="font-medium">
                  {invoice.customerMobile || '-'}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">البريد الإلكتروني:</span>
                <span className="font-medium text-sm break-all">
                  {invoice.customerEmail || '-'}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-600">معرف العميل:</span>
                <span className="font-medium text-sm">
                  {invoice.customerId || '-'}
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Financial Details */}
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">التفاصيل المالية</h2>
          <div className="space-y-3">
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">المبلغ الفرعي:</span>
              <span className="font-medium">
                {formatAmount(invoice.subtotalAmount, invoice.currency)}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">الضريبة:</span>
              <span className="font-medium">
                {formatAmount(invoice.taxAmount, invoice.currency)}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">الشحن:</span>
              <span className="font-medium">
                {formatAmount(invoice.shippingAmount, invoice.currency)}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">الخصم:</span>
              <span className="font-medium text-red-600">
                {formatAmount(invoice.discountAmount, invoice.currency)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t-2 border-gray-300">
              <span className="text-lg font-bold text-gray-900">
                المبلغ الإجمالي:
              </span>
              <span className="text-lg font-bold text-blue-600">
                {formatAmount(invoice.totalAmount, invoice.currency)}
              </span>
            </div>
          </div>
        </Card>

        {/* Notes */}
        {invoice.notes && (
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">ملاحظات</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
          </Card>
        )}

        {/* Order Items (from rawOrder) */}
        {invoice.rawOrder && invoice.rawOrder.items && (
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">المنتجات</h2>
            <div className="space-y-2">
              {invoice.rawOrder.items.map((item: any, index: number) => (
                <div
                  key={index}
                  className="flex justify-between items-center border-b pb-2"
                >
                  <div className="flex-1">
                    <p className="font-medium">{item.name || item.product?.name}</p>
                    {item.sku && (
                      <p className="text-sm text-gray-500">SKU: {item.sku}</p>
                    )}
                  </div>
                  <div className="text-left">
                    <p className="font-medium">
                      {item.quantity || 1} × {formatAmount(item.price?.amount || item.amount, invoice.currency)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Raw Data (Collapsible) */}
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">البيانات الأولية (JSON)</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRawData(!showRawData)}
            >
              {showRawData ? 'إخفاء' : 'عرض'}
            </Button>
          </div>
          {showRawData && (
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">بيانات الفاتورة:</h3>
                <pre className="bg-gray-100 p-4 rounded-lg overflow-auto text-xs max-h-96">
                  {JSON.stringify(invoice.rawInvoice, null, 2)}
                </pre>
              </div>
              {invoice.rawOrder && (
                <div>
                  <h3 className="font-semibold mb-2">بيانات الطلب:</h3>
                  <pre className="bg-gray-100 p-4 rounded-lg overflow-auto text-xs max-h-96">
                    {JSON.stringify(invoice.rawOrder, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Metadata */}
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">معلومات النظام</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">معرف التاجر:</span>
              <span className="font-medium text-sm">{invoice.merchantId}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">معرف الفاتورة:</span>
              <span className="font-medium text-sm">{invoice.invoiceId}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">تاريخ الإنشاء:</span>
              <span className="font-medium text-sm">
                {formatDate(invoice.createdAt)}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">آخر تحديث:</span>
              <span className="font-medium text-sm">
                {formatDate(invoice.updatedAt)}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
