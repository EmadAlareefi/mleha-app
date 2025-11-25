'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useReactToPrint } from 'react-to-print';
import ShippingLabel from '@/components/local-shipping/ShippingLabel';

// Configuration
const MERCHANT_CONFIG = {
  merchantId: process.env.NEXT_PUBLIC_MERCHANT_ID || '1234509876',
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'متجر سلة',
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0501234567',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'شارع الملك فهد، الرياض',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'الرياض',
  logoUrl: process.env.NEXT_PUBLIC_MERCHANT_LOGO || '/logo.png',
};

const todayIso = () => new Date().toISOString().split('T')[0];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(
    Number.isFinite(value) ? value : 0
  );

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function LocalShippingPage() {
  const [orderNumber, setOrderNumber] = useState('');
  const [shipment, setShipment] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [dateRange, setDateRange] = useState({
    start: todayIso(),
    end: todayIso(),
  });
  const labelRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: labelRef,
    documentTitle: `Shipping-Label-${shipment?.orderNumber || orderNumber || 'local'}`,
  });

  const handlePrintClick = () => {
    if (!labelRef.current) {
      setError('لا يوجد ملصق متاح للطباعة بعد');
      return;
    }

    try {
      handlePrint?.();
    } catch {
      setError('حدث خطأ أثناء محاولة الطباعة، جرّب مرة أخرى.');
    }
  };

  const handleGenerateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const response = await fetch('/api/local-shipping/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_CONFIG.merchantId,
          orderNumber: orderNumber.trim(),
          generatedBy: 'admin',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في إنشاء ملصق الشحن');
      }

      setShipment(data.shipment);
      setInfo(data.reused ? 'تم العثور على ملصق سابق لهذا الطلب وتم عرضه.' : '');
      fetchHistory(dateRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setOrderNumber('');
    setShipment(null);
    setError('');
    setInfo('');
  };

  async function fetchHistory(range = dateRange) {
    try {
      setHistoryLoading(true);
      setHistoryError('');

      const params = new URLSearchParams({
        merchantId: MERCHANT_CONFIG.merchantId,
        startDate: range.start,
        endDate: range.end,
      });

      const response = await fetch(`/api/local-shipping/list?${params.toString()}`);
      const contentType = response.headers.get('content-type') || '';

      const parseJson = async () => {
        try {
          return await response.json();
        } catch {
          return null;
        }
      };

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('لا تملك صلاحية للوصول إلى سجل الشحنات. يرجى تسجيل الدخول بحساب مخوّل.');
        }
        const data = contentType.includes('application/json') ? await parseJson() : null;
        const text = !contentType.includes('application/json') ? await response.text() : null;
        throw new Error(data?.error || text || 'تعذر تحميل الشحنات');
      }

      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'استجابة غير متوقعة من الخادم، يرجى إعادة المحاولة.');
      }

      const data = await response.json();
      setHistory(data.shipments || []);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل السجل');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory({ start: todayIso(), end: todayIso() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHistorySubmit = (event: React.FormEvent) => {
    event.preventDefault();
    fetchHistory();
  };

  const handleRangeChange = (key: 'start' | 'end', value: string) => {
    setDateRange((prev) => ({ ...prev, [key]: value }));
  };

  const handleHistorySelect = (record: any) => {
    setShipment(record);
    setInfo('تم تحميل الملصق من سجل الشحنات.');
    setTimeout(() => {
      labelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Navigation */}
        <nav className="flex justify-center gap-3 mb-8">
          <Link
            href="/warehouse"
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            المستودع
          </Link>
          <Link
            href="/local-shipping"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            شحن محلي
          </Link>
        </nav>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">إنشاء ملصق شحن محلي</h1>
          <p className="text-gray-600">
            أدخل رقم الطلب لإنشاء ملصق شحن للمنطقة المحلية
          </p>
        </div>

        {/* Order Input Form */}
        {!shipment && (
          <Card className="p-8">
            <form onSubmit={handleGenerateLabel} className="space-y-6">
              <div>
                <label
                  htmlFor="orderNumber"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  رقم الطلب
                </label>
                <input
                  type="text"
                  id="orderNumber"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="أدخل رقم الطلب (مثال: 2095468130)"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  disabled={loading}
                />
              </div>

              {(error || info) && (
                <div
                  className={`rounded-lg p-4 border ${
                    error
                      ? 'bg-red-50 border-red-200'
                      : 'bg-blue-50 border-blue-200'
                  }`}
                >
                  <p className={`text-sm ${error ? 'text-red-800' : 'text-blue-800'}`}>
                    {error || info}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !orderNumber.trim()}
              >
                {loading ? 'جاري الإنشاء...' : 'إنشاء ملصق الشحن'}
              </Button>
            </form>
          </Card>
        )}

        {/* Shipping Label Display */}
        {shipment && (
          <div className="space-y-6">
            <Card className="p-8">
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-green-600 mb-2">
                  ✓ تم إنشاء ملصق الشحن بنجاح
                </h2>
                <p className="text-gray-600">
                  رقم التتبع: <span className="font-mono font-bold">{shipment.trackingNumber}</span>
                </p>
                {typeof shipment.collectionAmount === 'number' && (
                  <p className="text-sm text-gray-500 mt-2">
                    مبلغ التحصيل:
                    <span className="font-semibold text-gray-800 ml-1">
                      {formatCurrency(shipment.collectionAmount)}
                    </span>
                  </p>
                )}
              </div>

              <div className="flex gap-4 justify-center mb-6">
                <Button onClick={handlePrintClick} className="flex items-center gap-2" type="button">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                  </svg>
                  طباعة الملصق
                </Button>

                <Button onClick={handleReset} variant="outline">
                  إنشاء ملصق جديد
                </Button>
              </div>
            </Card>

            {/* Label Preview */}
            <div className="bg-white shadow-lg rounded-lg p-4">
              <ShippingLabel ref={labelRef} shipment={shipment} merchant={MERCHANT_CONFIG} />
            </div>
          </div>
        )}

        {/* History Section */}
        <section className="mt-10">
          <Card className="p-6 space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">سجل الشحنات المحلية</h2>
                <p className="text-sm text-gray-500">استعرض الشحنات حسب التاريخ</p>
              </div>
              <form
                onSubmit={handleHistorySubmit}
                className="flex flex-col gap-3 md:flex-row md:items-center"
              >
                <div>
                  <label className="block text-xs text-gray-600 mb-1">من تاريخ</label>
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => handleRangeChange('start', e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">إلى تاريخ</label>
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => handleRangeChange('end', e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    required
                  />
                </div>
                <Button type="submit" disabled={historyLoading}>
                  {historyLoading ? 'جاري التحميل...' : 'عرض الشحنات'}
                </Button>
              </form>
            </div>

            {historyError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                {historyError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left bg-gray-100">
                    <th className="px-3 py-2">التاريخ</th>
                    <th className="px-3 py-2">رقم الطلب</th>
                    <th className="px-3 py-2">العميل</th>
                    <th className="px-3 py-2">المدينة</th>
                    <th className="px-3 py-2">مبلغ التحصيل</th>
                    <th className="px-3 py-2">رقم التتبع</th>
                    <th className="px-3 py-2 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && !historyLoading && (
                    <tr>
                      <td colSpan={7} className="text-center text-gray-500 py-6">
                        لا توجد شحنات في هذا التاريخ
                      </td>
                    </tr>
                  )}
                  {history.map((record) => (
                    <tr key={record.id} className="border-b last:border-none">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(record.createdAt)}</td>
                      <td className="px-3 py-2 font-mono">{record.orderNumber}</td>
                      <td className="px-3 py-2">{record.customerName}</td>
                      <td className="px-3 py-2">{record.shippingCity}</td>
                      <td className="px-3 py-2 font-semibold">
                        {formatCurrency(record.collectionAmount ?? 0)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{record.trackingNumber}</td>
                      <td className="px-3 py-2 text-center">
                        <Button size="sm" type="button" onClick={() => handleHistorySelect(record)}>
                          عرض الملصق
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
