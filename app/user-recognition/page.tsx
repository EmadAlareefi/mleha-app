'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Award, Loader2, RefreshCcw, ShieldAlert, UserPlus2 } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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

const kindColors: Record<RecognitionKind, string> = {
  REWARD: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENALTY: 'bg-rose-50 text-rose-700 border-rose-200',
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
    if (!formData.userId || !formData.title) {
      alert('يرجى اختيار المستخدم وكتابة عنوان السجل');
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
      alert(error?.message || 'تعذر إنشاء السجل');
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <AppNavbar title="سجل المخالفات والمكافآت" subtitle="إدارة السجل التحفيزي للموظفين" />
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-8">
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
                  <label className="mb-1 block text-sm font-semibold text-slate-600">
                    تصفية حسب المستخدم
                  </label>
                  <Select
                    value={filters.userId}
                    onChange={(event) => handleFilterChange('userId', event.target.value)}
                    disabled={usersLoading}
                    className="rounded-2xl"
                  >
                    <option value="">جميع المستخدمين</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.username})
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-600">
                    نوع السجل
                  </label>
                  <Select
                    value={filters.kind}
                    onChange={(event) => handleFilterChange('kind', event.target.value)}
                    className="rounded-2xl"
                  >
                    <option value="all">الكل</option>
                    <option value="reward">مكافآت فقط</option>
                    <option value="penalty">مخالفات فقط</option>
                  </Select>
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
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-2xl px-3 py-2">
                  {recordsError}
                </p>
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
                          لا توجد سجلات لعرضها حالياً
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
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${kindColors[record.kind]}`}
                            >
                              {record.kind === 'REWARD' ? <Award className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                              {kindLabels[record.kind]}
                            </span>
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
                <p className="mb-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-600">
                  {usersError}
                </p>
              )}
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600">اختر المستخدم</label>
                  <Select
                    value={formData.userId}
                    disabled={usersLoading}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        userId: event.target.value,
                      }))
                    }
                    className="rounded-2xl"
                    required
                  >
                    <option value="">-</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.username})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-semibold text-slate-600">نوع السجل</label>
                    <Select
                      value={formData.kind}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          kind: event.target.value as RecognitionKind,
                        }))
                      }
                      className="rounded-2xl"
                    >
                      <option value="REWARD">مكافأة</option>
                      <option value="PENALTY">مخالفة</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-semibold text-slate-600">النقاط</label>
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
                      className="rounded-2xl"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600">عنوان السجل</label>
                  <Input
                    placeholder="مثال: مكافأة على سرعة إنجاز الطلبات"
                    value={formData.title}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    className="rounded-2xl"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600">الوصف</label>
                  <textarea
                    value={formData.description}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        description: event.target.value,
                      }))
                    }
                    rows={4}
                    className="w-full rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    placeholder="تفاصيل إضافية تظهر للمستخدم"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-600">تاريخ التطبيق</label>
                  <Input
                    type="date"
                    value={dateInputValue(formData.effectiveDate)}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        effectiveDate: event.target.value,
                      }))
                    }
                    className="rounded-2xl"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting || !formData.userId}
                  className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700"
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
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
