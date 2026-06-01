'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  buildCarrierFeeConfig,
  parseCarrierFeeConfig,
  RETURN_CARRIER_FEES_SETTING_KEY,
  returnFeeCarriers,
  type CarrierFeeConfig,
} from '@/lib/returns/carrier-fees';

export default function SettingsPage() {
  const [carrierFees, setCarrierFees] = useState<CarrierFeeConfig>(() =>
    buildCarrierFeeConfig({}, 0, 0),
  );
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
      // Load legacy fees as fallbacks for carriers that do not have values yet.
      const feeResponse = await fetch('/api/settings?key=return_fee');
      const feeData = await feeResponse.json();
      const fallbackReturnFee =
        feeResponse.ok && feeData.setting ? Number(feeData.setting.value) || 0 : 0;

      const exchangeFeeResponse = await fetch('/api/settings?key=exchange_fee');
      const exchangeFeeData = await exchangeFeeResponse.json();
      const fallbackExchangeFee =
        exchangeFeeResponse.ok && exchangeFeeData.setting
          ? Number(exchangeFeeData.setting.value) || 0
          : 0;

      const carrierFeesResponse = await fetch(`/api/settings?key=${RETURN_CARRIER_FEES_SETTING_KEY}`);
      const carrierFeesData = await carrierFeesResponse.json();
      const loadedCarrierFees =
        carrierFeesResponse.ok && carrierFeesData.setting
          ? parseCarrierFeeConfig(carrierFeesData.setting.value)
          : {};
      setCarrierFees(
        buildCarrierFeeConfig(loadedCarrierFees, fallbackReturnFee, fallbackExchangeFee),
      );

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
      const normalizedCarrierFees = buildCarrierFeeConfig({ ...carrierFees }, 0, 0);

      for (const company of returnFeeCarriers) {
        const fees = normalizedCarrierFees[company.id];
        if (fees.returnFee < 0 || fees.exchangeFee < 0) {
          throw new Error(`الرجاء إدخال رسوم صحيحة لشركة ${company.nameAr}`);
        }
      }

      const carrierFeesResponse = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: RETURN_CARRIER_FEES_SETTING_KEY,
          value: JSON.stringify(normalizedCarrierFees),
          description: 'رسوم الإرجاع والاستبدال حسب شركة الشحن',
        }),
      });

      const carrierFeesData = await carrierFeesResponse.json();

      if (!carrierFeesResponse.ok) {
        throw new Error(carrierFeesData.error || 'فشل حفظ رسوم شركات الشحن');
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
      setCarrierFees(normalizedCarrierFees);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const updateCarrierFee = (
    carrierId: string,
    feeType: keyof CarrierFeeConfig[string],
    value: string,
  ) => {
    const parsed = Number(value);
    setCarrierFees((current) => ({
      ...current,
      [carrierId]: {
        returnFee: current[carrierId]?.returnFee ?? 0,
        exchangeFee: current[carrierId]?.exchangeFee ?? 0,
        [feeType]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
      },
    }));
  };

  return (
    <AppPageShell title="الإعدادات" subtitle="إدارة إعدادات النظام والرسوم">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        {/* Return Fee Settings */}
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>إعدادات الإرجاع</CardTitle>
            <CardDescription>تحكم برسوم المعالجة وقواعد تكرار طلبات الإرجاع.</CardDescription>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleSave}>
            <FieldGroup>
                <Field>
                  <FieldLabel>رسوم الإرجاع والاستبدال حسب شركة الشحن</FieldLabel>
                  <FieldDescription>
                    سيتم تطبيق الرسوم بناءً على شركة الشحن المرتبطة بالطلب في صفحة الإرجاع
                  </FieldDescription>
                  <div className="overflow-hidden rounded-lg border">
                    <div className="hidden grid-cols-[1.2fr_1fr_1fr] gap-3 bg-muted px-4 py-3 text-sm font-medium sm:grid">
                      <span>شركة الشحن</span>
                      <span>رسوم الإرجاع</span>
                      <span>رسوم الاستبدال</span>
                    </div>
                    {returnFeeCarriers.map((company) => (
                      <div
                        key={company.id}
                        className="grid grid-cols-1 gap-3 border-t px-4 py-3 sm:grid-cols-[1.2fr_1fr_1fr]"
                      >
                        <div className="flex min-w-0 flex-col justify-center">
                          <span className="font-medium">{company.nameAr}</span>
                          <span className="text-xs text-muted-foreground">{company.nameEn}</span>
                        </div>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground sm:hidden">
                            رسوم الإرجاع
                          </span>
                          <Input
                            aria-label={`رسوم الإرجاع - ${company.nameAr}`}
                            type="number"
                            step="0.01"
                            min="0"
                            value={carrierFees[company.id]?.returnFee ?? 0}
                            onChange={(e) => updateCarrierFee(company.id, 'returnFee', e.target.value)}
                            placeholder="0.00"
                            required
                            disabled={loading || saving}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground sm:hidden">
                            رسوم الاستبدال
                          </span>
                          <Input
                            aria-label={`رسوم الاستبدال - ${company.nameAr}`}
                            type="number"
                            step="0.01"
                            min="0"
                            value={carrierFees[company.id]?.exchangeFee ?? 0}
                            onChange={(e) => updateCarrierFee(company.id, 'exchangeFee', e.target.value)}
                            placeholder="0.00"
                            required
                            disabled={loading || saving}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </Field>

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
              <li>رسوم الإرجاع والاستبدال يتم ضبطها من هذه الصفحة وتظهر للعميل قبل تأكيد الطلب</li>
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
