'use client';

import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useReactToPrint } from 'react-to-print';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AppNavbar from '@/components/AppNavbar';
import { CommercialInvoice } from '@/components/CommercialInvoice';
import { Search, Printer, AlertCircle } from 'lucide-react';

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
}

export default function OrderInvoiceSearchPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role;
  const roles = ((session?.user as any)?.roles || [role]) as string[];
  const isAuthorized = roles.includes('admin') || roles.includes('warehouse');

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<OrderAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setError('يرجى إدخال رقم الطلب');
      return;
    }

    setSearching(true);
    setError(null);
    setOrder(null);

    try {
      const response = await fetch(`/api/order-assignments/search?orderNumber=${encodeURIComponent(searchQuery.trim())}`);
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

  const getStatusLabel = (status: string, sallaStatus: string | null) => {
    // Check Salla status IDs
    if (sallaStatus === '1065456688') return 'تحت المراجعة';
    if (sallaStatus === '1576217163') return 'تحت المراجعة حجز قطع';
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">البحث عن الطلبات والفواتير</h1>
          <p className="text-gray-600 mb-6">
            يجب تسجيل الدخول كمسؤول أو موظف مستودع للوصول إلى هذه الصفحة
          </p>
          <Button onClick={() => window.location.href = '/login'} className="w-full">
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
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">ابحث عن طلب</h2>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  type="text"
                  placeholder="أدخل رقم الطلب..."
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

          {/* Order Details */}
          {order && (
            <>
              {/* Order Header */}
              <Card className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold">طلب #{order.orderNumber}</h2>
                    <p className="text-gray-600 mt-1">
                      {getStringValue(order.orderData?.customer?.first_name)}{' '}
                      {getStringValue(order.orderData?.customer?.last_name)}
                    </p>
                  </div>
                  <span
                    className={`inline-block px-4 py-2 rounded-full text-sm font-medium border ${getStatusColor(
                      order.status,
                      order.sallaStatus
                    )}`}
                  >
                    {getStatusLabel(order.status, order.sallaStatus)}
                  </span>
                </div>

                {/* Customer Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  {(() => {
                    const location = getStringValue(order.orderData?.customer?.location);
                    const city = getStringValue(order.orderData?.customer?.city);
                    const country = getStringValue(
                      order.orderData?.customer?.country ||
                      order.orderData?.shipping_address?.country ||
                      order.orderData?.billing_address?.country
                    );

                    return (
                      <>
                        {(location || city) && (
                          <div>
                            <p className="text-sm text-gray-500">العنوان</p>
                            <p className="font-medium">
                              {location && `${location}`}
                              {location && city && ' - '}
                              {city}
                            </p>
                          </div>
                        )}
                        {country && (
                          <div>
                            <p className="text-sm text-gray-500">الدولة</p>
                            <p className="font-medium">{country}</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
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
                  {order.completedAt && (
                    <div>
                      <p className="text-sm text-gray-500">تاريخ الإنهاء</p>
                      <p className="font-medium">{formatDate(order.completedAt)}</p>
                    </div>
                  )}
                </div>

                {order.notes && (
                  <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-sm font-medium text-orange-800">ملاحظات:</p>
                    <p className="text-orange-700 mt-1">{order.notes}</p>
                  </div>
                )}
              </Card>

              {/* Products */}
              <Card className="p-6">
                <h3 className="text-lg font-bold mb-4">المنتجات</h3>
                <div className="space-y-4">
                  {order.orderData?.items?.map((item: any, idx: number) => (
                    <div key={idx} className="flex gap-4 p-4 border rounded-lg">
                      {/* Product Image */}
                      <div className="flex-shrink-0">
                        {(item.thumbnail || item.product_thumbnail || item.product?.thumbnail) ? (
                          <img
                            src={item.thumbnail || item.product_thumbnail || item.product?.thumbnail}
                            alt={item.name}
                            className="w-24 h-24 object-contain rounded-lg border bg-white"
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
                      <div className="flex-1">
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
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Print Invoice Button */}
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold">الفاتورة التجارية</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      طباعة الفاتورة التجارية (Commercial Invoice) للشحنات الدولية
                    </p>
                  </div>
                  <Button
                    onClick={handlePrintCommercialInvoice}
                    className="bg-blue-600 hover:bg-blue-700 px-8 py-6 text-lg"
                  >
                    <Printer className="h-5 w-5 ml-2" />
                    طباعة الفاتورة
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Hidden Commercial Invoice for Printing */}
      {order && (
        <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
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
