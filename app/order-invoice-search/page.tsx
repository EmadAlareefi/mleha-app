'use client';

import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { useReactToPrint } from 'react-to-print';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AppNavbar from '@/components/AppNavbar';
import { CommercialInvoice } from '@/components/CommercialInvoice';
import { Search, Printer, AlertCircle, FileText, Globe } from 'lucide-react';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { ServiceKey } from '@/app/lib/service-definitions';

const LABEL_PRINTER_OPTIONS = [
  { id: 75062490, label: 'الطابعة الرئيسية (75062490)' },
  { id: 75006700, label: 'الطابعة الاحتياطية (75006700)' },
] as const;

interface ShipmentInfo {
  id?: string;
  trackingNumber?: string;
  courierName?: string;
  status?: string;
  labelUrl?: string | null;
  labelPrinted?: boolean;
  labelPrintedAt?: string | null;
  printCount?: number | null;
  updatedAt?: string | null;
}

interface OrderAssignment {
  id: string;
  orderId: string;
  orderNumber: string;
  orderData: any;
  status: string;
  sallaStatus: string | null;
  assignedUserId: string;
  assignedUserName: string;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  notes?: string;
  source?: 'assignment' | 'history' | 'salla';
  merchantId?: string;
  shipment?: ShipmentInfo | null;
}

function buildTrackingUrl(
  trackingNumber?: string | null,
  courierName?: string | null,
  labelUrl?: string | null
) {
  if (!trackingNumber) return null;
  const courier = (courierName || '').toLowerCase();
  const label = (labelUrl || '').toLowerCase();

  if (
    courier.includes('smsa') ||
    courier.includes('سمسا') ||
    label.includes('smsa') ||
    label.includes('سمسا')
  ) {
    const encoded = encodeURIComponent(trackingNumber);
    return {
      type: 'smsa',
      url: `https://www.smsaexpress.com/sa/ar/trackingdetails?tracknumbers%5B0%5D=${encoded}`,
    };
  }
  if (courier.includes('aramex')) {
    return {
      type: 'aramex',
      url: `https://www.aramex.com/track/shipments/${trackingNumber}`,
    };
  }
  if (
    courier.includes('ajex') ||
    courier.includes('aj-ex') ||
    courier.includes('أيجكس') ||
    courier.includes('ايجكس') ||
    label.includes('ajex') ||
    label.includes('aj-ex') ||
    label.includes('أيجكس') ||
    label.includes('ايجكس')
  ) {
    const encoded = encodeURIComponent(trackingNumber);
    return {
      type: 'ajex',
      url: `https://aj-ex.com/ar/shipment-status/${encoded}`,
    };
  }
  if (courier.includes('dhl')) {
    return {
      type: 'dhl',
      url: `https://www.dhl.com/global-en/home/tracking/tracking-express.html?AWB=${trackingNumber}&brand=DHL`,
    };
  }
  if (courier.includes('fedex')) {
    return {
      type: 'fedex',
      url: `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`,
    };
  }
  if (courier.includes('ups')) {
    return {
      type: 'ups',
      url: `https://www.ups.com/track?track=yes&trackNums=${trackingNumber}`,
    };
  }

  const encodedQuery = encodeURIComponent(`${trackingNumber} tracking`);
  return {
    type: 'generic',
    url: `https://www.google.com/search?q=${encodedQuery}`,
  };
}

export default function OrderInvoiceSearchPage() {
  const { data: session, status } = useSession();
  const invoiceServiceKey: ServiceKey = 'order-invoice-search';
  const isAuthorized = hasServiceAccess(session, invoiceServiceKey);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<OrderAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printingShipmentPrinter, setPrintingShipmentPrinter] = useState<number | null>(null);
  const [printingInvoiceViaPrintNode, setPrintingInvoiceViaPrintNode] = useState(false);
  const commercialInvoiceRef = useRef<HTMLDivElement>(null);

  const getStringValue = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
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

  const getNumberValue = (value: unknown): number => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      if (obj.value !== undefined) {
        return getNumberValue(obj.value);
      }
    }
    return 0;
  };

  const isSaudiCountry = (country: string) => {
    const normalized = country.toLowerCase().replace(/\s+/g, '');
    const saudiVariants = [
      'sa',
      'ksa',
      'saudiarabia',
      'saudiarabian',
      'saudi',
      'السعودية',
      'المملكةالعربيةالسعودية',
    ];
    return saudiVariants.some((variant) => normalized === variant);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError('يرجى إدخال رقم الطلب، الرقم المرجعي، أو رقم العميل');
      return;
    }

    setSearching(true);
    setError(null);
    setOrder(null);

    try {
      const response = await fetch(`/api/order-assignments/search?query=${encodeURIComponent(searchQuery.trim())}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'فشل في البحث عن الطلب');
        return;
      }

      setOrder(data.assignment);
    } catch (err) {
      console.error('Search error:', err);
      setError('حدث خطأ أثناء البحث عن الطلب');
    } finally {
      setSearching(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const printCommercialInvoice = useReactToPrint({
    contentRef: commercialInvoiceRef,
  });

  const handlePrintCommercialInvoice = () => {
    if (!order) {
      alert('يرجى البحث عن طلب قبل محاولة الطباعة.');
      return;
    }

    if (!commercialInvoiceRef.current) {
      alert('خطأ: الفاتورة غير متاحة للطباعة');
      return;
    }

    try {
      printCommercialInvoice?.();
    } catch (error) {
      console.error('Print error:', error);
      alert('حدث خطأ أثناء محاولة الطباعة، جرّب مرة أخرى.');
    }
  };

  const handleReprintShipmentLabel = async (printerId?: number) => {
    if (!order) {
      return;
    }

    setPrintingShipmentPrinter(printerId ?? -1);
    try {
      const payload: Record<string, string> = {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
      };

      if (order.source === 'assignment') {
        payload.assignmentId = order.id;
      }

      const response = await fetch('/api/salla/shipments/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          ...(typeof printerId === 'number' ? { printerId } : {}),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setOrder((prev) => {
          if (!prev) return prev;

          const labelPrintedAt = data.data?.labelPrintedAt || new Date().toISOString();
          const updatedShipment: ShipmentInfo = {
            ...(prev.shipment || {}),
            labelUrl: data.data?.labelUrl || prev.shipment?.labelUrl || null,
            labelPrinted: true,
            labelPrintedAt,
            printCount: data.data?.printCount ?? ((prev.shipment?.printCount ?? 0) + 1),
          };

          return {
            ...prev,
            shipment: updatedShipment,
          };
        });

        alert(data.message || 'تم إرسال البوليصة للطابعة');
      } else {
        alert(data.error || 'فشل إرسال البوليصة للطابعة');
      }
    } catch (err) {
      console.error('Manual shipment print error:', err);
      alert('فشل إرسال البوليصة للطابعة');
    } finally {
      setPrintingShipmentPrinter(null);
    }
  };

  const handlePrintInvoiceViaPrintNode = async () => {
    if (!order) {
      alert('يرجى البحث عن طلب قبل محاولة الطباعة.');
      return;
    }

    setPrintingInvoiceViaPrintNode(true);
    try {
      const response = await fetch('/api/invoices/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          merchantId: order.merchantId,
          forceInternational: isCommercialInvoiceAvailable,
          shippingCountry,
          allowDomestic: true,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(data.message || 'تم إرسال الفاتورة للطابعة');
      } else {
        alert(data.error || 'فشل إرسال الفاتورة للطابعة');
      }
    } catch (error) {
      console.error('PrintNode invoice error:', error);
      alert('حدث خطأ أثناء إرسال الفاتورة للطابعة');
    } finally {
      setPrintingInvoiceViaPrintNode(false);
    }
  };

  const getStatusLabel = (status: string, sallaStatus: string | null) => {
    // Check Salla status IDs
    if (sallaStatus === '1065456688') return 'تحت المراجعة';
    if (sallaStatus === '1576217163') return 'تحت المراجعة حجز قطع';
    if (sallaStatus === '1882207425') return 'تحت المراجعة ا';
    if (sallaStatus === '2046404155') return 'غير متوفر (ارجاع مبلغ)';
    if (sallaStatus === '165947469') return 'تم الشحن';

    // Fallback to local status
    const statusMap: Record<string, string> = {
      'pending': 'معلق',
      'in_progress': 'جاري التجهيز',
      'preparing': 'قيد التحضير',
      'prepared': 'جاهز',
      'completed': 'مكتمل',
      'shipped': 'تم الشحن',
      'under_review': 'تحت المراجعة',
      'under_review_reservation': 'تحت المراجعة حجز قطع',
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string, sallaStatus: string | null) => {
    // Check Salla status IDs
    if (sallaStatus === '1065456688') return 'bg-orange-100 text-orange-800 border-orange-300';
    if (sallaStatus === '1576217163') return 'bg-purple-100 text-purple-800 border-purple-300';
    if (sallaStatus === '1882207425') return 'bg-blue-100 text-blue-800 border-blue-300';
    if (sallaStatus === '2046404155') return 'bg-rose-100 text-rose-900 border-rose-300';
    if (sallaStatus === '165947469') return 'bg-green-100 text-green-800 border-green-300';

    const colorMap: Record<string, string> = {
      'pending': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'in_progress': 'bg-blue-100 text-blue-800 border-blue-300',
      'preparing': 'bg-blue-100 text-blue-800 border-blue-300',
      'prepared': 'bg-green-100 text-green-800 border-green-300',
      'completed': 'bg-green-100 text-green-800 border-green-300',
      'shipped': 'bg-green-100 text-green-800 border-green-300',
      'under_review': 'bg-orange-100 text-orange-800 border-orange-300',
      'under_review_reservation': 'bg-purple-100 text-purple-800 border-purple-300',
    };
    return colorMap[status] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const formatDate = (value?: unknown) => {
    if (!value) return '';

    const extractDateValue = (input: unknown): string | number | null => {
      if (input instanceof Date) return input.toISOString();
      if (typeof input === 'string' || typeof input === 'number') return input;
      if (typeof input === 'object' && input !== null) {
        const objectValue = input as Record<string, unknown>;
        if ('date' in objectValue && objectValue.date !== undefined) {
          const dateCandidate = objectValue.date as unknown;
          return extractDateValue(dateCandidate);
        }
        if ('value' in objectValue && objectValue.value !== undefined) {
          const valueCandidate = objectValue.value as unknown;
          return extractDateValue(valueCandidate);
        }
      }
      return null;
    };

    const normalized = extractDateValue(value);
    if (normalized === null) {
      return getStringValue(value);
    }

    const parsedDate = new Date(normalized);
    if (Number.isNaN(parsedDate.getTime())) {
      return getStringValue(normalized);
    }
    return parsedDate.toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const shippingAddress = order?.orderData?.shipping_address || order?.orderData?.customer || null;
  const billingAddress = order?.orderData?.billing_address || order?.orderData?.customer || null;
  const customerFirstName = getStringValue(order?.orderData?.customer?.first_name);
  const customerLastName = getStringValue(order?.orderData?.customer?.last_name);
  const fallbackCustomerName = getStringValue(order?.orderData?.customer?.name || order?.orderData?.customer?.full_name);
  const customerName = [customerFirstName, customerLastName].filter(Boolean).join(' ').trim() || fallbackCustomerName;
  const shippingName = getStringValue((shippingAddress as any)?.name) || customerName;
  const billingName = getStringValue((billingAddress as any)?.name) || customerName;
  const shippingCountry = getStringValue((shippingAddress as any)?.country || order?.orderData?.customer?.country || (billingAddress as any)?.country);
  const shippingCity = getStringValue((shippingAddress as any)?.city || order?.orderData?.customer?.city || (billingAddress as any)?.city);
  const shippingStreet = [
    getStringValue((shippingAddress as any)?.address),
    getStringValue((shippingAddress as any)?.address_2 || (shippingAddress as any)?.address2),
    getStringValue((shippingAddress as any)?.street),
  ].filter(Boolean).join('، ');
  const shippingPostalCode = getStringValue((shippingAddress as any)?.zip_code || (shippingAddress as any)?.postal_code);
  const shippingPhoneParts = [
    getStringValue(order?.orderData?.customer?.mobile_code || (shippingAddress as any)?.mobile_code),
    getStringValue(order?.orderData?.customer?.mobile || order?.orderData?.customer?.phone || (shippingAddress as any)?.phone),
  ].filter(Boolean);
  const shippingPhone = shippingPhoneParts.join(' ');
  const shippingLocationLabel = [shippingCity, shippingCountry].filter(Boolean).join('، ');
  const customerEmail = getStringValue(order?.orderData?.customer?.email);

  const billingStreet = [
    getStringValue((billingAddress as any)?.address),
    getStringValue((billingAddress as any)?.address_2 || (billingAddress as any)?.address2),
  ].filter(Boolean).join('، ');
  const billingCity = getStringValue((billingAddress as any)?.city);
  const billingCountry = getStringValue((billingAddress as any)?.country);
  const billingPostalCode = getStringValue((billingAddress as any)?.zip_code || (billingAddress as any)?.postal_code);
  const billingPhoneParts = [
    getStringValue((billingAddress as any)?.mobile_code),
    getStringValue((billingAddress as any)?.mobile || (billingAddress as any)?.phone),
  ].filter(Boolean);
  const billingPhone = billingPhoneParts.join(' ');

  const items = Array.isArray(order?.orderData?.items) ? order?.orderData?.items : [];
  const totalQuantity = items.reduce(
    (total: number, item: any) => total + getNumberValue(item?.quantity ?? (item as any)?.qty ?? 0),
    0,
  );

  const amounts = order?.orderData?.amounts || {};
  const subtotal = getNumberValue((amounts as any)?.sub_total?.amount);
  const shippingCost = getNumberValue((amounts as any)?.shipping_cost?.amount);
  const discount = getNumberValue((amounts as any)?.discount?.amount);
  const tax = getNumberValue((amounts as any)?.tax?.amount);
  const total = getNumberValue((amounts as any)?.total?.amount || (amounts as any)?.grand_total?.amount);
  const currency = getStringValue((amounts as any)?.total?.currency || (amounts as any)?.sub_total?.currency || 'SAR') || 'SAR';
  const formatCurrencyValue = (value: number) => `${value.toFixed(2)} ${currency}`;

  const orderReference = getStringValue(order?.orderData?.reference_id || order?.orderData?.id);
  const orderChannel = getStringValue(order?.orderData?.channel || order?.orderData?.source || order?.orderData?.store?.name);
  const paymentStatus = getStringValue(order?.orderData?.payment_status_text || order?.orderData?.payment_status);
  const paymentMethod = getStringValue(order?.orderData?.payment_method?.name || order?.orderData?.payment_method);
  const shippingMethodName = getStringValue(order?.orderData?.shipping_method?.name || order?.orderData?.shipping_method);
  const deliveryName = getStringValue(order?.orderData?.delivery?.name);
  const courierName = getStringValue(order?.orderData?.delivery?.carrier_name || order?.orderData?.delivery?.courier_name);
  const shippingMethodLabel = [shippingMethodName, deliveryName, courierName].filter(Boolean).filter((value, index, arr) => arr.indexOf(value) === index).join(' • ');
  const shippingNotes = getStringValue(order?.orderData?.delivery?.notes || order?.orderData?.delivery?.instructions || order?.orderData?.notes);
  const shipmentInfo = order?.shipment || null;
  const fallbackTrackingNumber = getStringValue(
    order?.orderData?.delivery?.tracking_number ||
    order?.orderData?.delivery?.tracking ||
    order?.orderData?.delivery?.trackingNumber ||
    order?.orderData?.delivery?.tracking_no ||
    order?.orderData?.delivery?.awb_number ||
    order?.orderData?.delivery?.awbNumber
  );
  const fallbackLabelUrl = getStringValue(
    order?.orderData?.delivery?.label_url ||
    order?.orderData?.delivery?.labelUrl ||
    order?.orderData?.delivery?.label?.url ||
    order?.orderData?.delivery?.label
  );
  const fallbackShipmentStatus = getStringValue(
    order?.orderData?.delivery?.status ||
    order?.orderData?.delivery?.status_label ||
    order?.orderData?.delivery?.statusText
  );
  const resolvedTrackingNumber = shipmentInfo?.trackingNumber || fallbackTrackingNumber;
  const resolvedCourierName = shipmentInfo?.courierName || courierName;
  const resolvedShipmentStatus = shipmentInfo?.status || fallbackShipmentStatus;
  const shipmentLabelUrl = shipmentInfo?.labelUrl || fallbackLabelUrl;
  const shipmentPrintedAt = shipmentInfo?.labelPrintedAt ? formatDate(shipmentInfo.labelPrintedAt) : null;
  const shipmentPrintCount = shipmentInfo?.printCount ?? null;
  const canShowShipmentDetails = Boolean(resolvedTrackingNumber || shipmentLabelUrl || resolvedShipmentStatus);
  const hasPrintableShipmentLabel = Boolean(shipmentInfo && shipmentLabelUrl);
  const isPrintingShipmentLabel = printingShipmentPrinter !== null;
  const shippingTracking = buildTrackingUrl(resolvedTrackingNumber, resolvedCourierName, shipmentLabelUrl);

  const isInternationalOrder = Boolean(order && shippingCountry && !isSaudiCountry(shippingCountry));
  const isCommercialInvoiceAvailable = Boolean(order && isInternationalOrder);
  const shippingTypeLabel = isInternationalOrder ? 'شحنة دولية' : 'شحنة محلية';
  const shippingTypeColor = isInternationalOrder
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : 'bg-blue-100 text-blue-800 border-blue-300';
  const canPrintCommercialInvoice = Boolean(order);

  const orderCreatedAt = order?.orderData?.created_at ? formatDate(order.orderData.created_at) : '';
  const orderUpdatedAt = order?.orderData?.updated_at ? formatDate(order.orderData.updated_at) : '';
  const paymentPaidAt = order?.orderData?.paid_at ? formatDate(order.orderData.paid_at) : '';
  const shipmentCreatedAt = order?.orderData?.delivery?.created_at ? formatDate(order.orderData.delivery.created_at) : '';
  const shipmentShippedAt = order?.orderData?.delivery?.shipped_at ? formatDate(order.orderData.delivery.shipped_at) : '';

  const summaryDetails = order
    ? [
        { label: 'رقم الطلب', value: `#${order.orderNumber}` },
        { label: 'الرقم المرجعي', value: orderReference || '—' },
        { label: 'قناة الطلب', value: orderChannel || '—' },
        { label: 'حالة الدفع', value: paymentStatus || '—' },
        { label: 'طريقة الدفع', value: paymentMethod || '—' },
        { label: 'طريقة الشحن', value: shippingMethodLabel || '—' },
        { label: 'عدد المنتجات', value: `${items.length} منتج` },
        { label: 'إجمالي الكمية', value: totalQuantity ? `×${totalQuantity}` : '—' },
      ]
    : [];

  const timelineEntries = [
    { label: 'تاريخ إنشاء الطلب', value: orderCreatedAt },
    { label: 'آخر تحديث من سلة', value: orderUpdatedAt },
    { label: 'بداية التحضير', value: order?.startedAt ? formatDate(order.startedAt) : '' },
    { label: 'إنهاء التحضير', value: order?.completedAt ? formatDate(order.completedAt) : '' },
    { label: 'تاريخ إنشاء الشحنة', value: shipmentCreatedAt },
    { label: 'تاريخ الشحن', value: shipmentShippedAt },
    { label: 'تاريخ الدفع', value: paymentPaidAt },
  ].filter((entry) => Boolean(entry.value));

  const shippingEntries = order
    ? [
        { label: 'اسم المستلم', value: shippingName || customerName || '—' },
        { label: 'الدولة', value: shippingCountry || '—' },
        { label: 'المدينة', value: shippingCity || '—' },
        { label: 'الشارع', value: shippingStreet || '—' },
        { label: 'الرمز البريدي', value: shippingPostalCode || '—' },
        { label: 'الهاتف', value: shippingPhone || '—' },
        { label: 'البريد الإلكتروني', value: customerEmail || '—' },
      ]
    : [];

  const amountEntries = order
    ? [
        { label: 'المجموع الفرعي', value: formatCurrencyValue(subtotal) },
        { label: 'تكلفة الشحن', value: formatCurrencyValue(shippingCost) },
        { label: 'الخصومات', value: discount ? `-${formatCurrencyValue(Math.abs(discount))}` : formatCurrencyValue(0) },
        { label: 'الضريبة', value: formatCurrencyValue(tax) },
        { label: 'الإجمالي', value: formatCurrencyValue(total) },
      ]
    : [];

  // Show loading while checking session
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg">جاري التحميل...</p>
      </div>
    );
  }

  // If not authenticated or not authorized, show message
  if (!session || !isAuthorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold">البحث عن الطلبات والفواتير</h1>
          <p className="text-gray-600">
            يجب أن يكون حسابك مفعّلاً بخدمة &quot;البحث عن الطلبات&quot; للوصول إلى هذه الصفحة. يرجى التواصل مع
            مسؤول النظام لمنح الصلاحية إذا كنت بحاجة إليها.
          </p>
          <Button onClick={() => (window.location.href = '/login')} className="w-full">
            تسجيل الدخول
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar title="البحث عن الطلبات والفواتير" subtitle="طباعة الفاتورة التجارية" />

      <div className="w-full px-4 md:px-6 py-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Search Section */}
          <Card className="p-6 shadow-sm">
            <div className="flex flex-col gap-2 mb-4">
              <p className="text-sm font-semibold text-blue-600">خطوة البحث</p>
              <h2 className="text-xl font-bold text-gray-900">ابحث عن طلب</h2>
              <p className="text-sm text-gray-600">
                أدخل رقم الطلب من سلة، الرقم المرجعي (Reference) أو رقم جوال العميل للحصول على التفاصيل مباشرة.
              </p>
            </div>
            <div className="flex gap-3 flex-col md:flex-row">
              <div className="flex-1 relative">
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  type="text"
                  placeholder="أدخل رقم الطلب أو الرقم المرجعي أو رقم العميل..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="pr-10 text-right"
                  disabled={searching}
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
                className="bg-blue-600 hover:bg-blue-700 px-8"
              >
                {searching ? 'جاري البحث...' : 'بحث'}
              </Button>
            </div>
            {/* Error Message */}
            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                <p className="text-red-800">{error}</p>
              </div>
            )}
          </Card>

          {!order && (
            <Card className="p-8 text-center text-gray-600 border-dashed">
              <p>ابحث عن الطلب لعرض تفاصيله وطباعة الفاتورة التجارية أو البوليصة عند الحاجة.</p>
            </Card>
          )}

          {/* Order Details */}
          {order && (
            <>
              {/* Order Header */}
              <Card className="p-6 space-y-6">
                {order.source === 'history' && (
                  <div className="p-4 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-800 flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    تم العثور على هذا الطلب في السجلات المكتملة (أرشيف). لا يمكن تعديله ولكن يمكن مراجعة تفاصيله وطباعتها.
                  </div>
                )}
                {order.source === 'salla' && (
                  <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg text-sm text-blue-800 flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    تم جلب هذا الطلب مباشرةً من بيانات سلة. قد لا يكون لديه تعيين داخلي بعد، لكن يمكنك عرض تفاصيله وطباعته.
                  </div>
                )}
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">طلب #{order.orderNumber}</h2>
                    {customerName && (
                      <p className="text-gray-600 mt-1">{customerName}</p>
                    )}
                    {shippingLocationLabel && (
                      <p className="text-sm text-gray-500 mt-1">{shippingLocationLabel}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-2 md:items-end">
                    <span
                      className={`inline-block px-4 py-2 rounded-full text-sm font-medium border ${getStatusColor(
                        order.status,
                        order.sallaStatus
                      )}`}
                    >
                      {getStatusLabel(order.status, order.sallaStatus)}
                    </span>
                    <span className={`inline-block px-4 py-2 rounded-full text-xs font-medium border ${shippingTypeColor}`}>
                      {shippingTypeLabel}
                    </span>
                    {shippingCountry && (
                      <p className="text-xs text-gray-500">الدولة: {shippingCountry}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {shippingEntries.slice(0, 3).map((entry) => (
                    <div key={entry.label}>
                      <p className="text-sm text-gray-500">{entry.label}</p>
                      <p className="font-medium text-gray-900">{entry.value || '—'}</p>
                    </div>
                  ))}
                </div>

                {/* Assignment Info */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                  <div>
                    <p className="text-sm text-gray-500">تم التعيين لـ</p>
                    <p className="font-medium">{order.assignedUserName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">تاريخ التعيين</p>
                    <p className="font-medium">{formatDate(order.assignedAt)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">تاريخ الإنهاء</p>
                    <p className="font-medium">{order.completedAt ? formatDate(order.completedAt) : 'لم يُستكمل بعد'}</p>
                  </div>
                </div>

                {order.notes && (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-sm font-medium text-orange-800">ملاحظات داخلية</p>
                    <p className="text-orange-700 mt-1">{order.notes}</p>
                  </div>
                )}
              </Card>

              {canShowShipmentDetails && (
                <Card className="p-6 space-y-5">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-lg font-bold">تفاصيل الشحنة</h3>
                      <p className="text-sm text-gray-600">مراجعة حالة الشحنة ورابط البوليصة</p>
                    </div>
                    {hasPrintableShipmentLabel && (
                      <div className="flex flex-col gap-2 w-full md:w-auto">
                        {LABEL_PRINTER_OPTIONS.map((printerOption, index) => {
                          const isActivePrinter = printingShipmentPrinter === printerOption.id;
                          const emphasisClasses =
                            index === 0
                              ? 'bg-emerald-600 hover:bg-emerald-700'
                              : 'bg-blue-600 hover:bg-blue-700';

                          return (
                            <Button
                              key={printerOption.id}
                              onClick={() => handleReprintShipmentLabel(printerOption.id)}
                              disabled={isPrintingShipmentLabel}
                              className={`w-full md:w-auto ${emphasisClasses}`}
                            >
                              {isActivePrinter
                                ? 'جاري إرسال البوليصة...'
                                : shipmentInfo?.labelPrinted
                                  ? `إعادة طباعة البوليصة - ${printerOption.label}`
                                  : `طباعة البوليصة - ${printerOption.label}`}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-500">رقم التتبع</p>
                      <p className="font-medium text-gray-900">
                        {shippingTracking?.url ? (
                          <a
                            href={shippingTracking.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-700 underline underline-offset-2"
                          >
                            {resolvedTrackingNumber}
                          </a>
                        ) : (
                          resolvedTrackingNumber || '—'
                        )}
                      </p>
                      {shippingTracking?.url && (
                        <a
                          href={shippingTracking.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-600 underline underline-offset-2"
                        >
                          متابعة الشحنة
                        </a>
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">شركة الشحن</p>
                      <p className="font-medium text-gray-900">{resolvedCourierName || '—'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">حالة الشحنة</p>
                      <p className="font-medium text-gray-900">{resolvedShipmentStatus || '—'}</p>
                    </div>
                  </div>
                  {(shipmentPrintedAt || shipmentPrintCount !== null) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {shipmentPrintedAt && (
                        <div>
                          <p className="text-sm text-gray-500">آخر طباعة</p>
                          <p className="font-medium text-gray-900">{shipmentPrintedAt}</p>
                        </div>
                      )}
                      {shipmentPrintCount !== null && (
                        <div>
                          <p className="text-sm text-gray-500">عدد مرات الطباعة</p>
                          <p className="font-medium text-gray-900">{shipmentPrintCount}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {shipmentLabelUrl && (
                    <a
                      href={shipmentLabelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-700 font-semibold underline underline-offset-2"
                    >
                      عرض رابط البوليصة
                    </a>
                  )}
                </Card>
              )}

              {/* Order Financial Summary */}
              <Card className="p-6 space-y-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-lg font-bold">ملخص الطلب</h3>
                    <p className="text-sm text-gray-600">مراجعة سريعة لقيم الطلب والبيانات المالية</p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-sm text-gray-500">إجمالي الطلب</p>
                    <p className="text-2xl font-bold text-blue-700">{formatCurrencyValue(total || 0)}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      المجموع الفرعي {formatCurrencyValue(subtotal || 0)} • الشحن {formatCurrencyValue(shippingCost || 0)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {summaryDetails.map((detail) => (
                    <div key={detail.label} className="border rounded-lg p-4 bg-white">
                      <p className="text-xs text-gray-500">{detail.label}</p>
                      <p className="font-semibold text-gray-900 mt-1">{detail.value}</p>
                    </div>
                  ))}
                </div>

                {(discount > 0 || tax > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {discount > 0 && (
                      <div className="border rounded-lg p-4 bg-green-50 border-green-200">
                        <p className="text-xs text-green-700">الخصومات</p>
                        <p className="text-lg font-semibold text-green-900 mt-1">{formatCurrencyValue(discount)}</p>
                      </div>
                    )}
                    {tax > 0 && (
                      <div className="border rounded-lg p-4 bg-amber-50 border-amber-200">
                        <p className="text-xs text-amber-700">الضرائب</p>
                        <p className="text-lg font-semibold text-amber-900 mt-1">{formatCurrencyValue(tax)}</p>
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {/* Shipping & Billing Info */}
              <Card className="p-6 space-y-6">
                <h3 className="text-lg font-bold">معلومات الشحن والفوترة</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">الشحن إلى</p>
                    <div className="rounded-lg border p-4 bg-gray-50 space-y-1">
                      <p className="font-semibold">{shippingName || '—'}</p>
                      {shippingStreet && <p className="text-gray-700">{shippingStreet}</p>}
                      {shippingLocationLabel && (
                        <p className="text-gray-700">{shippingLocationLabel}</p>
                      )}
                      {shippingPostalCode && <p className="text-gray-700">الرمز البريدي: {shippingPostalCode}</p>}
                      {shippingPhone && <p className="text-gray-700">هاتف: {shippingPhone}</p>}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">الفوترة</p>
                    <div className="rounded-lg border p-4 bg-gray-50 space-y-1">
                      <p className="font-semibold">{billingName || '—'}</p>
                      {billingStreet && <p className="text-gray-700">{billingStreet}</p>}
                      {[billingCity, billingCountry].filter(Boolean).length > 0 && (
                        <p className="text-gray-700">{[billingCity, billingCountry].filter(Boolean).join('، ')}</p>
                      )}
                      {billingPostalCode && <p className="text-gray-700">الرمز البريدي: {billingPostalCode}</p>}
                      {billingPhone && <p className="text-gray-700">هاتف: {billingPhone}</p>}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-gray-500">بيانات التواصل</p>
                    <div className="mt-2 space-y-1">
                      {customerName && <p className="font-medium">{customerName}</p>}
                      {shippingPhone && <p className="text-gray-700">📞 {shippingPhone}</p>}
                      {customerEmail && <p className="text-gray-700">✉️ {customerEmail}</p>}
                    </div>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-gray-500">ملاحظات الشحن</p>
                    <p className="mt-2 text-gray-800">
                      {shippingNotes || 'لا توجد ملاحظات إضافية'}
                    </p>
                  </div>
                </div>
              </Card>

              <Card className="p-6 space-y-4">
                <h3 className="text-lg font-bold">خلاصة المبالغ</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {amountEntries.map((entry) => (
                    <div key={entry.label} className="border rounded-lg p-4 bg-white">
                      <p className="text-xs text-gray-500">{entry.label}</p>
                      <p className="font-semibold text-gray-900 mt-1">{entry.value}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Timeline */}
              {timelineEntries.length > 0 && (
                <Card className="p-6">
                  <h3 className="text-lg font-bold mb-4">الخط الزمني للطلب</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {timelineEntries.map((entry) => (
                      <div key={entry.label} className="border rounded-lg p-4 bg-gray-50">
                        <p className="text-xs text-gray-500">{entry.label}</p>
                        <p className="font-medium text-gray-900 mt-1">{entry.value}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Products */}
              <Card className="p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-bold">المنتجات</h3>
                  <p className="text-sm text-gray-600">
                    {items.length} منتج • إجمالي الكمية {totalQuantity} قطعة
                  </p>
                </div>
                {items.length === 0 && (
                  <p className="text-sm text-gray-600">لا توجد منتجات مرتبطة بهذا الطلب.</p>
                )}
                <div className="space-y-4">
                  {items.map((item: any, idx: number) => {
                    const rawUnitPrice = item?.amounts?.price_without_tax?.amount ?? item?.amounts?.price?.amount;
                    const rawItemTotal = item?.amounts?.total_without_tax?.amount ?? item?.amounts?.total?.amount;
                    const unitPrice = getNumberValue(rawUnitPrice);
                    const itemTotal = getNumberValue(rawItemTotal);
                    const itemCurrency = getStringValue(item?.amounts?.price_without_tax?.currency || item?.amounts?.price?.currency || currency);
                    const hasUnitPrice = rawUnitPrice !== undefined && rawUnitPrice !== null;
                    const hasItemTotal = rawItemTotal !== undefined && rawItemTotal !== null;

                    return (
                      <div key={idx} className="flex flex-col gap-4 md:flex-row md:items-center p-4 border rounded-lg">
                        {/* Product Image */}
                        <div className="flex-shrink-0">
                          {(item.thumbnail || item.product_thumbnail || item.product?.thumbnail) ? (
                            <Image
                              src={item.thumbnail || item.product_thumbnail || item.product?.thumbnail}
                              alt={item.name || `منتج ${idx + 1}`}
                              width={96}
                              height={96}
                              className="w-24 h-24 object-contain rounded-lg border bg-white"
                              sizes="96px"
                            />
                          ) : (
                            <div className="w-24 h-24 bg-gray-100 rounded-lg border flex items-center justify-center">
                              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Product Details */}
                        <div className="flex-1 w-full">
                          <h4 className="font-bold text-lg">{item.name}</h4>

                          <div className="flex flex-wrap gap-2 mt-2">
                            {item.sku && (
                              <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-300 px-3 py-1 rounded-lg text-sm">
                                <span className="font-semibold text-blue-700">SKU:</span>
                                <span className="text-blue-900">{item.sku}</span>
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 bg-green-50 border border-green-300 px-3 py-1 rounded-lg text-sm">
                              <span className="font-semibold text-green-700">الكمية:</span>
                              <span className="text-green-900">×{item.quantity}</span>
                            </span>
                          </div>

                          {/* Product Options */}
                          {item.options && item.options.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {item.options.map((option: any, optIdx: number) => (
                                <span key={optIdx} className="inline-flex items-center gap-1 bg-purple-50 border border-purple-300 px-3 py-1 rounded-lg text-sm">
                                  <span className="font-medium text-purple-700">{getStringValue(option.name)}:</span>
                                  <span className="text-purple-900">{getStringValue(option.value)}</span>
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-500">السعر للوحدة</p>
                              <p className="font-semibold text-gray-900">{hasUnitPrice ? `${unitPrice.toFixed(2)} ${itemCurrency}` : '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">إجمالي السعر</p>
                              <p className="font-semibold text-gray-900">{hasItemTotal ? `${itemTotal.toFixed(2)} ${itemCurrency}` : '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500">ملاحظات المنتج</p>
                              <p className="font-medium text-gray-900">{getStringValue(item.note || item.description) || '—'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Print Invoice Button */}
              <Card className="p-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-bold">الفاتورة التجارية</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      طباعة الفاتورة التجارية (Commercial Invoice) أصبحت متاحة لكل الطلبات بغض النظر عن الدولة أو المدينة.
                    </p>
                    <p className={`text-sm mt-2 ${isCommercialInvoiceAvailable ? 'text-emerald-700' : 'text-gray-700'}`}>
                      {isCommercialInvoiceAvailable
                        ? `تم التعرف على هذه الشحنة كدولية (${shippingCountry || 'غير محددة'}) وسيتم تطبيق قيم الفاتورة الدولية تلقائياً`
                        : 'لم يتم التعرف على الشحنة كدولية، لكن يمكنك طباعة الفاتورة الإلكترونية لأي دولة أو مدينة متى ما احتجت.'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 w-full md:w-auto">
                    <Button
                      onClick={handlePrintCommercialInvoice}
                      disabled={!canPrintCommercialInvoice}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500 disabled:border-gray-200 px-8 py-6 text-lg"
                    >
                      <Printer className="h-5 w-5 ml-2" />
                      طباعة الفاتورة
                    </Button>
                    <Button
                      onClick={handlePrintInvoiceViaPrintNode}
                      disabled={!canPrintCommercialInvoice || printingInvoiceViaPrintNode}
                      variant="outline"
                      className="px-8 py-6 text-lg disabled:bg-gray-200 disabled:text-gray-500 disabled:border-gray-200"
                    >
                      <Printer className="h-5 w-5 ml-2" />
                      {printingInvoiceViaPrintNode ? 'جاري الإرسال للطابعة...' : 'إرسال الفاتورة إلى PrintNode'}
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Hidden Commercial Invoice for Printing */}
      {order && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            width: 0,
            height: 0,
            overflow: 'hidden',
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          <CommercialInvoice
            ref={commercialInvoiceRef}
            orderData={order.orderData}
            orderNumber={order.orderNumber}
          />
        </div>
      )}
    </div>
  );
}
