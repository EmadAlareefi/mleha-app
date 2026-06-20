'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';

export default function SettingsPage() {
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
    <AppPageShell title="الإعدادات" subtitle="إدارة إعدادات النظام">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        {/* Return Settings */}
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>إعدادات الإرجاع</CardTitle>
            <CardDescription>تحكم بقواعد تكرار طلبات الإرجاع.</CardDescription>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleSave}>
            <FieldGroup>
                <Field orientation="horizontal" className="justify-between rounded-lg border p-4">
                  <div>
                    <FieldLabel htmlFor="allowMultiple">السماح بطلبات إرجاع متعددة لنفس الطلب</FieldLabel>
                    <FieldDescription>
                      عند التفعيل، يمكن للعملاء إنشاء أكثر من طلب إرجاع لنفس رقم الطلب
                    </FieldDescription>
                  </div>
                  <Switch
                    id="allowMultiple"
                    checked={allowMultipleRequests}
                    onCheckedChange={setAllowMultipleRequests}
                    disabled={loading || saving}
                  />
                </Field>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
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
            </FieldGroup>
          </form>

          {/* Info Box */}
          <div className="mt-8 pt-6 border-t">
            <h3 className="font-semibold mb-2">معلومات إضافية:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>رسوم المعالجة ثابتة: 60 ر.س للإرجاع و40 ر.س للاستبدال، وتظهر للعميل قبل تأكيد الطلب</li>
              <li>تكلفة الشحن الأصلية غير قابلة للاسترداد بشكل افتراضي</li>
              <li>سيتم عرض جميع التفاصيل المالية للعميل قبل تأكيد طلب الإرجاع</li>
              <li>عند تعطيل الطلبات المتعددة، سيُسمح بطلب واحد فقط لكل رقم طلب</li>
              <li>يمكن تعديل هذه الإعدادات في أي وقت</li>
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
