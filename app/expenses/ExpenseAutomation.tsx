'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Subscription = { id: string; title: string; amount: string; currency: string; category: string; frequency: string; startDate: string; endDate: string | null; nextDate: string; notes: string | null; state: string; occurrences: { id: string; dueDate: string; expense: { amount: string; currency: string } | null }[] };
type Connection = { id: string; provider: string; billingOwnerId: string; label: string; state: string; importFrom: string; lastSuccessAt: string | null; lastError: string | null; hasMore: boolean; runs: { id: string; state: string; imported: number; reviewed: number; startedAt: string; error: string | null }[] };
type Invoice = { id: string; providerId: string; number: string; issueDate: string; amount: string; currency: string; state: string; reviewReason: string | null; documentError: string | null; hasDocument: boolean; expenseId: string | null; latestMetadata: Record<string, unknown> | null };
const categories = { shipping: 'شحن', packaging: 'تغليف', marketing: 'تسويق', operations: 'عمليات', 'partner-current': 'جاري الشريك', salaries: 'رواتب', utilities: 'مرافق', rent: 'إيجار', maintenance: 'صيانة', other: 'أخرى' };
const states: Record<string, string> = { active: 'نشط', paused: 'متوقف', archived: 'مؤرشف', completed: 'مكتمل', setup: 'يلزم الربط', reconnect: 'يلزم إعادة الربط', error: 'خطأ في المزامنة', manual: 'رفع يدوي', disconnected: 'غير متصل', imported: 'تم الاستيراد', review: 'يتطلب مراجعة', failed: 'فشل', partial: 'توجد صفحات متبقية', running: 'قيد التنفيذ' };
function localToday() { return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); }
async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: 'no-store', ...(body instanceof FormData ? { body } : body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'تعذرت العملية');
  return data;
}
const blankSubscription = () => ({ title: '', amount: '', currency: 'SAR', category: 'other', frequency: 'monthly', startDate: localToday(), endDate: '', notes: '' });
export default function ExpenseAutomation({ tab, isAdmin, onChange }: { tab: 'subscriptions' | 'ads'; isAdmin: boolean; onChange: () => void }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState('');
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState('');
  const [form, setForm] = useState(blankSubscription);
  const [adForm, setAdForm] = useState({ provider: 'meta', label: '', billingOwnerId: '' });
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const load = useCallback(async () => {
    if (tab === 'subscriptions') setSubscriptions(await api<Subscription[]>('/api/expenses/subscriptions'));
    else setConnections(await api<Connection[]>('/api/expenses/ad-connections'));
  }, [tab]);
  useEffect(() => { setLoading(true); void load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, [load]);
  const loadInvoices = useCallback(async () => {
    if (selected) setInvoices(await api<Invoice[]>(`/api/expenses/ad-connections/${selected}/invoices?offset=${offset}`));
  }, [selected, offset]);
  useEffect(() => { setInvoices([]); void loadInvoices().catch(e => setError(e.message)); }, [loadInvoices]);
  async function run(work: () => Promise<unknown>, success = 'تم الحفظ بنجاح') {
    setBusy(true); setError(''); setMessage('');
    try { await work(); await load(); await loadInvoices(); onChange(); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذرت العملية'); }
    finally { setBusy(false); }
  }
  function saveSubscription(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api(`/api/expenses/subscriptions${editing ? `/${editing}` : ''}`, editing ? 'PATCH' : 'POST', form);
      setEditing(''); setForm(blankSubscription());
    });
  }
  const connection = connections.find(c => c.id === selected);
  return <div className="space-y-4" dir="rtl">
    {error && <p role="alert" className="rounded border border-red-300 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded border p-3">{message}</p>}
    {loading && <p role="status">جارٍ التحميل…</p>}
    {tab === 'subscriptions' ? <>
      <p className="text-sm text-muted-foreground">تُنشأ المصروفات معتمدة تلقائياً في تاريخ الاستحقاق بتوقيت الرياض. يتم تخطي الفترات المتوقفة عند الاستئناف.</p>
      {isAdmin && <Card><CardHeader><CardTitle>{editing ? 'تعديل الاشتراك' : 'اشتراك جديد'}</CardTitle></CardHeader><CardContent>
        <form onSubmit={saveSubscription} className="grid gap-3 md:grid-cols-3">
          <label>العنوان<Input required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>المبلغ<Input required type="number" min="0.01" max="99999999.99" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
          <label>العملة<Input required maxLength={3} pattern="[A-Za-z]{3}" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></label>
          <label>الفئة<NativeSelect value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{Object.entries(categories).map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect></label>
          <label>التكرار<NativeSelect disabled={!!editing} value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}><NativeSelectOption value="monthly">شهري</NativeSelectOption><NativeSelectOption value="yearly">سنوي</NativeSelectOption></NativeSelect></label>
          <label>أول استحقاق<Input required disabled={!!editing} type="date" min={editing ? undefined : localToday()} value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></label>
          <label>تاريخ النهاية (اختياري)<Input type="date" min={form.startDate} value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></label>
          <label>ملاحظات<Input maxLength={4000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="flex flex-wrap items-end gap-2"><Button disabled={busy}>حفظ</Button>{editing && <Button type="button" variant="outline" onClick={() => { setEditing(''); setForm(blankSubscription()); }}>إلغاء</Button>}<Button disabled={busy} type="button" variant="outline" onClick={() => void run(() => api('/api/expenses/subscriptions', 'POST', { action: 'process' }), 'تمت معالجة الاستحقاقات الحالية')}>تشغيل الاستحقاقات</Button></div>
        </form>
      </CardContent></Card>}
      {!loading && !subscriptions.length && <p>لا توجد اشتراكات حتى الآن.</p>}
      {subscriptions.map(s => <Card key={s.id}><CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap justify-between gap-2"><strong>{s.title}</strong><span>{s.amount} {s.currency} · {s.frequency === 'monthly' ? 'شهري' : 'سنوي'} · {states[s.state]}</span></div>
        <p>الاستحقاق التالي: {s.state === 'active' ? s.nextDate : '—'}{s.endDate && ` · النهاية: ${s.endDate}`}</p>
        {isAdmin && !['archived', 'completed'].includes(s.state) && <div className="flex flex-wrap gap-2">
          <Button disabled={busy} variant="outline" onClick={() => { setEditing(s.id); setForm({ title: s.title, amount: s.amount, currency: s.currency, category: s.category, frequency: s.frequency, startDate: s.startDate, endDate: s.endDate || '', notes: s.notes || '' }); }}>تعديل</Button>
          <Button disabled={busy} variant="outline" onClick={() => void run(() => api(`/api/expenses/subscriptions/${s.id}`, 'PATCH', { action: s.state === 'paused' ? 'resume' : 'pause' }))}>{s.state === 'paused' ? 'استئناف' : 'إيقاف مؤقت'}</Button>
          <Button disabled={busy} variant="outline" onClick={() => void run(() => api(`/api/expenses/subscriptions/${s.id}`, 'PATCH', { action: 'archive' }))}>أرشفة</Button>
        </div>}
        <details><summary className="cursor-pointer">آخر 12 استحقاقاً</summary>{s.occurrences.length ? s.occurrences.map(o => <p key={o.id}>{o.dueDate} — {o.expense ? `${o.expense.amount} ${o.expense.currency}` : 'تم حذف المصروف؛ لن يُنشأ مجدداً'}</p>) : <p>لم يتم إنشاء مصروفات بعد.</p>}</details>
      </CardContent></Card>)}
    </> : <>
      <p className="text-sm text-muted-foreground">استيراد الفواتير الرسمية من تاريخ الربط وإنشاء مصروفات تسويقية معتمدة. لا يتم استيراد الإنفاق التقديري. الربط يتطلب تطبيق مطور وصلاحيات فوترة لدى المنصة.</p>
      {isAdmin && <Card><CardHeader><CardTitle>إضافة حساب فوترة</CardTitle></CardHeader><CardContent><form className="grid gap-3 md:grid-cols-4" onSubmit={e => { e.preventDefault(); void run(async () => { const result = await api<{ id: string }>('/api/expenses/ad-connections', 'POST', adForm); setSelected(result.id); setOffset(0); setAdForm({ ...adForm, label: '', billingOwnerId: '' }); }); }}>
        <label>المنصة<NativeSelect value={adForm.provider} onChange={e => setAdForm({ ...adForm, provider: e.target.value })}><NativeSelectOption value="meta">Meta / Instagram</NativeSelectOption><NativeSelectOption value="tiktok">TikTok</NativeSelectOption><NativeSelectOption value="snapchat">Snapchat</NativeSelectOption></NativeSelect></label>
        <label>اسم الحساب<Input required value={adForm.label} onChange={e => setAdForm({ ...adForm, label: e.target.value })} /></label>
        <label>{adForm.provider === 'meta' ? 'Business ID' : adForm.provider === 'tiktok' ? 'Business Center ID' : 'Ad Account ID'}<Input required dir="ltr" value={adForm.billingOwnerId} onChange={e => setAdForm({ ...adForm, billingOwnerId: e.target.value })} /></label>
        <Button disabled={busy} className="self-end">إضافة</Button>
      </form></CardContent></Card>}
      {!loading && !connections.length && <p>لا توجد حسابات إعلانية مرتبطة.</p>}
      <div className="flex flex-wrap gap-2">{connections.map(c => <Button key={c.id} variant={selected === c.id ? 'default' : 'outline'} onClick={() => { setSelected(c.id); setOffset(0); setToken(''); setRefreshToken(''); }}>{c.label} · {states[c.state]}</Button>)}</div>
      {connection && <Card><CardHeader><CardTitle>{connection.label} — {connection.provider}</CardTitle></CardHeader><CardContent className="space-y-4">
        <p>الحالة: {states[connection.state]} · بداية الاستيراد: {connection.importFrom} · آخر مزامنة مكتملة: {connection.lastSuccessAt ? new Date(connection.lastSuccessAt).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }) : 'لم تتم بعد'}</p>
        {connection.lastError && <p role="alert" className="text-red-700">{connection.lastError}</p>}
        {isAdmin && <>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(async () => { const data = await api<{ url: string }>(`/api/expenses/ad-connections/${selected}/authorize`, 'POST'); window.location.assign(data.url); }, 'جارٍ فتح صفحة التفويض')}>ربط / إعادة الربط</Button>
            <Button disabled={busy || !['active', 'error'].includes(connection.state)} variant="outline" onClick={() => void run(() => api(`/api/expenses/ad-connections/${selected}/sync`, 'POST'), 'تمت المزامنة؛ راجع الفواتير وسجل التشغيل')}>{connection.hasMore ? 'متابعة الاستيراد' : 'مزامنة الآن'}</Button>
            <Button disabled={busy} variant="outline" onClick={() => void run(() => api(`/api/expenses/ad-connections/${selected}`, 'PATCH', { action: 'manual' }))}>استخدام الرفع اليدوي</Button>
            <Button disabled={busy} variant="outline" onClick={() => void run(() => api(`/api/expenses/ad-connections/${selected}`, 'PATCH', { action: 'disconnect' }))}>فصل الحساب</Button>
          </div>
          <details><summary className="cursor-pointer">إعداد متقدم: رمز وصول صادر من المنصة</summary><form className="mt-3 flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); void run(async () => { await api(`/api/expenses/ad-connections/${selected}`, 'PATCH', { action: 'token', accessToken: token, refreshToken }); setToken(''); setRefreshToken(''); }); }}>
            <label>رمز الوصول<Input required type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
            {connection.provider === 'snapchat' && <label>رمز التجديد (اختياري)<Input type="password" autoComplete="off" value={refreshToken} onChange={e => setRefreshToken(e.target.value)} /></label>}
            <Button disabled={busy} className="self-end">اختبار الصلاحية وحفظ</Button>
          </form></details>
          <details><summary className="cursor-pointer">رفع فاتورة رسمية يدوياً</summary><form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={e => { e.preventDefault(); const target = e.currentTarget; const data = new FormData(target); void run(async () => { await api(`/api/expenses/ad-connections/${selected}/invoices`, 'POST', data); target.reset(); }); }}>
            <label>معرف الفاتورة لدى المنصة<Input name="providerId" required /></label><label>رقم الفاتورة<Input name="number" required /></label>
            <label>تاريخ الإصدار<Input name="issueDate" type="date" required min={connection.importFrom} defaultValue={localToday()} /></label>
            <label>الإجمالي شامل الضريبة<Input name="amount" type="number" required min="0.01" step="0.01" /></label><label>العملة<Input name="currency" defaultValue="SAR" required pattern="[A-Za-z]{3}" /></label>
            <label>فترة الفوترة<Input name="billingPeriod" /></label><label>PDF<Input name="file" type="file" accept="application/pdf" required /></label><Button disabled={busy} className="self-end">رفع وإنشاء المصروف</Button>
          </form></details>
        </>}
        <div className="space-y-3">{invoices.map(invoice => <div key={invoice.id} className="rounded border p-3">
          <p className="font-medium">{invoice.number} · {invoice.issueDate} · {invoice.amount} {invoice.currency} · {states[invoice.state]}</p>
          {!invoice.expenseId && invoice.state === 'imported' && <p>تم حذف المصروف المرتبط؛ لن يُنشأ مجدداً.</p>}
          {invoice.reviewReason && <p role="status" className="text-amber-700">{invoice.reviewReason}</p>}
          {invoice.latestMetadata && <p>بيانات المصدر الحالية: {String(invoice.latestMetadata.amount)} {String(invoice.latestMetadata.currency)} · {String(invoice.latestMetadata.issueDate)}</p>}
          {invoice.documentError && <p className="text-sm">{invoice.documentError}</p>}
          {invoice.hasDocument ? <a className="underline" href={`/api/expenses/documents/${invoice.id}`}>تنزيل PDF</a> : <span>PDF غير متاح لدى المصدر</span>}
          {isAdmin && !invoice.hasDocument && <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); data.set('existingId', invoice.id); void run(() => api(`/api/expenses/ad-connections/${selected}/invoices`, 'POST', data)); }}><Input aria-label={`PDF للفاتورة ${invoice.number}`} type="file" name="file" accept="application/pdf" required /><Button disabled={busy} variant="outline">إرفاق PDF</Button></form>}
        </div>)}{!invoices.length && <p>لا توجد فواتير في هذه الصفحة.</p>}</div>
        <div className="flex gap-2"><Button variant="outline" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 50))}>السابق</Button><Button variant="outline" disabled={invoices.length < 50 || busy} onClick={() => setOffset(offset + 50)}>التالي</Button></div>
        <details><summary className="cursor-pointer">آخر عمليات المزامنة</summary>{connection.runs.map(run => <p key={run.id}>{new Date(run.startedAt).toLocaleString('ar-SA')} · {states[run.state]} · مستورد: {run.imported} · مراجعة: {run.reviewed}{run.error && ` · ${run.error}`}</p>)}</details>
      </CardContent></Card>}
    </>}
  </div>;
}
