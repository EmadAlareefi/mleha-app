'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

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
    <AppPageShell title="إلغاء شحنة إرجاع" subtitle="أدخل رقم تتبع الشحنة لإلغاء شحنة الإرجاع">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>بيانات الشحنة</CardTitle>
            <CardDescription>يمكن إلغاء الشحنات التي لم يتم استلامها بعد فقط.</CardDescription>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleCancel}>
            <FieldGroup>
            <Field>
              <FieldLabel htmlFor="trackingNumber">رقم تتبع الشحنة (AWB)</FieldLabel>
              <Input
                id="trackingNumber"
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="مثال: 233011127922"
                className="font-mono"
                required
                disabled={loading}
              />
              <FieldDescription>
                يمكنك العثور على رقم التتبع في تفاصيل طلب الإرجاع
              </FieldDescription>
            </Field>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <AlertTitle>تم الإلغاء بنجاح</AlertTitle>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={loading || !trackingNumber.trim()}
                variant="destructive"
                className="flex-1"
              >
                {loading ? 'جاري الإلغاء...' : 'إلغاء الشحنة'}
              </Button>

              {(success || error) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                >
                  إعادة تعيين
                </Button>
              )}
            </div>
            </FieldGroup>
          </form>

          {/* Info Box */}
          <div className="mt-8 pt-6 border-t">
            <h3 className="font-semibold mb-2 text-red-600">تنبيه هام:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>إلغاء الشحنة نهائي ولا يمكن التراجع عنه</li>
              <li>يمكن إلغاء الشحنات التي لم يتم استلامها بعد فقط</li>
              <li>بعد إلغاء الشحنة، قد تحتاج إلى إنشاء طلب إرجاع جديد</li>
              <li>في حالة وجود مشاكل، يرجى التواصل مع الدعم الفني</li>
            </ul>
          </div>
          </CardContent>
        </Card>

        {/* Back to Home */}
        <div className="text-center mt-6">
          <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
            ← العودة للصفحة الرئيسية
          </Link>
        </div>
      </div>
    </AppPageShell>
  );
}
