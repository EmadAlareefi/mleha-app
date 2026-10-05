'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type Provider = 'meta' | 'tiktok' | 'snapchat';
type Configuration = { provider: Provider; clientId: string; hasClientSecret: boolean; source: 'settings' | 'environment' | 'none'; updatedAt: string | null; callbackUrl: string | null };
type Summary = { configurations: Configuration[]; encryptionReady: boolean };
const names: Record<Provider, string> = { meta: 'Meta / Instagram', tiktok: 'TikTok', snapchat: 'Snapchat' };

function ProviderCard({ configuration, encryptionReady }: { configuration: Configuration; encryptionReady: boolean }) {
  const [clientId, setClientId] = useState(configuration.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [saved, setSaved] = useState(configuration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const prefix = `EXPENSE_${configuration.provider.toUpperCase()}`;
  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/settings/ad-credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: configuration.provider, clientId, clientSecret }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر حفظ بيانات التطبيق');
      setClientSecret('');
      setSaved({ ...saved, clientId: clientId.trim(), hasClientSecret: true, source: 'settings' });
      setSuccess('تم حفظ بيانات التطبيق. يمكنك الآن ربط الحساب من المصروفات ← فواتير الإعلانات.');
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر الحفظ'); }
    finally { setSaving(false); }
  }
  return <Card>
    <CardHeader>
      <CardTitle>{names[configuration.provider]}</CardTitle>
      <CardDescription>{saved.source === 'settings' ? 'بيانات التطبيق محفوظة في الإعدادات' : saved.source === 'environment' ? 'يستخدم النظام بيانات التطبيق المهيأة على الخادم؛ الحفظ هنا يستبدلها لهذا الربط' : 'أضف بيانات تطبيق المطور لتمكين ربط الحسابات واستيراد الفواتير'}</CardDescription>
    </CardHeader>
    <CardContent>
      <form onSubmit={handleSave} className="space-y-4">
        <Field>
          <FieldLabel htmlFor={`${prefix}_CLIENT_ID`}>{configuration.provider === 'tiktok' ? 'معرف التطبيق (App ID)' : 'معرف التطبيق (Client ID)'}</FieldLabel>
          <Input id={`${prefix}_CLIENT_ID`} name={`${prefix}_CLIENT_ID`} dir="ltr" required maxLength={200} autoComplete="off" value={clientId} disabled={saving} onChange={event => setClientId(event.target.value)} />
          <FieldDescription><span dir="ltr">{prefix}_CLIENT_ID</span></FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}_CLIENT_SECRET`}>سر التطبيق (Client Secret)</FieldLabel>
          <Input id={`${prefix}_CLIENT_SECRET`} name={`${prefix}_CLIENT_SECRET`} type="password" dir="ltr" autoComplete="new-password" maxLength={8000} required={!saved.hasClientSecret || clientId.trim() !== saved.clientId} placeholder={saved.hasClientSecret ? 'محفوظ — اتركه فارغاً للاحتفاظ به' : 'أدخل سر التطبيق'} value={clientSecret} disabled={saving} onChange={event => setClientSecret(event.target.value)} />
          <FieldDescription><span dir="ltr">{prefix}_CLIENT_SECRET</span> — {saved.hasClientSecret ? 'السر محفوظ ولا يُعرض بعد الحفظ.' : 'يُحفظ مشفراً ويُستخدم على الخادم فقط.'}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${prefix}_CALLBACK`}>رابط العودة للتفويض (Callback URL)</FieldLabel>
          <Input id={`${prefix}_CALLBACK`} readOnly dir="ltr" value={configuration.callbackUrl || ''} placeholder="يلزم إعداد عنوان التطبيق على الخادم" onFocus={event => event.target.select()} />
          <FieldDescription>أضف هذا الرابط إلى إعدادات تطبيق المطور لدى المنصة.</FieldDescription>
        </Field>
        {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
        {success && <Alert><AlertDescription role="status">{success}</AlertDescription></Alert>}
        <Button type="submit" disabled={saving || !encryptionReady}>{saving ? 'جارٍ الحفظ…' : `حفظ بيانات ${names[configuration.provider]}`}</Button>
      </form>
    </CardContent>
  </Card>;
}

export default function AdCredentialsSettings() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/settings/ad-credentials', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تحميل إعدادات الإعلانات');
      setSummary(data);
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تحميل الإعدادات'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="mx-auto mt-8 w-full max-w-4xl space-y-4" aria-labelledby="ad-credentials-title" dir="rtl">
    <div><h2 id="ad-credentials-title" className="text-xl font-semibold">بيانات ربط فواتير الإعلانات</h2><p className="mt-2 text-sm text-muted-foreground">أضف بيانات تطبيقات Meta وTikTok وSnapchat. يمكن للموظفين الممنوحين صلاحية الإعدادات إدخال البيانات وتحديثها.</p></div>
    {loading && <p role="status">جارٍ تحميل بيانات الربط…</p>}
    {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription><Button type="button" variant="outline" onClick={() => void load()}>إعادة المحاولة</Button></Alert>}
    {summary && !summary.encryptionReady && <Alert variant="destructive"><AlertDescription>تشفير بيانات الاعتماد غير مهيأ؛ يجب على مسؤول النظام إعداد مفتاح الخادم قبل الحفظ.</AlertDescription></Alert>}
    {summary?.configurations.map(configuration => <ProviderCard key={configuration.provider} configuration={configuration} encryptionReady={summary.encryptionReady} />)}
  </section>;
}
