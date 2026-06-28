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
  const [zokoWebhookProcessingEnabled, setZokoWebhookProcessingEnabled] = useState(true);
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
      const [multipleResponse, zokoResponse] = await Promise.all([
        fetch('/api/settings?key=allow_multiple_return_requests'),
        fetch('/api/settings?key=zoko_webhook_processing_enabled'),
      ]);

      if (multipleResponse.ok) {
        const multipleData = await multipleResponse.json();
        if (multipleData.setting) {
          setAllowMultipleRequests(multipleData.setting.value === 'true');
        }
      }

      if (zokoResponse.ok) {
        const zokoData = await zokoResponse.json();
        if (zokoData.setting) {
          setZokoWebhookProcessingEnabled(zokoData.setting.value !== 'false');
        }
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
      const requests = [
        {
          key: 'allow_multiple_return_requests',
          value: allowMultipleRequests.toString(),
          description: 'السماح بإنشاء عدة طلبات إرجاع لنفس الطلب',
          errorMessage: 'فشل حفظ إعدادات الطلبات المتعددة',
        },
        {
          key: 'zoko_webhook_processing_enabled',
          value: zokoWebhookProcessingEnabled.toString(),
          description: 'معالجة رسائل وأحداث Zoko الواردة من الويب هوك',
          errorMessage: 'فشل حفظ إعدادات Zoko',
        },
      ];

      for (const setting of requests) {
        const response = await fetch('/api/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: setting.key,
            value: setting.value,
            description: setting.description,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || setting.errorMessage);
        }
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
      <form onSubmit={handleSave} className="mx-auto w-full max-w-4xl space-y-6">
        {/* Return Settings */}
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>إعدادات الإرجاع</CardTitle>
            <CardDescription>تحكم بقواعد تكرار طلبات الإرجاع.</CardDescription>
          </CardHeader>
          <CardContent>
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
            </FieldGroup>

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

        {/* Zoko Settings */}
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>إعدادات Zoko</CardTitle>
            <CardDescription>تحكم بمعالجة رسائل وأحداث Zoko الواردة.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal" className="justify-between rounded-lg border p-4">
                <div>
                  <FieldLabel htmlFor="zokoWebhookProcessing">معالجة رسائل Zoko من الويب هوك</FieldLabel>
                  <FieldDescription>
                    عند التعطيل، سيستقبل النظام طلبات Zoko بنجاح لكنه لن يحفظ الرسائل أو أحداث المحادثات الجديدة
                  </FieldDescription>
                </div>
                <Switch
                  id="zokoWebhookProcessing"
                  checked={zokoWebhookProcessingEnabled}
                  onCheckedChange={setZokoWebhookProcessingEnabled}
                  disabled={loading || saving}
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

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

        {/* Back to Home */}
        <div className="text-center mt-6">
          <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
            ← العودة للصفحة الرئيسية
          </Link>
        </div>
      </form>
    </AppPageShell>
  );
}
