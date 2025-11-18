'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function CancelShipmentPage() {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await fetch('/api/shipments/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trackingNumber: trackingNumber.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل إلغاء الشحنة');
      }

      setSuccess(data.message || 'تم إلغاء الشحنة بنجاح');
      setTrackingNumber('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setTrackingNumber('');
    setError('');
    setSuccess('');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">إلغاء شحنة إرجاع</h1>
          <p className="text-gray-600">
            أدخل رقم تتبع الشحنة (AWB) لإلغاء شحنة الإرجاع
          </p>
        </div>

        <Card className="p-8">
          <form onSubmit={handleCancel} className="space-y-6">
            <div>
              <label htmlFor="trackingNumber" className="block text-sm font-medium mb-2">
                رقم تتبع الشحنة (AWB)
              </label>
              <input
                id="trackingNumber"
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="مثال: 233011127922"
                className="w-full px-4 py-3 border rounded-lg text-lg font-mono"
                required
                disabled={loading}
              />
              <p className="text-sm text-gray-500 mt-2">
                يمكنك العثور على رقم التتبع في تفاصيل طلب الإرجاع
              </p>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="font-semibold">تم الإلغاء بنجاح</span>
                </div>
                <p>{success}</p>
              </div>
            )}

            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={loading || !trackingNumber.trim()}
                className="flex-1 py-6 text-lg bg-red-600 hover:bg-red-700"
              >
                {loading ? 'جاري الإلغاء...' : 'إلغاء الشحنة'}
              </Button>

              {(success || error) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  className="py-6"
                >
                  إعادة تعيين
                </Button>
              )}
            </div>
          </form>

          {/* Info Box */}
          <div className="mt-8 pt-6 border-t">
            <h3 className="font-semibold mb-2 text-red-600">تنبيه هام:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
              <li>إلغاء الشحنة نهائي ولا يمكن التراجع عنه</li>
              <li>يمكن إلغاء الشحنات التي لم يتم استلامها بعد فقط</li>
              <li>بعد إلغاء الشحنة، قد تحتاج إلى إنشاء طلب إرجاع جديد</li>
              <li>في حالة وجود مشاكل، يرجى التواصل مع الدعم الفني</li>
            </ul>
          </div>
        </Card>

        {/* Back to Home */}
        <div className="text-center mt-6">
          <a href="/" className="text-blue-600 hover:underline">
            ← العودة للصفحة الرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}
