'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  const [returnFee, setReturnFee] = useState('');
  const [allowMultipleRequests, setAllowMultipleRequests] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    setError('');

    try {
      // Load return fee
      const feeResponse = await fetch('/api/settings?key=return_fee');
      const feeData = await feeResponse.json();

      if (feeResponse.ok && feeData.setting) {
        setReturnFee(feeData.setting.value);
      }

      // Load allow multiple requests setting
      const multipleResponse = await fetch('/api/settings?key=allow_multiple_return_requests');
      const multipleData = await multipleResponse.json();

      if (multipleResponse.ok && multipleData.setting) {
        setAllowMultipleRequests(multipleData.setting.value === 'true');
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const feeValue = parseFloat(returnFee);

      if (isNaN(feeValue) || feeValue < 0) {
        throw new Error('الرجاء إدخال رسوم صحيحة');
      }

      // Save return fee
      const feeResponse = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: 'return_fee',
          value: feeValue.toString(),
          description: 'رسوم معالجة طلب الإرجاع',
        }),
      });

      const feeData = await feeResponse.json();

      if (!feeResponse.ok) {
        throw new Error(feeData.error || 'فشل حفظ رسوم الإرجاع');
      }

      // Save allow multiple requests setting
      const multipleResponse = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: 'allow_multiple_return_requests',
          value: allowMultipleRequests.toString(),
          description: 'السماح بإنشاء عدة طلبات إرجاع لنفس الطلب',
        }),
      });

      const multipleData = await multipleResponse.json();

      if (!multipleResponse.ok) {
        throw new Error(multipleData.error || 'فشل حفظ إعدادات الطلبات المتعددة');
      }

      setSuccess('تم حفظ الإعدادات بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">الإعدادات</h1>
          <p className="text-gray-600">
            إدارة إعدادات النظام والرسوم
          </p>
        </div>

        {/* Return Fee Settings */}
        <Card className="p-8">
          <form onSubmit={handleSave} className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold mb-4">إعدادات الإرجاع</h2>

              <div className="space-y-4">
                <div>
                  <label htmlFor="returnFee" className="block text-sm font-medium mb-2">
                    رسوم معالجة الإرجاع (ريال سعودي)
                  </label>
                  <input
                    id="returnFee"
                    type="number"
                    step="0.01"
                    min="0"
                    value={returnFee}
                    onChange={(e) => setReturnFee(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 border rounded-lg text-lg"
                    required
                    disabled={loading || saving}
                  />
                  <p className="text-sm text-gray-500 mt-2">
                    سيتم خصم هذه الرسوم من إجمالي المبلغ المسترد للعميل عند إنشاء طلب إرجاع
                  </p>
                </div>

                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <label htmlFor="allowMultiple" className="block text-sm font-medium mb-1">
                        السماح بطلبات إرجاع متعددة لنفس الطلب
                      </label>
                      <p className="text-sm text-gray-500">
                        عند التفعيل، يمكن للعملاء إنشاء أكثر من طلب إرجاع لنفس رقم الطلب
                      </p>
                    </div>
                    <div className="mr-4">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          id="allowMultiple"
                          type="checkbox"
                          checked={allowMultipleRequests}
                          onChange={(e) => setAllowMultipleRequests(e.target.checked)}
                          disabled={loading || saving}
                          className="sr-only peer"
                        />
                        <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:right-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>{success}</span>
                </div>
              </div>
            )}

            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={loading || saving}
                className="flex-1 py-6 text-lg"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={loadSettings}
                disabled={loading || saving}
                className="py-6"
              >
                إعادة تحميل
              </Button>
            </div>
          </form>

          {/* Info Box */}
          <div className="mt-8 pt-6 border-t">
            <h3 className="font-semibold mb-2">معلومات إضافية:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
              <li>رسوم الإرجاع سيتم خصمها تلقائياً من إجمالي المبلغ المسترد (للإرجاع فقط، وليس الاستبدال)</li>
              <li>تكلفة الشحن الأصلية غير قابلة للاسترداد بشكل افتراضي</li>
              <li>سيتم عرض جميع التفاصيل المالية للعميل قبل تأكيد طلب الإرجاع</li>
              <li>عند تعطيل الطلبات المتعددة، سيُسمح بطلب واحد فقط لكل رقم طلب</li>
              <li>يمكن تعديل هذه الإعدادات في أي وقت</li>
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
