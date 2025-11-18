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

type Step = 'lookup' | 'existing' | 'form' | 'success';

export default function ReturnsPage() {
  const [step, setStep] = useState<Step>('lookup');
  const [orderNumber, setOrderNumber] = useState('');
  const [order, setOrder] = useState<any>(null);
  const [returnRequest, setReturnRequest] = useState<any>(null);
  const [existingReturns, setExistingReturns] = useState<any[]>([]);
  const [canCreateNew, setCanCreateNew] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLookupOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // First, lookup the order
      const orderResponse = await fetch(
        `/api/orders/lookup?merchantId=${MERCHANT_CONFIG.merchantId}&orderNumber=${encodeURIComponent(orderNumber)}`
      );

      const orderData = await orderResponse.json();

      if (!orderResponse.ok) {
        throw new Error(orderData.error || 'فشل في العثور على الطلب');
      }

      setOrder(orderData.order);

      // Check if there are existing return requests for this order
      const returnsResponse = await fetch(
        `/api/returns/check?merchantId=${MERCHANT_CONFIG.merchantId}&orderId=${orderData.order.id}`
      );

      const returnsData = await returnsResponse.json();

      // Store whether new requests can be created
      setCanCreateNew(returnsData.canCreateNew !== false);

      if (returnsData.hasExistingReturns && returnsData.returns.length > 0) {
        setExistingReturns(returnsData.returns);
        setStep('existing');
      } else {
        setStep('form');
      }
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
    setExistingReturns([]);
    setCanCreateNew(true);
    setError('');
  };

  const handleCancelReturn = async (returnId: string) => {
    if (!confirm('هل أنت متأكد من إلغاء طلب الإرجاع؟')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/returns/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          returnRequestId: returnId,
          merchantId: MERCHANT_CONFIG.merchantId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل إلغاء طلب الإرجاع');
      }

      // Remove the cancelled return from the list
      setExistingReturns(prev => prev.filter(ret => ret.id !== returnId));

      // If no more returns, go to form
      if (existingReturns.length === 1) {
        setStep('form');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewReturn = () => {
    setStep('form');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
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
                  placeholder="مثال: 251263484"
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

        {/* Step 2: Existing Returns */}
        {step === 'existing' && existingReturns.length > 0 && (
          <div>
            <Button
              variant="outline"
              onClick={handleReset}
              className="mb-4"
            >
              ← العودة للبحث
            </Button>

            <Card className="p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4">طلبات إرجاع موجودة</h2>
              <p className="text-gray-600 mb-6">
                يوجد بالفعل طلب إرجاع أو استبدال لهذا الطلب
              </p>

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-4">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {existingReturns.map((returnReq) => (
                  <Card key={returnReq.id} className="p-6 border-2">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold">
                            {returnReq.type === 'return' ? 'طلب إرجاع' : 'طلب استبدال'}
                          </h3>
                          <span
                            className={`px-3 py-1 rounded-full text-sm font-medium ${
                              returnReq.status === 'pending_review'
                                ? 'bg-yellow-100 text-yellow-800'
                                : returnReq.status === 'approved'
                                ? 'bg-green-100 text-green-800'
                                : returnReq.status === 'completed'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {returnReq.status === 'pending_review'
                              ? 'قيد المراجعة'
                              : returnReq.status === 'approved'
                              ? 'تمت الموافقة'
                              : returnReq.status === 'completed'
                              ? 'مكتمل'
                              : returnReq.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                          التاريخ: {new Date(returnReq.createdAt).toLocaleDateString('ar-SA')}
                        </p>
                        {returnReq.smsaTrackingNumber && (
                          <div className="mb-2">
                            <p className="text-sm font-medium text-gray-700">رقم الشحنة:</p>
                            <p className="text-lg font-mono font-bold text-blue-600">
                              {returnReq.smsaTrackingNumber}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="border-t pt-4 mt-4">
                      <h4 className="font-medium mb-2">المنتجات:</h4>
                      <div className="space-y-2">
                        {returnReq.items.map((item: any) => (
                          <div key={item.id} className="flex justify-between text-sm">
                            <span>{item.productName}</span>
                            <span className="text-gray-600">الكمية: {item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {returnReq.totalRefundAmount && (
                      <div className="border-t pt-4 mt-4">
                        <div className="flex justify-between">
                          <span className="font-medium">المبلغ المتوقع للإرجاع:</span>
                          <span className="font-bold text-lg">
                            {Number(returnReq.totalRefundAmount).toFixed(2)} ر.س
                          </span>
                        </div>
                      </div>
                    )}

                    {['pending_review', 'approved'].includes(returnReq.status) && (
                      <div className="border-t pt-4 mt-4">
                        <Button
                          variant="outline"
                          onClick={() => handleCancelReturn(returnReq.id)}
                          disabled={loading}
                          className="w-full text-red-600 border-red-300 hover:bg-red-50"
                        >
                          {loading ? 'جاري الإلغاء...' : 'إلغاء طلب الإرجاع'}
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>

              {canCreateNew && (
                <div className="mt-6 pt-6 border-t">
                  <Button
                    onClick={handleCreateNewReturn}
                    className="w-full"
                    variant="outline"
                  >
                    إنشاء طلب إرجاع جديد
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Step 3: Return Form */}
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

        {/* Step 4: Success Screen */}
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
