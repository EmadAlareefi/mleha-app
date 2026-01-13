'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Loader2, RefreshCcw, ShieldAlert, Sparkles } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type RecognitionKind = 'REWARD' | 'PENALTY';

interface RecognitionRecord {
  id: string;
  kind: RecognitionKind;
  title: string;
  description?: string | null;
  points: number;
  effectiveDate: string;
  createdAt: string;
  createdByName?: string | null;
}

export default function MyRecognitionPage() {
  const [records, setRecords] = useState<RecognitionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<'ALL' | RecognitionKind>('ALL');

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: '100' });
      if (filterKind !== 'ALL') {
        params.set('kind', filterKind === 'REWARD' ? 'reward' : 'penalty');
      }
      const response = await fetch(`/api/user-recognition?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'تعذر تحميل السجل الشخصي');
      }
      const data = await response.json();
      setRecords(data.records || []);
    } catch (err: any) {
      console.error('Failed to load recognition history', err);
      setRecords([]);
      setError(err?.message || 'تعذر تحميل السجل الشخصي');
    } finally {
      setLoading(false);
    }
  }, [filterKind]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const summary = useMemo(() => {
    const rewardCount = records.filter((record) => record.kind === 'REWARD').length;
    const penaltyCount = records.filter((record) => record.kind === 'PENALTY').length;
    const rewardPoints = records
      .filter((record) => record.kind === 'REWARD')
      .reduce((sum, record) => sum + Number(record.points || 0), 0);
    const penaltyPoints = records
      .filter((record) => record.kind === 'PENALTY')
      .reduce((sum, record) => sum + Math.abs(Number(record.points || 0)), 0);
    const netPoints = rewardPoints - penaltyPoints;
    return {
      rewardCount,
      penaltyCount,
      rewardPoints,
      penaltyPoints,
      netPoints,
    };
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (filterKind === 'ALL') return records;
    return records.filter((record) => record.kind === filterKind);
  }, [records, filterKind]);

  const formatDate = (value: string) => {
    try {
      return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' }).format(new Date(value));
    } catch {
      return value;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-slate-50">
      <AppNavbar title="سجلي التحفيزي" subtitle="تابع مكافآتك ومخالفاتك في مكان واحد" />
      <main className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border border-emerald-100 bg-white/90 shadow-lg">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-emerald-600 flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                إجمالي المكافآت
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-emerald-600">
                {summary.rewardPoints.toLocaleString('ar-SA')}
              </p>
              <p className="text-xs text-slate-500">
                {summary.rewardCount} {summary.rewardCount === 1 ? 'سجل' : 'سجلات'}
              </p>
            </CardContent>
          </Card>
          <Card className="border border-rose-100 bg-white/90 shadow-lg">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-rose-600 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" />
                النقاط السالبة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-rose-600">
                {summary.penaltyPoints.toLocaleString('ar-SA')}
              </p>
              <p className="text-xs text-slate-500">
                {summary.penaltyCount} {summary.penaltyCount === 1 ? 'سجل' : 'سجلات'}
              </p>
            </CardContent>
          </Card>
          <Card className="border border-slate-100 bg-gradient-to-br from-white to-amber-50 shadow-lg">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm text-slate-700 flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-500" />
                صافي النقاط
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`text-3xl font-bold ${
                  summary.netPoints >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {summary.netPoints.toLocaleString('ar-SA')}
              </p>
              <p className="text-xs text-slate-500">آخر ١٠٠ سجل مضاف</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border border-amber-100 bg-white/95 shadow-md">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-slate-900">
              <Award className="h-5 w-5 text-amber-500" />
              السجل التفصيلي
            </CardTitle>
            <p className="text-sm text-slate-500">
              تظهر هنا آخر السجلات التحفيزية الخاصة بك، مع تفاصيل التواريخ والجهة المسؤولة.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={filterKind === 'ALL' ? 'default' : 'outline'}
                  className="rounded-2xl"
                  onClick={() => setFilterKind('ALL')}
                >
                  الكل
                </Button>
                <Button
                  type="button"
                  variant={filterKind === 'REWARD' ? 'default' : 'outline'}
                  className="rounded-2xl"
                  onClick={() => setFilterKind('REWARD')}
                >
                  مكافآت
                </Button>
                <Button
                  type="button"
                  variant={filterKind === 'PENALTY' ? 'default' : 'outline'}
                  className="rounded-2xl"
                  onClick={() => setFilterKind('PENALTY')}
                >
                  مخالفات
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="rounded-2xl border border-slate-200 text-slate-700"
                onClick={fetchRecords}
              >
                <RefreshCcw className="h-4 w-4" />
                تحديث
              </Button>
            </div>

            {error && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-10 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="mr-2">جار تحميل السجل...</span>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center text-slate-500">
                لا توجد سجلات مطابقة حالياً.
              </div>
            ) : (
              <div className="space-y-4">
                {filteredRecords.map((record) => (
                  <div
                    key={record.id}
                    className={`rounded-3xl border px-5 py-4 shadow-sm ${
                      record.kind === 'REWARD'
                        ? 'border-emerald-100 bg-emerald-50/60'
                        : 'border-rose-100 bg-rose-50/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                            record.kind === 'REWARD'
                              ? 'bg-white/70 text-emerald-700'
                              : 'bg-white/70 text-rose-700'
                          }`}
                        >
                          {record.kind === 'REWARD' ? <Sparkles className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                          {record.kind === 'REWARD' ? 'مكافأة' : 'مخالفة'}
                        </span>
                        <p className="text-base font-semibold text-slate-900">{record.title}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-slate-900">
                          {Number(record.points || 0).toLocaleString('ar-SA')}
                        </p>
                        <p className="text-xs text-slate-600">النقاط</p>
                      </div>
                    </div>
                    {record.description && (
                      <p className="mt-3 text-sm text-slate-600">{record.description}</p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                      <span>التاريخ: {formatDate(record.effectiveDate || record.createdAt)}</span>
                      {record.createdByName && <span>أضيفت بواسطة: {record.createdByName}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
