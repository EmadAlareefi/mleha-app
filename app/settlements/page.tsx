'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type ProviderOption = {
  value: 'salla' | 'smsa' | 'tabby' | 'tamara';
  label: string;
  description: string;
};

type SettlementUpload = {
  id: string;
  provider: string;
  statementDate?: string;
  originalFileName: string;
  fileSize?: number;
  uploadedByName?: string;
  status: string;
  recordCount: number;
  matchedCount: number;
  unmatchedCount: number;
  errorMessage?: string;
  createdAt: string;
};

type ProviderBreakdown = {
  provider: string;
  _count: { _all: number };
};

type SettlementStats = {
  totalRecords: number;
  linkedRecords: number;
  unmatchedRecords: number;
  providerBreakdown: ProviderBreakdown[];
};

type RecentSettlement = {
  id: string;
  provider: string;
  orderId?: string | null;
  orderNumber?: string | null;
  settlementDate?: string | null;
  netAmount?: number | null;
  currency?: string | null;
  paymentMethod?: string | null;
  eventType?: string | null;
  linkedOrderId?: string | null;
  createdAt: string;
};

type UnmatchedSample = {
  id: string;
  provider: string;
  orderId?: string | null;
  orderNumber?: string | null;
  awbNumber?: string | null;
  settlementDate?: string | null;
  netAmount?: number | null;
};

const PROVIDERS: ProviderOption[] = [
  {
    value: 'salla',
    label: 'سلة (بوابة الدفع)',
    description: 'ملفات تفاصيل المدفوعات التي ترسلها سلة بشكل دوري',
  },
  {
    value: 'smsa',
    label: 'سمسا (تحصيل الشحنات)',
    description: 'ملخص فواتير سمسا وربطها برقم الشحنة أو الطلب',
  },
  {
    value: 'tabby',
    label: 'تابي',
    description: 'تقارير تسويات Tabby (شراء الآن وادفع لاحقاً)',
  },
  {
    value: 'tamara',
    label: 'تمارا',
    description: 'تقارير التسوية الأسبوعية لتمارا',
  },
];

export default function SettlementsPage() {
  const { data: session, status } = useSession();
  const baseRole = (session?.user as any)?.role;
  const userRoles: string[] = (session?.user as any)?.roles || (baseRole ? [baseRole] : []);
  const isAdmin = userRoles.includes('admin');
  const hasAccess = isAdmin || userRoles.includes('accountant');
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [stats, setStats] = useState<SettlementStats | null>(null);
  const [uploads, setUploads] = useState<SettlementUpload[]>([]);
  const [recentSettlements, setRecentSettlements] = useState<RecentSettlement[]>([]);
  const [unmatchedSamples, setUnmatchedSamples] = useState<UnmatchedSample[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    provider: 'salla' as ProviderOption['value'],
    statementDate: '',
    notes: '',
  });
  const [uploadSummaries, setUploadSummaries] = useState<
    {
      uploadId: string;
      fileName: string;
      matchedCount: number;
      unmatchedCount: number;
      totalRecords: number;
      warnings?: string[];
    }[]
  >([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setDataError('');
      const response = await fetch('/api/settlements');
      if (!response.ok) {
        throw new Error('فشل في تحميل البيانات');
      }
      const payload = await response.json();
      setStats(payload.stats);
      setUploads(payload.uploads || []);
      setRecentSettlements(payload.recentSettlements || []);
      setUnmatchedSamples(payload.unmatchedSamples || []);
    } catch (error: any) {
      console.error('Failed to fetch settlements data', error);
      setDataError(error.message || 'فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchData();
    }
  }, [fetchData, status]);

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedFiles || selectedFiles.length === 0) {
      alert('يرجى اختيار ملف Excel واحد على الأقل');
      return;
    }

    try {
      setUploading(true);
      setUploadSummaries([]);

      const formData = new FormData();
      formData.append('provider', formState.provider);
      if (formState.statementDate) {
        formData.append('statementDate', formState.statementDate);
      }
      if (formState.notes?.trim()) {
        formData.append('notes', formState.notes);
      }
      Array.from(selectedFiles).forEach((file) => formData.append('files', file));

      const response = await fetch('/api/settlements', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'فشل في رفع الملف' }));
        throw new Error(error.error || 'فشل في رفع الملف');
      }

      const payload = await response.json();
      setUploadSummaries(payload.uploads || []);
      setSelectedFiles(null);
      (event.target as HTMLFormElement).reset();
      await fetchData();
    } catch (error: any) {
      console.error('Upload failed', error);
      alert(error.message || 'فشل في رفع الملف');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteUpload = async (uploadId: string) => {
    if (!isAdmin) return;
    const confirmDelete = window.confirm('هل أنت متأكد من حذف هذا الملف وجميع سجلات التسوية المرتبطة به؟');
    if (!confirmDelete) return;

    try {
      setDeletingId(uploadId);
      const response = await fetch(`/api/settlements?id=${uploadId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'فشل في حذف الملف' }));
        throw new Error(error.error || 'فشل في حذف الملف');
      }

      alert('تم حذف الملف وجميع السجلات المرتبطة به');
      await fetchData();
    } catch (error: any) {
      console.error('Failed to delete upload', error);
      alert(error.message || 'فشل في حذف الملف');
    } finally {
      setDeletingId(null);
    }
  };

  if (status === 'loading') {
    return (
      <AppPageShell title="تسويات المدفوعات" subtitle="جاري التحقق من الجلسة">
        <LoadingState label="جاري التحقق من الجلسة..." />
      </AppPageShell>
    );
  }

  if (!hasAccess) {
    return (
      <AppPageShell title="تسويات المدفوعات" subtitle="لا تملك صلاحية الوصول">
          <Card className="p-6 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">لا تملك صلاحية الوصول</h1>
            <p className="text-gray-600">هذه الصفحة متاحة فقط للمحاسبين أو مدراء النظام.</p>
          </Card>
      </AppPageShell>
    );
  }

  const formatDate = (value?: string | null) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatNumber = (value?: number | null) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  };

  const getUploadStatusVariant = (uploadStatus: string) => {
    if (uploadStatus === 'completed') return 'default';
    if (uploadStatus === 'processing') return 'secondary';
    return 'destructive';
  };

  return (
    <AppPageShell
      title="تسويات المدفوعات"
      subtitle="اربط تقارير سلة، سمسا، تابي، وتمارا مع الطلبات الموثقة في النظام واحتفظ بنسخة من كل ملف"
    >
      <div className="space-y-8">
        {loading && (
          <Card>
            <CardContent className="p-6">
              <LoadingState label="جاري تحميل بيانات التسويات..." />
            </CardContent>
          </Card>
        )}

        {dataError && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-4">
              <span>{dataError}</span>
              <Button className="w-fit" onClick={fetchData}>
              إعادة المحاولة
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!loading && stats && (
          <section className="grid gap-6 md:grid-cols-3">
            <Card className="p-6">
              <p className="text-sm text-gray-500 mb-2">إجمالي السجلات</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalRecords.toLocaleString('en-US')}</p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-gray-500 mb-2">تم ربطه بطلب</p>
              <p className="text-3xl font-bold text-emerald-600">{stats.linkedRecords.toLocaleString('en-US')}</p>
            </Card>
            <Card className="p-6">
              <p className="text-sm text-gray-500 mb-2">تحتاج للمراجعة</p>
              <p className="text-3xl font-bold text-amber-600">{stats.unmatchedRecords.toLocaleString('en-US')}</p>
            </Card>
          </section>
        )}

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>رفع ملفات التسويات</CardTitle>
              <CardDescription>
                اختر مزود الخدمة ثم ارفع ملف .xlsx كما وصل من البريد. سيتم ربط كل صف بالطلب المطابق وتخزين نسخة من الملف.
              </CardDescription>
            </CardHeader>
            <CardContent>

            <form className="space-y-5" onSubmit={handleUpload}>
              <Field>
                <FieldLabel>مزود التسوية</FieldLabel>
                <RadioGroup
                  value={formState.provider}
                  onValueChange={(value) =>
                    setFormState((prev) => ({ ...prev, provider: value as ProviderOption['value'] }))
                  }
                >
                  {PROVIDERS.map((provider) => (
                    <label
                      key={provider.value}
                      className="cursor-pointer rounded-md border p-4 transition has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-muted/60"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{provider.label}</p>
                          <p className="text-sm text-gray-500 mt-1">{provider.description}</p>
                        </div>
                        <RadioGroupItem value={provider.value} />
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>تاريخ البيان</FieldLabel>
                  <Input
                    type="date"
                    value={formState.statementDate}
                    onChange={(event) => setFormState((prev) => ({ ...prev, statementDate: event.target.value }))}
                  />
                </Field>
                <Field>
                  <FieldLabel>ملاحظات (اختياري)</FieldLabel>
                  <Input
                    placeholder="مثال: بيان الأسبوع الأخير من ديسمبر"
                    value={formState.notes}
                    onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </Field>
              </div>

              <Field>
                <FieldLabel>ملف التسوية (Excel)</FieldLabel>
                <Input
                  type="file"
                  accept=".xls,.xlsx"
                  multiple
                  onChange={(event) => setSelectedFiles(event.target.files)}
                />
                <FieldDescription>يمكن رفع أكثر من ملف لنفس المزود وسيتم حفظ نسخة من كل ملف.</FieldDescription>
              </Field>

              <Button type="submit" className="w-full md:w-auto" disabled={uploading}>
                {uploading ? 'جاري الرفع...' : 'رفع ومعالجة الملفات'}
              </Button>
            </form>

            {uploadSummaries.length > 0 && (
              <div className="mt-6 border-t pt-4">
                <h3 className="font-semibold text-gray-900 mb-3">نتيجة آخر رفع</h3>
                <ul className="space-y-3">
                  {uploadSummaries.map((summary) => (
                    <li key={summary.uploadId} className="rounded-lg border border-gray-200 p-4 bg-gray-50">
                      <div className="flex flex-col gap-1">
                        <p className="font-semibold text-gray-900">{summary.fileName}</p>
                        <p className="text-sm text-gray-600">
                        {`تمت معالجة ${summary.totalRecords.toLocaleString('en-US')} سجل - `}
                        <span className="text-emerald-600">
                            {summary.matchedCount.toLocaleString('en-US')} تم ربطها
                          </span>
                          {` / `}
                          <span className="text-amber-600">
                            {summary.unmatchedCount.toLocaleString('en-US')} تحتاج مراجعة
                          </span>
                        </p>
                        {summary.warnings && summary.warnings.length > 0 && (
                          <p className="text-xs text-amber-600">
                            {summary.warnings.filter(Boolean).join(' - ')}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>توزيع السجلات حسب المزود</CardTitle>
              <CardDescription>
                تساعدك هذه الإحصاءات على معرفة المزودات التي تم رفع ملفاتها مؤخراً وأيها بحاجة للمتابعة.
              </CardDescription>
            </CardHeader>
            <CardContent>
            {!stats || stats.providerBreakdown.length === 0 ? (
              <EmptyState title="لم يتم رفع أي ملفات حتى الآن." />
            ) : (
              <ul className="space-y-3">
                {stats.providerBreakdown.map((provider) => {
                  const meta = PROVIDERS.find((item) => item.value === provider.provider);
                  return (
                    <li key={provider.provider} className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3">
                      <div>
                        <p className="font-semibold text-gray-900">{meta?.label || provider.provider}</p>
                        <p className="text-sm text-gray-500">{meta?.description}</p>
                      </div>
                      <span className="text-lg font-bold text-blue-600">
                        {provider._count._all.toLocaleString('en-US')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {unmatchedSamples.length > 0 && (
              <div className="mt-8">
                <h3 className="font-semibold text-gray-900 mb-2">أحدث السجلات التي تحتاج مراجعة</h3>
                <p className="text-sm text-gray-500 mb-3">حاول تأكيد الطلب أو رقم الشحنة لهذه السجلات.</p>
                <div className="space-y-2">
                  {unmatchedSamples.map((sample) => (
                    <div key={sample.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <p className="font-semibold">{sample.provider?.toUpperCase()}</p>
                      <p>
                        {sample.orderNumber || sample.orderId || sample.awbNumber || '—'}
                        {' · '}
                        {formatDate(sample.settlementDate)}
                      </p>
                      {sample.netAmount !== null && sample.netAmount !== undefined && (
                        <p>صافي المبلغ: {formatNumber(sample.netAmount)} ر.س</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
              <CardTitle>أحدث الملفات المرفوعة</CardTitle>
              <span className="text-sm text-gray-500">
                يتم الاحتفاظ بنسخة من كل ملف لأغراض المراجعة لاحقاً.
              </span>
            </div>
            </CardHeader>
            <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الملف</TableHead>
                    <TableHead>المزود</TableHead>
                    <TableHead>تاريخ البيان</TableHead>
                    <TableHead>السجلات</TableHead>
                    <TableHead>تم ربطه</TableHead>
                    <TableHead>المتبقي</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>الحالة</TableHead>
                    {isAdmin && <TableHead>الإجراءات</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 9 : 8}>
                        <EmptyState title="لا توجد ملفات مرفوعة حتى الآن." />
                      </TableCell>
                    </TableRow>
                  )}
                  {uploads.map((upload) => {
                    const providerMeta = PROVIDERS.find((item) => item.value === upload.provider);
                    return (
                      <TableRow key={upload.id}>
                        <TableCell className="font-medium">{upload.originalFileName}</TableCell>
                        <TableCell>{providerMeta?.label || upload.provider}</TableCell>
                        <TableCell>{formatDate(upload.statementDate)}</TableCell>
                        <TableCell>{upload.recordCount.toLocaleString('en-US')}</TableCell>
                        <TableCell className="text-emerald-600">{upload.matchedCount.toLocaleString('en-US')}</TableCell>
                        <TableCell className="text-amber-600">{upload.unmatchedCount.toLocaleString('en-US')}</TableCell>
                        <TableCell>{upload.uploadedByName || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={getUploadStatusVariant(upload.status)}>
                            {upload.status === 'completed'
                              ? 'مكتمل'
                              : upload.status === 'processing'
                                ? 'جاري المعالجة'
                                : 'فشل'}
                          </Badge>
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={deletingId === upload.id}
                              onClick={() => handleDeleteUpload(upload.id)}
                            >
                              {deletingId === upload.id ? 'جاري الحذف...' : 'حذف الملف'}
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card>
            <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
              <CardTitle>آخر التسويات المرتبطة بالطلبات</CardTitle>
              <p className="text-sm text-gray-500">يتم تحديث هذه القائمة عند رفع أي ملف جديد.</p>
            </div>
            </CardHeader>
            <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المزود</TableHead>
                    <TableHead>رقم الطلب</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الصافي</TableHead>
                    <TableHead>طريقة الدفع</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSettlements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <EmptyState title="لا توجد سجلات بعد" description="ابدأ برفع الملفات للعرض هنا." />
                      </TableCell>
                    </TableRow>
                  )}
                  {recentSettlements.map((settlement) => {
                    const providerMeta = PROVIDERS.find((item) => item.value === settlement.provider);
                    return (
                      <TableRow key={settlement.id}>
                        <TableCell className="font-medium">
                          {providerMeta?.label || settlement.provider}
                        </TableCell>
                        <TableCell>{settlement.orderNumber || settlement.orderId || '-'}</TableCell>
                        <TableCell>{formatDate(settlement.settlementDate)}</TableCell>
                        <TableCell>
                          {settlement.netAmount !== null && settlement.netAmount !== undefined
                            ? `${formatNumber(settlement.netAmount)} ${settlement.currency || 'ر.س'}`
                            : '-'}
                        </TableCell>
                        <TableCell>{settlement.paymentMethod || settlement.eventType || '-'}</TableCell>
                        <TableCell>
                          <Badge variant={settlement.linkedOrderId ? 'default' : 'secondary'}>
                            {settlement.linkedOrderId ? 'مرتبط' : 'بانتظار المطابقة'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppPageShell>
  );
}
