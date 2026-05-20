'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
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
    } catch {
      alert('تعذر نسخ المعرف، يرجى المحاولة يدوياً');
    }
  };

  const configuredIds = useMemo(() => new Set(profiles.map((profile) => profile.printerId)), [profiles]);

  return (
    <AppPageShell title="إعدادات الطابعات" subtitle="تعريف الطابعات الموثوقة للطباعة التلقائية">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 grid gap-6 lg:grid-cols-[1.6fr,1fr]">
          <Card className="rounded-lg">
            <CardContent className="space-y-4 p-6">
              <div>
                <h1 className="text-3xl font-semibold">إدارة هوية الطابعات</h1>
                <p className="mt-2 text-muted-foreground">
                  عرّف الطابعات الموثوقة، أضف مواقعها وأسماءها، ثم استخدمها لربط الطابعات لكل مستخدم من صفحة إدارة المستخدمين.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={loadData} disabled={loading}>
                  {loading ? 'جاري التحديث...' : 'تحديث بيانات PrintNode'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormData(initialFormState)}
                >
                  مسح النموذج
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-3 text-slate-600">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                      <span>{stat.label}</span>
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.hint}</p>
                  </div>
                );
              })}
            </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>إضافة أو تحديث طابعة</CardTitle>
              <CardDescription>املأ البيانات التالية ليظهر الاسم الودي والورق المقترح عند ربط الطابعة بالمستخدمين.</CardDescription>
            </CardHeader>
            <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
              <Field>
                <FieldLabel>معرف الطابعة في PrintNode</FieldLabel>
                <Input
                  type="text"
                  value={formData.printerId}
                  onChange={(e) => handleFormChange('printerId', e.target.value)}
                  placeholder="مثال: 75062490"
                />
              </Field>
              <Field>
                <FieldLabel>اسم الطابعة</FieldLabel>
                <Input
                  type="text"
                  value={formData.label}
                  onChange={(e) => handleFormChange('label', e.target.value)}
                  placeholder="طابعة تحضير أ"
                />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>الموقع أو الحاسوب</FieldLabel>
                  <Input
                    type="text"
                    value={formData.location}
                    onChange={(e) => handleFormChange('location', e.target.value)}
                    placeholder="مكتب التحضير - جهاز خالد"
                  />
                </Field>
                <Field>
                  <FieldLabel>ورق الطباعة</FieldLabel>
                  <Input
                    type="text"
                    value={formData.paperName}
                    onChange={(e) => handleFormChange('paperName', e.target.value)}
                    placeholder="LABEL(100mm x 150mm)"
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel>ملاحظات</FieldLabel>
                <Input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => handleFormChange('notes', e.target.value)}
                  placeholder="يجب إعادة تشغيل PrintNode يومياً"
                />
              </Field>
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'جاري الحفظ...' : 'حفظ الطابعة'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setFormData(initialFormState)}
                >
                  إعادة التعيين
                </Button>
              </div>
              </FieldGroup>
            </form>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>الطابعات المعرفة ({profiles.length})</CardTitle>
            </CardHeader>
            <CardContent>
            {profiles.length === 0 ? (
              <EmptyState title="لم يتم إضافة أي طابعة بعد" />
            ) : (
              <div className="space-y-3">
                {profiles
                  .slice()
                  .sort((a, b) => a.label.localeCompare(b.label, 'ar'))
                  .map((profile) => (
                    <div
                      key={profile.id}
                      className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-foreground">{profile.label}</p>
                          <p className="text-xs">معرف: {profile.printerId}</p>
                          {profile.location && <p className="text-xs">الموقع: {profile.location}</p>}
                          {profile.paperName && <p className="text-xs">الورق: {profile.paperName}</p>}
                          {profile.notes && <p className="text-xs">ملاحظات: {profile.notes}</p>}
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleCopyId(profile.printerId)}
                          >
                            <Copy className="h-4 w-4" />
                            نسخ المعرف
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleDelete(profile.id)}
                            disabled={deletingId === profile.id}
                            className="text-destructive"
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
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6 rounded-lg">
          <CardHeader>
            <CardTitle>طابعات PrintNode ({printers.length})</CardTitle>
            <CardDescription>القائمة الحالية كما أبلغها PrintNode. استخدمها للتحقق من الحالة وربطها بالتكوينات أعلاه.</CardDescription>
          </CardHeader>
          <CardContent>
          {loading ? (
            <LoadingState label="جاري تحميل الطابعات..." />
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {printers.map((printer) => (
                <div key={printer.id} className="rounded-lg border bg-card px-4 py-4 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-semibold text-foreground">{printer.name}</p>
                      <p className="text-xs">معرف: {printer.id}</p>
                    </div>
                    <Badge variant={printer.state === 'disconnected' ? 'destructive' : printer.state === 'online' ? 'default' : 'secondary'}>
                      {printer.state || 'غير معروف'}
                    </Badge>
                  </div>
                  {printer.description && <p className="mt-1 text-xs">{printer.description}</p>}
                  {printer.computer?.name && (
                    <p className="text-xs">الحاسوب: {printer.computer.name || printer.computer.hostname}</p>
                  )}
                  {printer.default?.paperName && (
                    <p className="text-xs">الورق الافتراضي: {printer.default.paperName || printer.default.paper}</p>
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
          </CardContent>
        </Card>
      </div>
    </AppPageShell>
  );
}
