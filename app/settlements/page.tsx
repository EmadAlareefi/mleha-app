'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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

  const fetchData = async () => {
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
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchData();
    }
  }, [status]);

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">جاري التحقق من الجلسة...</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppNavbar />
        <div className="max-w-2xl mx-auto px-4 py-16">
          <Card className="p-6 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">لا تملك صلاحية الوصول</h1>
            <p className="text-gray-600">هذه الصفحة متاحة فقط للمحاسبين أو مدراء النظام.</p>
          </Card>
        </div>
      </div>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <AppNavbar />

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">تسويات المدفوعات</h1>
          <p className="text-gray-600">
            اربط تقارير سلة، سمسا، تابي، وتمارا مع الطلبات الموثقة في النظام واحتفظ بنسخة من كل ملف.
          </p>
        </header>

        {loading && (
          <Card className="p-6 mb-8">
            <p className="text-gray-600">جاري تحميل بيانات التسويات...</p>
          </Card>
        )}

        {dataError && (
          <Card className="p-6 mb-8 border-red-200 bg-red-50">
            <p className="text-red-800">{dataError}</p>
            <Button className="mt-4" onClick={fetchData}>
              إعادة المحاولة
            </Button>
          </Card>
        )}

        {!loading && stats && (
          <section className="grid gap-6 md:grid-cols-3 mb-10">
            <Card className="p-6 bg-white/80">
              <p className="text-sm text-gray-500 mb-2">إجمالي السجلات</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalRecords.toLocaleString('en-US')}</p>
            </Card>
            <Card className="p-6 bg-white/80">
              <p className="text-sm text-gray-500 mb-2">تم ربطه بطلب</p>
              <p className="text-3xl font-bold text-emerald-600">{stats.linkedRecords.toLocaleString('en-US')}</p>
            </Card>
            <Card className="p-6 bg-white/80">
              <p className="text-sm text-gray-500 mb-2">تحتاج للمراجعة</p>
              <p className="text-3xl font-bold text-amber-600">{stats.unmatchedRecords.toLocaleString('en-US')}</p>
            </Card>
          </section>
        )}

        <section className="mb-12 grid gap-6 lg:grid-cols-2">
          <Card className="p-6 bg-white/90">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">رفع ملفات التسويات</h2>
            <p className="text-gray-600 mb-6">
              اختر مزود الخدمة ثم ارفع ملف .xlsx كما وصل من البريد. سيتم ربط كل صف بالطلب المطابق وتخزين نسخة من الملف.
            </p>

            <form className="space-y-5" onSubmit={handleUpload}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">مزود التسوية</label>
                <div className="grid gap-3">
                  {PROVIDERS.map((provider) => (
                    <label
                      key={provider.value}
                      className={`border rounded-lg p-4 cursor-pointer transition ${
                        formState.provider === provider.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{provider.label}</p>
                          <p className="text-sm text-gray-500 mt-1">{provider.description}</p>
                        </div>
                        <input
                          type="radio"
                          name="provider"
                          className="mt-1"
                          checked={formState.provider === provider.value}
                          onChange={() => setFormState((prev) => ({ ...prev, provider: provider.value }))}
                        />
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ البيان</label>
                  <input
                    type="date"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={formState.statementDate}
                    onChange={(event) => setFormState((prev) => ({ ...prev, statementDate: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">ملاحظات (اختياري)</label>
                  <input
                    type="text"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="مثال: بيان الأسبوع الأخير من ديسمبر"
                    value={formState.notes}
                    onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ملف التسوية (Excel)</label>
                <input
                  type="file"
                  accept=".xls,.xlsx"
                  multiple
                  className="w-full rounded-md border border-dashed border-gray-300 px-3 py-8 text-center text-gray-500 cursor-pointer hover:border-blue-400"
                  onChange={(event) => setSelectedFiles(event.target.files)}
                />
                <p className="text-xs text-gray-500 mt-2">يمكن رفع أكثر من ملف لنفس المزود وسيتم حفظ نسخة من كل ملف.</p>
              </div>

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
          </Card>

          <Card className="p-6 bg-white/90">
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">توزيع السجلات حسب المزود</h2>
            <p className="text-gray-600 mb-4">
              تساعدك هذه الإحصاءات على معرفة المزودات التي تم رفع ملفاتها مؤخراً وأيها بحاجة للمتابعة.
            </p>
            {!stats || stats.providerBreakdown.length === 0 ? (
              <p className="text-gray-500">لم يتم رفع أي ملفات حتى الآن.</p>
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
          </Card>
        </section>

        <section className="mb-12">
          <Card className="p-6 bg-white">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
              <h2 className="text-2xl font-semibold text-gray-900">أحدث الملفات المرفوعة</h2>
              <span className="text-sm text-gray-500">
                يتم الاحتفاظ بنسخة من كل ملف لأغراض المراجعة لاحقاً.
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">الملف</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">المزود</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">تاريخ البيان</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">السجلات</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">تم ربطه</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">المتبقي</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">المستخدم</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">الحالة</th>
                    {isAdmin && <th className="px-4 py-3 text-right font-medium text-gray-600">الإجراءات</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {uploads.length === 0 && (
                    <tr>
                      <td colSpan={isAdmin ? 9 : 8} className="px-4 py-6 text-center text-gray-500">
                        لا توجد ملفات مرفوعة حتى الآن.
                      </td>
                    </tr>
                  )}
                  {uploads.map((upload) => {
                    const providerMeta = PROVIDERS.find((item) => item.value === upload.provider);
                    return (
                      <tr key={upload.id}>
                        <td className="px-4 py-3 font-medium text-gray-900">{upload.originalFileName}</td>
                        <td className="px-4 py-3 text-gray-700">{providerMeta?.label || upload.provider}</td>
                        <td className="px-4 py-3 text-gray-700">{formatDate(upload.statementDate)}</td>
                        <td className="px-4 py-3 text-gray-900">{upload.recordCount.toLocaleString('en-US')}</td>
                        <td className="px-4 py-3 text-emerald-600">{upload.matchedCount.toLocaleString('en-US')}</td>
                        <td className="px-4 py-3 text-amber-600">{upload.unmatchedCount.toLocaleString('en-US')}</td>
                        <td className="px-4 py-3 text-gray-700">{upload.uploadedByName || '-'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              upload.status === 'completed'
                                ? 'bg-emerald-50 text-emerald-700'
                                : upload.status === 'processing'
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {upload.status === 'completed'
                              ? 'مكتمل'
                              : upload.status === 'processing'
                                ? 'جاري المعالجة'
                                : 'فشل'}
                          </span>
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-left">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={deletingId === upload.id}
                              onClick={() => handleDeleteUpload(upload.id)}
                            >
                              {deletingId === upload.id ? 'جاري الحذف...' : 'حذف الملف'}
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section className="mb-16">
          <Card className="p-6 bg-white">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
              <h2 className="text-2xl font-semibold text-gray-900">آخر التسويات المرتبطة بالطلبات</h2>
              <p className="text-sm text-gray-500">يتم تحديث هذه القائمة عند رفع أي ملف جديد.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">المزود</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">رقم الطلب</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">التاريخ</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">الصافي</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">طريقة الدفع</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {recentSettlements.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                        لا توجد سجلات بعد. ابدأ برفع الملفات للعرض هنا.
                      </td>
                    </tr>
                  )}
                  {recentSettlements.map((settlement) => {
                    const providerMeta = PROVIDERS.find((item) => item.value === settlement.provider);
                    return (
                      <tr key={settlement.id}>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {providerMeta?.label || settlement.provider}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{settlement.orderNumber || settlement.orderId || '-'}</td>
                        <td className="px-4 py-3 text-gray-700">{formatDate(settlement.settlementDate)}</td>
                        <td className="px-4 py-3 text-gray-900">
                          {settlement.netAmount !== null && settlement.netAmount !== undefined
                            ? `${formatNumber(settlement.netAmount)} ${settlement.currency || 'ر.س'}`
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{settlement.paymentMethod || settlement.eventType || '-'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              settlement.linkedOrderId ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {settlement.linkedOrderId ? 'مرتبط' : 'بانتظار المطابقة'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}
