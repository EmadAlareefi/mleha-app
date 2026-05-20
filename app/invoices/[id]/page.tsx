'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

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
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [showRawData, setShowRawData] = useState(false);

  // Fetch invoice details
  const fetchInvoice = useCallback(async () => {
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
  }, [invoiceId]);

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
  }, [fetchInvoice]);

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

  const renderDetailRow = (label: string, value: ReactNode, className = '') => (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-left text-sm font-medium ${className}`}>{value}</span>
    </div>
  );

  if (loading) {
    return (
      <AppPageShell title="تفاصيل الفاتورة" subtitle="جاري تحميل بيانات الفاتورة">
        <Card>
          <CardContent className="pt-6">
            <LoadingState label="جاري تحميل تفاصيل الفاتورة..." />
          </CardContent>
        </Card>
      </AppPageShell>
    );
  }

  if (error || !invoice) {
    return (
      <AppPageShell title="تفاصيل الفاتورة" subtitle="تعذر تحميل بيانات الفاتورة">
        <EmptyState
          title={error || 'الفاتورة غير موجودة'}
          description="تحقق من رقم الفاتورة أو ارجع إلى قائمة الفواتير."
          action={
            <Button asChild>
              <Link href="/invoices">العودة إلى قائمة الفواتير</Link>
            </Button>
          }
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell
      title="تفاصيل الفاتورة"
      subtitle={invoice.invoiceNumber || invoice.invoiceId}
      contentClassName="flex flex-1 flex-col gap-6 p-4 md:p-6"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{invoice.status || 'بدون حالة'}</Badge>
            <Badge variant={invoice.erpSyncedAt ? 'default' : 'secondary'}>
              {invoice.erpSyncedAt ? 'متزامن مع ERP' : 'غير متزامن'}
            </Badge>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={handleSyncToERP}
              disabled={syncing || !!invoice.erpSyncedAt}
            >
              {syncing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  جاري المزامنة...
                </>
              ) : invoice.erpSyncedAt ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  تمت المزامنة
                </>
              ) : (
                'مزامنة مع ERP'
              )}
            </Button>
            <Button asChild variant="outline">
              <Link href="/invoices">العودة</Link>
            </Button>
          </div>
        </div>

        {invoice.erpSyncedAt && (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>تم مزامنة الفاتورة مع نظام ERP</AlertTitle>
            <AlertDescription className="text-emerald-700">
              تاريخ المزامنة: {formatDate(invoice.erpSyncedAt)}
            </AlertDescription>
          </Alert>
        )}

        {invoice.erpSyncError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>خطأ في المزامنة مع ERP (محاولات: {invoice.erpSyncAttempts})</AlertTitle>
            <AlertDescription>{invoice.erpSyncError}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>معلومات عامة</CardTitle>
            </CardHeader>
            <CardContent>
              {renderDetailRow('رقم الفاتورة:', invoice.invoiceNumber || invoice.invoiceId)}
              {renderDetailRow('رقم الطلب:', invoice.orderNumber || invoice.orderId || '-')}
              {renderDetailRow('الحالة:', invoice.status || '-')}
              {renderDetailRow('حالة الدفع:', invoice.paymentStatus || '-')}
              {renderDetailRow('تاريخ الإصدار:', formatDate(invoice.issueDate))}
              {renderDetailRow('تاريخ الاستحقاق:', formatDate(invoice.dueDate))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>معلومات العميل</CardTitle>
            </CardHeader>
            <CardContent>
              {renderDetailRow('اسم العميل:', invoice.customerName || '-')}
              {renderDetailRow('رقم الجوال:', invoice.customerMobile || '-')}
              {renderDetailRow('البريد الإلكتروني:', invoice.customerEmail || '-', 'break-all')}
              {renderDetailRow('معرف العميل:', invoice.customerId || '-', 'break-all')}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>التفاصيل المالية</CardTitle>
          </CardHeader>
          <CardContent>
            {renderDetailRow('المبلغ الفرعي:', formatAmount(invoice.subtotalAmount, invoice.currency))}
            {renderDetailRow('الضريبة:', formatAmount(invoice.taxAmount, invoice.currency))}
            {renderDetailRow('الشحن:', formatAmount(invoice.shippingAmount, invoice.currency))}
            {renderDetailRow('الخصم:', formatAmount(invoice.discountAmount, invoice.currency), 'text-destructive')}
            <div className="flex items-start justify-between gap-4 pt-4">
              <span className="text-base font-semibold">المبلغ الإجمالي:</span>
              <span className="text-left text-lg font-bold text-primary">
                {formatAmount(invoice.totalAmount, invoice.currency)}
              </span>
            </div>
          </CardContent>
        </Card>

        {invoice.notes && (
          <Card>
            <CardHeader>
              <CardTitle>ملاحظات</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{invoice.notes}</p>
            </CardContent>
          </Card>
        )}

        {invoice.rawOrder && invoice.rawOrder.items && (
          <Card>
            <CardHeader>
              <CardTitle>المنتجات</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
              {invoice.rawOrder.items.map((item: any, index: number) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4 border-b pb-3 last:border-b-0"
                >
                  <div className="flex-1">
                    <p className="font-medium">{item.name || item.product?.name}</p>
                    {item.sku && (
                      <p className="text-sm text-muted-foreground">SKU: {item.sku}</p>
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
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle>البيانات الأولية (JSON)</CardTitle>
              <CardDescription>بيانات سلة الخام للفحص والدعم الفني.</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRawData(!showRawData)}
            >
              {showRawData ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showRawData ? 'إخفاء' : 'عرض'}
            </Button>
          </CardHeader>
          {showRawData && (
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-semibold mb-2">بيانات الفاتورة:</h3>
                <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs">
                  {JSON.stringify(invoice.rawInvoice, null, 2)}
                </pre>
              </div>
              {invoice.rawOrder && (
                <div>
                  <h3 className="font-semibold mb-2">بيانات الطلب:</h3>
                  <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-xs">
                    {JSON.stringify(invoice.rawOrder, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>معلومات النظام</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {renderDetailRow('معرف التاجر:', invoice.merchantId, 'break-all')}
            {renderDetailRow('معرف الفاتورة:', invoice.invoiceId, 'break-all')}
            {renderDetailRow('تاريخ الإنشاء:', formatDate(invoice.createdAt))}
            {renderDetailRow('آخر تحديث:', formatDate(invoice.updatedAt))}
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}
