'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, RefreshCcw, ShieldAlert, Sparkles } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState, LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
    <AppPageShell title="سجلي التحفيزي" subtitle="تابع مكافآتك ومخالفاتك في مكان واحد">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-lg">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4" />
                إجمالي المكافآت
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-emerald-600">
                {summary.rewardPoints.toLocaleString('ar-SA')}
              </p>
              <p className="text-xs text-muted-foreground">
                {summary.rewardCount} {summary.rewardCount === 1 ? 'سجل' : 'سجلات'}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldAlert className="h-4 w-4" />
                النقاط السالبة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-rose-600">
                {summary.penaltyPoints.toLocaleString('ar-SA')}
              </p>
              <p className="text-xs text-muted-foreground">
                {summary.penaltyCount} {summary.penaltyCount === 1 ? 'سجل' : 'سجلات'}
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
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
              <p className="text-xs text-muted-foreground">آخر ١٠٠ سجل مضاف</p>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-amber-500" />
              السجل التفصيلي
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              تظهر هنا آخر السجلات التحفيزية الخاصة بك، مع تفاصيل التواريخ والجهة المسؤولة.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={filterKind === 'ALL' ? 'default' : 'outline'}
                  onClick={() => setFilterKind('ALL')}
                >
                  الكل
                </Button>
                <Button
                  type="button"
                  variant={filterKind === 'REWARD' ? 'default' : 'outline'}
                  onClick={() => setFilterKind('REWARD')}
                >
                  مكافآت
                </Button>
                <Button
                  type="button"
                  variant={filterKind === 'PENALTY' ? 'default' : 'outline'}
                  onClick={() => setFilterKind('PENALTY')}
                >
                  مخالفات
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="border"
                onClick={fetchRecords}
              >
                <RefreshCcw className="h-4 w-4" />
                تحديث
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {loading ? (
              <LoadingState label="جار تحميل السجل..." />
            ) : filteredRecords.length === 0 ? (
              <EmptyState title="لا توجد سجلات مطابقة حالياً." />
            ) : (
              <div className="space-y-4">
                {filteredRecords.map((record) => (
                  <div
                    key={record.id}
                    className={`rounded-lg border px-5 py-4 shadow-sm ${
                      record.kind === 'REWARD'
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : 'border-destructive/20 bg-destructive/5'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={record.kind === 'REWARD' ? 'secondary' : 'destructive'}>
                          {record.kind === 'REWARD' ? <Sparkles className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                          {record.kind === 'REWARD' ? 'مكافأة' : 'مخالفة'}
                        </Badge>
                        <p className="text-base font-semibold text-foreground">{record.title}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-foreground">
                          {Number(record.points || 0).toLocaleString('ar-SA')}
                        </p>
                        <p className="text-xs text-muted-foreground">النقاط</p>
                      </div>
                    </div>
                    {record.description && (
                      <p className="mt-3 text-sm text-muted-foreground">{record.description}</p>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span>التاريخ: {formatDate(record.effectiveDate || record.createdAt)}</span>
                      {record.createdByName && <span>أضيفت بواسطة: {record.createdByName}</span>}
                    </div>
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
