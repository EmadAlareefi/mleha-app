'use client';

import { useState, useRef } from 'react';
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
};

export default function LocalShippingPage() {
  const [orderNumber, setOrderNumber] = useState('');
  const [shipment, setShipment] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const labelRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    content: () => labelRef.current,
    documentTitle: `Shipping-Label-${orderNumber}`,
  });

  const handleGenerateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
          <Link
            href="/returns"
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium"
          >
            الإرجاع
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

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-red-800 text-sm">{error}</p>
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
              </div>

              <div className="flex gap-4 justify-center mb-6">
                <Button onClick={handlePrint} className="flex items-center gap-2">
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
      </div>
    </div>
  );
}
