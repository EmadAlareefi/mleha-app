'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Award, Loader2, RefreshCcw, ShieldAlert, UserPlus2 } from 'lucide-react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { EmptyState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type RecognitionKind = 'REWARD' | 'PENALTY';

interface OrderUserOption {
  id: string;
  name: string;
  username: string;
}

interface RecognitionRecord {
  id: string;
  kind: RecognitionKind;
  title: string;
  description?: string | null;
  points: number;
  effectiveDate: string;
  createdAt: string;
  createdByName?: string | null;
  createdByUsername?: string | null;
  user: {
    id: string;
    name: string;
    username: string;
  };
}

const kindLabels: Record<RecognitionKind, string> = {
  REWARD: 'مكافأة',
  PENALTY: 'مخالفة',
};

const dateInputValue = (value: string) => value.split('T')[0];

export default function UserRecognitionAdminPage() {
  const [users, setUsers] = useState<OrderUserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [records, setRecords] = useState<RecognitionRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    userId: '',
    kind: 'all',
  });
  const [formData, setFormData] = useState({
    userId: '',
    kind: 'REWARD' as RecognitionKind,
    title: '',
    description: '',
    points: '',
    effectiveDate: new Date().toISOString().split('T')[0],
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      setUsersError(null);
      const response = await fetch('/api/order-users');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'فشل تحميل المستخدمين');
      }
      const data = await response.json();
      const mappedUsers: OrderUserOption[] = (data.users || []).map((user: any) => ({
        id: user.id,
        name: user.name,
        username: user.username,
      }));
      setUsers(mappedUsers);
      if (mappedUsers.length > 0) {
        setFormData((prev) => ({
          ...prev,
          userId: prev.userId || mappedUsers[0].id,
        }));
      }
    } catch (error: any) {
      console.error('Failed to load users', error);
      setUsers([]);
      setUsersError(error?.message || 'تعذر تحميل المستخدمين');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      setRecordsLoading(true);
      setRecordsError(null);
      const params = new URLSearchParams({ scope: 'all', limit: '100' });
      if (filters.userId) {
        params.set('userId', filters.userId);
      }
      if (filters.kind !== 'all') {
        params.set('kind', filters.kind === 'reward' ? 'reward' : 'penalty');
      }
      const response = await fetch(`/api/user-recognition?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'فشل تحميل السجلات');
      }
      const data = await response.json();
      setRecords(data.records || []);
    } catch (error: any) {
      console.error('Failed to load recognition records', error);
      setRecords([]);
      setRecordsError(error?.message || 'تعذر تحميل السجلات');
    } finally {
      setRecordsLoading(false);
    }
  }, [filters.kind, filters.userId]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const stats = useMemo(() => {
    const rewards = records.filter((record) => record.kind === 'REWARD');
    const penalties = records.filter((record) => record.kind === 'PENALTY');
    const rewardPoints = rewards.reduce((sum, record) => sum + Number(record.points || 0), 0);
    const penaltyPoints = penalties.reduce(
      (sum, record) => sum + Math.abs(Number(record.points || 0)),
      0
    );

    return {
      totalRecords: records.length,
      rewardCount: rewards.length,
      penaltyCount: penalties.length,
      rewardPoints,
      penaltyPoints,
      netPoints: rewardPoints - penaltyPoints,
    };
  }, [records]);

  const handleFilterChange = (key: 'userId' | 'kind', value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleFormSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!formData.userId || !formData.title) {
      setFormError('يرجى اختيار المستخدم وكتابة عنوان السجل');
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch('/api/user-recognition', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: formData.userId,
          kind: formData.kind,
          title: formData.title,
          description: formData.description || undefined,
          points: formData.points ? Number(formData.points) : undefined,
          effectiveDate: formData.effectiveDate,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر إنشاء السجل');
      }

      setFormData((prev) => ({
        ...prev,
        title: '',
        description: '',
        points: '',
      }));
      fetchRecords();
    } catch (error: any) {
      console.error('Failed to create recognition record', error);
      setFormError(error?.message || 'تعذر إنشاء السجل');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (value: string) => {
    try {
      return new Intl.DateTimeFormat('ar-SA', {
        dateStyle: 'medium',
      }).format(new Date(value));
    } catch {
      return value;
    }
  };

  return (
    <AppPageShell title="سجل المخالفات والمكافآت" subtitle="إدارة السجل التحفيزي للموظفين">
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-white/90 border-emerald-100 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-emerald-700">إجمالي المكافآت</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-emerald-600">{stats.rewardCount}</p>
              <p className="text-xs text-slate-500">
                {stats.rewardPoints.toLocaleString('ar-SA')} نقطة إيجابية
              </p>
            </CardContent>
          </Card>
          <Card className="bg-white/90 border-rose-100 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-rose-700">إجمالي المخالفات</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-rose-600">{stats.penaltyCount}</p>
              <p className="text-xs text-slate-500">
                {stats.penaltyPoints.toLocaleString('ar-SA')} نقطة سالبة
              </p>
            </CardContent>
          </Card>
          <Card className="bg-white/90 border-slate-100 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-700">صافي النقاط</CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`text-3xl font-bold ${
                  stats.netPoints >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {stats.netPoints.toLocaleString('ar-SA')}
              </p>
              <p className="text-xs text-slate-500">الفارق بين المكافآت والمخالفات</p>
            </CardContent>
          </Card>
          <Card className="bg-white/90 border-slate-100 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-700">عدد السجلات</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-slate-800">
                {stats.totalRecords.toLocaleString('ar-SA')}
              </p>
              <p className="text-xs text-slate-500">آخر ١٠٠ عنصر تم تحميلها</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
          <Card className="border border-slate-100 shadow-md bg-white/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <ShieldAlert className="h-5 w-5 text-indigo-600" />
                سجل السجلات
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <FieldLabel>تصفية حسب المستخدم</FieldLabel>
                  <NativeSelect
                    value={filters.userId}
                    onChange={(event) => handleFilterChange('userId', event.target.value)}
                    disabled={usersLoading}
                  >
                    <NativeSelectOption value="">جميع المستخدمين</NativeSelectOption>
                    {users.map((user) => (
                      <NativeSelectOption key={user.id} value={user.id}>
                        {user.name} ({user.username})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <FieldLabel>نوع السجل</FieldLabel>
                  <NativeSelect
                    value={filters.kind}
                    onChange={(event) => handleFilterChange('kind', event.target.value)}
                  >
                    <NativeSelectOption value="all">الكل</NativeSelectOption>
                    <NativeSelectOption value="reward">مكافآت فقط</NativeSelectOption>
                    <NativeSelectOption value="penalty">مخالفات فقط</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="flex items-end justify-end">
                  <Button
                    variant="outline"
                    className="rounded-2xl"
                    type="button"
                    onClick={fetchRecords}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    تحديث
                  </Button>
                </div>
              </div>

              {recordsError && (
                <Alert variant="destructive">
                  <AlertDescription>{recordsError}</AlertDescription>
                </Alert>
              )}

              <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead>المستخدم</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>العنوان</TableHead>
                      <TableHead>النقاط</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>تمت بواسطة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordsLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                          <div className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            جار التحميل...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : records.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                          <EmptyState title="لا توجد سجلات لعرضها حالياً" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      records.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-900">{record.user.name}</span>
                              <span className="text-xs text-slate-500">{record.user.username}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={record.kind === 'REWARD' ? 'secondary' : 'destructive'}>
                              {record.kind === 'REWARD' ? <Award className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                              {kindLabels[record.kind]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <span className="font-medium text-slate-900">{record.title}</span>
                              {record.description && (
                                <p className="text-xs text-slate-500">{record.description}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-semibold text-slate-900">
                            {record.points.toLocaleString('ar-SA')}
                          </TableCell>
                          <TableCell>{formatDate(record.effectiveDate || record.createdAt)}</TableCell>
                          <TableCell>
                            {record.createdByName ? (
                              <div className="space-y-0.5">
                                <span className="text-sm text-slate-900">{record.createdByName}</span>
                                {record.createdByUsername && (
                                  <span className="text-xs text-slate-500">{record.createdByUsername}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-indigo-100 shadow-md bg-white/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-900">
                <UserPlus2 className="h-5 w-5 text-indigo-600" />
                إنشاء مخالفة أو مكافأة
              </CardTitle>
            </CardHeader>
            <CardContent>
              {usersError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{usersError}</AlertDescription>
                </Alert>
              )}
              {formError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <FieldGroup>
                <Field>
                  <FieldLabel>اختر المستخدم</FieldLabel>
                  <NativeSelect
                    value={formData.userId}
                    disabled={usersLoading}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        userId: event.target.value,
                      }))
                    }
                    required
                  >
                    <NativeSelectOption value="">-</NativeSelectOption>
                    {users.map((user) => (
                      <NativeSelectOption key={user.id} value={user.id}>
                        {user.name} ({user.username})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field>
                    <FieldLabel>نوع السجل</FieldLabel>
                    <NativeSelect
                      value={formData.kind}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          kind: event.target.value as RecognitionKind,
                        }))
                      }
                    >
                      <NativeSelectOption value="REWARD">مكافأة</NativeSelectOption>
                      <NativeSelectOption value="PENALTY">مخالفة</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>النقاط</FieldLabel>
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="مثال: 10"
                      value={formData.points}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          points: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>عنوان السجل</FieldLabel>
                  <Input
                    placeholder="مثال: مكافأة على سرعة إنجاز الطلبات"
                    value={formData.title}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel>الوصف</FieldLabel>
                  <Textarea
                    value={formData.description}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    rows={4}
                    placeholder="تفاصيل إضافية تظهر للمستخدم"
                  />
                </Field>
                <Field>
                  <FieldLabel>تاريخ التطبيق</FieldLabel>
                  <Input
                    type="date"
                    value={dateInputValue(formData.effectiveDate)}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={submitting || !formData.userId}
                  className="w-full"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري الحفظ...
                    </>
                  ) : (
                    <>
                      <Award className="h-4 w-4" />
                      حفظ السجل
                    </>
                  )}
                </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppPageShell>
  );
}
