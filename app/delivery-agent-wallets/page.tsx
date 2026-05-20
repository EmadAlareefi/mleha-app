'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppPageShell } from '@/components/dashboard/app-page-shell';
import { LoadingState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

interface WalletStatsSnapshot {
  count: number;
  total: number;
}

interface WalletStats {
  shipments: WalletStatsSnapshot;
  tasks: WalletStatsSnapshot;
  payouts: WalletStatsSnapshot;
  adjustments: WalletStatsSnapshot;
  totalEarned: number;
  totalPaid: number;
}

interface WalletSummary {
  agent: {
    id: string;
    name: string;
    username: string;
    phone?: string | null;
  };
  balance: number;
  stats: WalletStats;
}

interface WalletSummaryResponse {
  success: boolean;
  wallets: WalletSummary[];
  summary: {
    totalAgents: number;
    totalOutstanding: number;
    totalShipments: number;
    totalTasks: number;
    totalPayouts: number;
    totalPaidAmount: number;
    adminWalletBalance: number;
  };
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(value);

export default function DeliveryAgentWalletsPage() {
  const { toast } = useToast();
  const [wallets, setWallets] = useState<WalletSummary[]>([]);
  const [summary, setSummary] = useState<WalletSummaryResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formState, setFormState] = useState({
    deliveryAgentId: '',
    amount: '',
    paymentMethod: 'cash',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [collectingAgentId, setCollectingAgentId] = useState<string | null>(null);

  useEffect(() => {
    fetchWallets();
  }, []);

  const fetchWallets = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/delivery-agent-wallets');
      const data: WalletSummaryResponse = await response.json();

      if (!response.ok) {
        throw new Error((data as any)?.error || 'فشل في تحميل المحافظ');
      }

      setWallets(data.wallets || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleCollectOutstanding = async (wallet: WalletSummary) => {
    if (wallet.balance <= 0 || collectingAgentId === wallet.agent.id) {
      return;
    }

    const confirmed = window.confirm(
      `سيتم تسجيل تحصيل بقيمة ${formatCurrency(wallet.balance)} للمندوب ${wallet.agent.name}. هل تريد المتابعة؟`
    );
    if (!confirmed) {
      return;
    }

    try {
      setCollectingAgentId(wallet.agent.id);
      const response = await fetch('/api/delivery-agent-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryAgentId: wallet.agent.id,
          amount: wallet.balance,
          paymentMethod: 'cash',
          notes: 'تحصيل رصيد الشحنات (من لوحة إدارة المحافظ)',
          settleCod: true,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحصيل المبلغ');
      }

      const settledAmount = data?.settledCod?.amount ?? wallet.balance;

      toast({
        title: 'تم تحصيل رصيد المندوب',
        description: `تم تسجيل تحصيل بقيمة ${formatCurrency(settledAmount)} من ${wallet.agent.name}.`,
      });
      await fetchWallets();
    } catch (err) {
      toast({
        title: 'فشل التحصيل',
        description: err instanceof Error ? err.message : 'حدث خطأ أثناء التحصيل، يرجى المحاولة مجدداً',
        variant: 'destructive',
      });
    } finally {
      setCollectingAgentId(null);
    }
  };

  const handleRecordPayout = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!formState.deliveryAgentId || !formState.amount) {
      setError('يرجى اختيار المندوب وإدخال المبلغ');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const response = await fetch('/api/delivery-agent-wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryAgentId: formState.deliveryAgentId,
          amount: Number(formState.amount),
          paymentMethod: formState.paymentMethod,
          notes: formState.notes || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تسجيل الدفعة');
      }

      toast({
        title: 'تم تسجيل الدفعة',
        description: 'تم خصم المبلغ من رصيد المندوب بنجاح',
      });

      setFormState((prev) => ({ ...prev, amount: '', notes: '' }));
      await fetchWallets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الدفعة');
    } finally {
      setSubmitting(false);
    }
  };

  const totalPositiveBalances = useMemo(
    () => wallets.reduce((sum, wallet) => sum + Math.max(wallet.balance, 0), 0),
    [wallets]
  );

  return (
    <AppPageShell title="محافظ المناديب" subtitle="متابعة رصيد الشحنات والمهمات المكتملة ودفعات الإدارة">
      <div className="mx-auto w-full max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <Button onClick={fetchWallets} variant="outline" disabled={loading}>
            تحديث البيانات
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {summary && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">إجمالي المستحقات</p>
              <p className="text-2xl font-semibold text-emerald-600">
                {formatCurrency(summary.totalOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">يمثل ما يجب على الإدارة سداده</p>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">إجمالي ما تم سداده</p>
              <p className="text-2xl font-semibold text-blue-600">
                {formatCurrency(summary.totalPaidAmount)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">عدد الدفعات: {summary.totalPayouts}</p>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">الشحنات المكتملة</p>
              <p className="text-2xl font-semibold text-indigo-600">{summary.totalShipments}</p>
              <p className="text-xs text-muted-foreground mt-1">30 ريال لكل شحنة</p>
              </CardContent>
            </Card>
            <Card className="rounded-lg">
              <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">المهام المكتملة</p>
              <p className="text-2xl font-semibold text-purple-600">{summary.totalTasks}</p>
              <p className="text-xs text-muted-foreground mt-1">30 ريال لكل مهمة</p>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3 mb-8">
          <Card className="rounded-lg lg:col-span-2">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>قائمة المحافظ</CardTitle>
                <CardDescription>رصيد كل مندوب مع تفاصيل الإنجاز والدفعات</CardDescription>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p>عدد المناديب: {wallets.length}</p>
                <p>صافي التزامات الإدارة: {formatCurrency(totalPositiveBalances)}</p>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المندوب</TableHead>
                    <TableHead>الشحنات المكتملة</TableHead>
                    <TableHead>المهام المكتملة</TableHead>
                    <TableHead>إجمالي المكافآت</TableHead>
                    <TableHead>المدفوع</TableHead>
                    <TableHead>الرصيد الحالي</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallets.map((wallet) => (
                    <TableRow key={wallet.agent.id}>
                      <TableCell>
                        <div className="font-semibold">{wallet.agent.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {wallet.agent.username}
                          {wallet.agent.phone ? ` • ${wallet.agent.phone}` : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{wallet.stats.shipments.count}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(wallet.stats.shipments.total)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{wallet.stats.tasks.count}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatCurrency(wallet.stats.tasks.total)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatCurrency(wallet.stats.totalEarned)}
                        </div>
                        <div className="text-xs text-muted-foreground">شحنات + مهام</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {formatCurrency(wallet.stats.totalPaid)}
                        </div>
                        <div className="text-xs text-muted-foreground">خصومات مسجلة</div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`font-semibold ${
                            wallet.balance > 0
                              ? 'text-emerald-600'
                              : wallet.balance < 0
                                ? 'text-red-600'
                                : 'text-slate-600'
                          }`}
                        >
                          {formatCurrency(wallet.balance)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={wallet.balance <= 0 || collectingAgentId === wallet.agent.id}
                          onClick={() => handleCollectOutstanding(wallet)}
                        >
                          {collectingAgentId === wallet.agent.id ? 'جاري التحصيل...' : 'تحصيل الرصيد'}
                        </Button>
                        {wallet.balance <= 0 && (
                          <p className="text-xs text-muted-foreground mt-1">لا يوجد رصيد موجب للتحصيل</p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!wallets.length && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        لا توجد بيانات محافظ حتى الآن
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>تسجيل دفعة لمندوب</CardTitle>
            </CardHeader>
            <CardContent>
            <form onSubmit={handleRecordPayout}>
              <FieldGroup>
              <Field>
                <FieldLabel>اختر المندوب</FieldLabel>
                <NativeSelect
                  value={formState.deliveryAgentId}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, deliveryAgentId: event.target.value }))
                  }
                >
                  <NativeSelectOption value="">اختر المندوب</NativeSelectOption>
                  {wallets.map((wallet) => (
                    <NativeSelectOption key={wallet.agent.id} value={wallet.agent.id}>
                      {wallet.agent.name} — رصيد {formatCurrency(wallet.balance)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>

              <Field>
                <FieldLabel>المبلغ (ر.س)</FieldLabel>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={formState.amount}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, amount: event.target.value }))
                  }
                  placeholder="30"
                />
              </Field>

              <Field>
                <FieldLabel>طريقة الدفع</FieldLabel>
                <NativeSelect
                  value={formState.paymentMethod}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, paymentMethod: event.target.value }))
                  }
                >
                  <NativeSelectOption value="cash">نقداً</NativeSelectOption>
                  <NativeSelectOption value="bank_transfer">تحويل بنكي</NativeSelectOption>
                  <NativeSelectOption value="wallet">محفظة إلكترونية</NativeSelectOption>
                </NativeSelect>
              </Field>

              <Field>
                <FieldLabel>ملاحظات (اختياري)</FieldLabel>
                <Input
                  type="text"
                  value={formState.notes}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  placeholder="مثال: دفعة أسبوعية"
                />
              </Field>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'جاري تسجيل الدفعة...' : 'تسجيل الدفعة وخصم الرصيد'}
              </Button>
              <FieldDescription className="text-center">
                يتم خصم الدفعات من رصيد المندوب وتظهر مباشرة في التقرير أعلاه
              </FieldDescription>
              </FieldGroup>
            </form>
            </CardContent>
          </Card>
        </div>

        {loading && (
          <LoadingState label="جاري تحميل بيانات المحافظ..." />
        )}
      </div>
    </AppPageShell>
  );
}
