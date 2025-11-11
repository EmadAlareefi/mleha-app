'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import ReturnForm from '@/components/returns/ReturnForm';
import SuccessScreen from '@/components/returns/SuccessScreen';

// Configuration - Replace with your actual merchant info
const MERCHANT_CONFIG = {
  merchantId: process.env.NEXT_PUBLIC_MERCHANT_ID || '1234509876', // Replace with actual merchant ID
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'متجر سلة',
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0501234567',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'شارع الملك فهد، الرياض',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'الرياض',
};

type Step = 'lookup' | 'form' | 'success';

export default function ReturnsPage() {
  const [step, setStep] = useState<Step>('lookup');
  const [orderNumber, setOrderNumber] = useState('');
  const [order, setOrder] = useState<any>(null);
  const [returnRequest, setReturnRequest] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLookupOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(
        `/api/orders/lookup?merchantId=${MERCHANT_CONFIG.merchantId}&orderNumber=${encodeURIComponent(orderNumber)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل في العثور على الطلب');
      }

      setOrder(data.order);
      setStep('form');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const handleReturnSuccess = (request: any) => {
    setReturnRequest(request);
    setStep('success');
  };

  const handleReset = () => {
    setStep('lookup');
    setOrderNumber('');
    setOrder(null);
    setReturnRequest(null);
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
          <h1 className="text-3xl font-bold mb-2">طلب إرجاع أو استبدال</h1>
          <p className="text-gray-600">
            يرجى إدخال رقم الطلب للبدء في عملية الإرجاع أو الاستبدال
          </p>
        </div>

        {/* Step 1: Order Lookup */}
        {step === 'lookup' && (
          <Card className="p-8">
            <form onSubmit={handleLookupOrder} className="space-y-6">
              <div>
                <label htmlFor="orderNumber" className="block text-sm font-medium mb-2">
                  رقم الطلب
                </label>
                <input
                  id="orderNumber"
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="مثال: ORD-123456"
                  className="w-full px-4 py-3 border rounded-lg text-lg"
                  required
                  disabled={loading}
                />
                <p className="text-sm text-gray-500 mt-2">
                  يمكنك العثور على رقم الطلب في رسالة التأكيد المرسلة إليك عبر البريد الإلكتروني
                </p>
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !orderNumber.trim()}
                className="w-full py-6 text-lg"
              >
                {loading ? 'جاري البحث...' : 'البحث عن الطلب'}
              </Button>
            </form>

            {/* Info Box */}
            <div className="mt-8 pt-6 border-t">
              <h3 className="font-semibold mb-2">شروط الإرجاع والاستبدال:</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                <li>يجب أن يكون الطلب قد تم تسليمه بنجاح</li>
                <li>يجب أن تكون المنتجات في حالتها الأصلية مع العبوة إن أمكن</li>
                <li>مدة الإرجاع والاستبدال 14 يوماً من تاريخ الاستلام</li>
                <li>بعض المنتجات قد لا تكون قابلة للإرجاع (مثل المنتجات القابلة للتلف)</li>
              </ul>
            </div>
          </Card>
        )}

        {/* Step 2: Return Form */}
        {step === 'form' && order && (
          <div>
            <Button
              variant="outline"
              onClick={handleReset}
              className="mb-4"
            >
              ← العودة للبحث
            </Button>
            <ReturnForm
              order={order}
              merchantId={MERCHANT_CONFIG.merchantId}
              merchantInfo={{
                name: MERCHANT_CONFIG.name,
                phone: MERCHANT_CONFIG.phone,
                address: MERCHANT_CONFIG.address,
                city: MERCHANT_CONFIG.city,
              }}
              onSuccess={handleReturnSuccess}
            />
          </div>
        )}

        {/* Step 3: Success Screen */}
        {step === 'success' && returnRequest && (
          <SuccessScreen
            returnRequest={returnRequest}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}
