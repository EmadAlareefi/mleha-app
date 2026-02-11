'use client';

import { useEffect, useMemo, useState } from 'react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Printer,
  RefreshCcw,
  Trash2,
} from 'lucide-react';

interface PrinterProfile {
  id: string;
  printerId: number;
  label: string;
  location?: string | null;
  paperName?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PrintNodePrinterItem {
  id: number;
  name: string;
  description?: string;
  state?: string;
  default?: {
    paper?: string;
    paperName?: string;
  };
  computer?: {
    id?: number;
    name?: string;
    hostname?: string;
    state?: string;
    description?: string;
  };
}

type PrinterFormState = {
  printerId: string;
  label: string;
  location: string;
  paperName: string;
  notes: string;
};

const initialFormState: PrinterFormState = {
  printerId: '',
  label: '',
  location: '',
  paperName: '',
  notes: '',
};

export default function PrinterSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<PrinterProfile[]>([]);
  const [printers, setPrinters] = useState<PrintNodePrinterItem[]>([]);
  const [formData, setFormData] = useState<PrinterFormState>(initialFormState);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/printers');
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'تعذر تحميل بيانات الطابعات');
      }
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setPrinters(Array.isArray(data.printers) ? data.printers : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const stats = useMemo(() => {
    const online = printers.filter((printer) => printer.state === 'online').length;
    const offline = printers.filter((printer) => printer.state && printer.state !== 'online').length;
    const configured = profiles.length;
    const configuredIds = new Set(profiles.map((profile) => profile.printerId));
    const missing = printers.filter((printer) => !configuredIds.has(printer.id)).length;

    return [
      {
        label: 'طابعات متصلة',
        value: online,
        hint: 'متاحة فوراً للطباعة',
        icon: CheckCircle2,
      },
      {
        label: 'بحاجة لمتابعة',
        value: offline,
        hint: 'غير متصلة أو متوقفة',
        icon: AlertTriangle,
      },
      {
        label: 'تم تكوينها',
        value: configured,
        hint: 'تملك اسماً وورقاً محدداً',
        icon: Printer,
      },
      {
        label: 'بدون تكوين',
        value: missing,
        hint: 'يمكن تعيينها الآن',
        icon: RefreshCcw,
      },
    ];
  }, [printers, profiles]);

  const handleFormChange = (field: keyof PrinterFormState, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.printerId.trim() || !formData.label.trim()) {
      alert('يرجى تعبئة معرف الطابعة واسمها');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'فشل حفظ بيانات الطابعة');
      }
      setProfiles((prev) => {
        const filtered = prev.filter((profile) => profile.printerId !== data.profile.printerId);
        return [...filtered, data.profile].sort((a, b) => a.label.localeCompare(b.label, 'ar') || a.printerId - b.printerId);
      });
      setFormData(initialFormState);
      alert('تم حفظ إعدادات الطابعة بنجاح');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر حفظ بيانات الطابعة');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    if (!confirm('هل أنت متأكد من حذف هذا التكوين للطابعة؟')) {
      return;
    }
    setDeletingId(profileId);
    try {
      const response = await fetch(`/api/printers/${profileId}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'تعذر حذف التكوين');
      }
      setProfiles((prev) => prev.filter((profile) => profile.id !== profileId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'تعذر حذف التكوين');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopyId = async (printerId: number) => {
    try {
      await navigator.clipboard.writeText(String(printerId));
      alert(`تم نسخ المعرف ${printerId}`);
    } catch (err) {
      alert('تعذر نسخ المعرف، يرجى المحاولة يدوياً');
    }
  };

  const configuredIds = useMemo(() => new Set(profiles.map((profile) => profile.printerId)), [profiles]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-slate-100 pb-16">
      <AppNavbar title="إعدادات الطابعات" subtitle="تعريف الطابعات الموثوقة للطباعة التلقائية" />
      <div className="max-w-6xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 grid gap-6 lg:grid-cols-[1.6fr,1fr]">
          <Card className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-900 via-indigo-700 to-slate-900 p-8 text-white shadow-xl">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em]">
                <span>مركز الطباعة</span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold">إدارة هوية الطابعات</h1>
                <p className="mt-2 text-white/80">
                  عرّف الطابعات الموثوقة، أضف مواقعها وأسماءها، ثم استخدمها لربط الطابعات لكل مستخدم من صفحة إدارة المستخدمين.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={loadData} disabled={loading} className="rounded-2xl bg-white/95 text-slate-900 hover:bg-white">
                  {loading ? 'جاري التحديث...' : 'تحديث بيانات PrintNode'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormData(initialFormState)}
                  className="rounded-2xl border-white/50 text-white hover:bg-white/10"
                >
                  مسح النموذج
                </Button>
              </div>
            </div>
          </Card>
          <Card className="rounded-3xl border border-white/60 bg-white/95 p-4 shadow-md">
            <div className="grid grid-cols-2 gap-3 text-slate-600">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <span>{stat.label}</span>
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{stat.value}</p>
                    <p className="text-xs text-slate-500">{stat.hint}</p>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <Card className="rounded-3xl border border-white/70 bg-white/95 p-6 shadow">
            <h2 className="text-lg font-semibold text-slate-900">إضافة أو تحديث طابعة</h2>
            <p className="text-sm text-slate-500">املأ البيانات التالية ليظهر الاسم الودي والورق المقترح عند ربط الطابعة بالمستخدمين.</p>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500">معرف الطابعة في PrintNode</label>
                <Input
                  type="text"
                  value={formData.printerId}
                  onChange={(e) => handleFormChange('printerId', e.target.value)}
                  placeholder="مثال: 75006700"
                  className="mt-1 rounded-2xl border-slate-200"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">اسم الطابعة</label>
                <Input
                  type="text"
                  value={formData.label}
                  onChange={(e) => handleFormChange('label', e.target.value)}
                  placeholder="طابعة تحضير أ"
                  className="mt-1 rounded-2xl border-slate-200"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500">الموقع أو الحاسوب</label>
                  <Input
                    type="text"
                    value={formData.location}
                    onChange={(e) => handleFormChange('location', e.target.value)}
                    placeholder="مكتب التحضير - جهاز خالد"
                    className="mt-1 rounded-2xl border-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">ورق الطباعة</label>
                  <Input
                    type="text"
                    value={formData.paperName}
                    onChange={(e) => handleFormChange('paperName', e.target.value)}
                    placeholder="LABEL(100mm x 150mm)"
                    className="mt-1 rounded-2xl border-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">ملاحظات</label>
                <Input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => handleFormChange('notes', e.target.value)}
                  placeholder="يجب إعادة تشغيل PrintNode يومياً"
                  className="mt-1 rounded-2xl border-slate-200"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={saving} className="rounded-2xl px-6 py-5">
                  {saving ? 'جاري الحفظ...' : 'حفظ الطابعة'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormData(initialFormState)}
                  className="rounded-2xl border-slate-200 px-6 py-5 text-slate-600 hover:text-slate-900"
                >
                  إعادة التعيين
                </Button>
              </div>
            </form>
          </Card>

          <Card className="rounded-3xl border border-white/70 bg-white/95 p-6 shadow">
            <h2 className="text-lg font-semibold text-slate-900">الطابعات المعرفة ({profiles.length})</h2>
            {profiles.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">لم يتم إضافة أي طابعة بعد.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {profiles
                  .slice()
                  .sort((a, b) => a.label.localeCompare(b.label, 'ar'))
                  .map((profile) => (
                    <div
                      key={profile.id}
                      className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-600"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-slate-900">{profile.label}</p>
                          <p className="text-xs text-slate-500">معرف: {profile.printerId}</p>
                          {profile.location && <p className="text-xs text-slate-500">الموقع: {profile.location}</p>}
                          {profile.paperName && <p className="text-xs text-slate-500">الورق: {profile.paperName}</p>}
                          {profile.notes && <p className="text-xs text-slate-500">ملاحظات: {profile.notes}</p>}
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleCopyId(profile.printerId)}
                            className="rounded-2xl border-slate-200 text-slate-600 hover:text-slate-900"
                          >
                            <Copy className="h-4 w-4" />
                            نسخ المعرف
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleDelete(profile.id)}
                            disabled={deletingId === profile.id}
                            className="rounded-2xl border-rose-200 text-rose-600 hover:bg-rose-50"
                          >
                            {deletingId === profile.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            حذف
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="mt-6 rounded-3xl border border-white/70 bg-white/95 p-6 shadow">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">طابعات PrintNode ({printers.length})</h2>
              <p className="text-sm text-slate-500">القائمة الحالية كما أبلغها PrintNode. استخدمها للتحقق من الحالة وربطها بالتكوينات أعلاه.</p>
            </div>
          </div>
          {loading ? (
            <div className="mt-6 flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل الطابعات...
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {printers.map((printer) => (
                <div key={printer.id} className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{printer.name}</p>
                      <p className="text-xs text-slate-500">معرف: {printer.id}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                        printer.state === 'online'
                          ? 'bg-emerald-100 text-emerald-700'
                          : printer.state === 'disconnected'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {printer.state || 'غير معروف'}
                    </span>
                  </div>
                  {printer.description && <p className="mt-1 text-xs text-slate-500">{printer.description}</p>}
                  {printer.computer?.name && (
                    <p className="text-xs text-slate-500">الحاسوب: {printer.computer.name || printer.computer.hostname}</p>
                  )}
                  {printer.default?.paperName && (
                    <p className="text-xs text-slate-500">الورق الافتراضي: {printer.default.paperName || printer.default.paper}</p>
                  )}
                  {configuredIds.has(printer.id) ? (
                    <p className="mt-2 text-xs text-emerald-600">تمت إضافتها في قائمة التكوين.</p>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setFormData((prev) => ({
                          printerId: String(printer.id),
                          label: prev.label || printer.name,
                          location: prev.location || printer.computer?.name || printer.computer?.hostname || '',
                          paperName: prev.paperName || printer.default?.paperName || printer.default?.paper || '',
                          notes: prev.notes,
                        }))
                      }
                      className="mt-2 rounded-2xl text-indigo-600 hover:text-indigo-800"
                    >
                      استخدام البيانات في النموذج
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
