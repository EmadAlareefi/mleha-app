'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
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

  useEffect(() => {
    fetchWallets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">محافظ المناديب</h1>
            <p className="text-slate-600">متابعة رصيد الشحنات والمهمات المكتملة ودفعات الإدارة</p>
          </div>
          <Button onClick={fetchWallets} variant="outline" disabled={loading}>
            تحديث البيانات
          </Button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            {error}
          </div>
        )}

        {summary && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
            <Card className="p-4">
              <p className="text-sm text-slate-500">إجمالي المستحقات</p>
              <p className="text-2xl font-semibold text-emerald-600">
                {formatCurrency(summary.totalOutstanding)}
              </p>
              <p className="text-xs text-slate-500 mt-1">يمثل ما يجب على الإدارة سداده</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-slate-500">إجمالي ما تم سداده</p>
              <p className="text-2xl font-semibold text-blue-600">
                {formatCurrency(summary.totalPaidAmount)}
              </p>
              <p className="text-xs text-slate-500 mt-1">عدد الدفعات: {summary.totalPayouts}</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-slate-500">الشحنات المكتملة</p>
              <p className="text-2xl font-semibold text-indigo-600">{summary.totalShipments}</p>
              <p className="text-xs text-slate-500 mt-1">30 ريال لكل شحنة</p>
            </Card>
            <Card className="p-4">
              <p className="text-sm text-slate-500">المهام المكتملة</p>
              <p className="text-2xl font-semibold text-purple-600">{summary.totalTasks}</p>
              <p className="text-xs text-slate-500 mt-1">30 ريال لكل مهمة</p>
            </Card>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3 mb-8">
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">قائمة المحافظ</h2>
                <p className="text-sm text-slate-500">رصيد كل مندوب مع تفاصيل الإنجاز والدفعات</p>
              </div>
              <div className="text-right text-sm text-slate-500">
                <p>عدد المناديب: {wallets.length}</p>
                <p>صافي التزامات الإدارة: {formatCurrency(totalPositiveBalances)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المندوب</TableHead>
                    <TableHead>الشحنات المكتملة</TableHead>
                    <TableHead>المهام المكتملة</TableHead>
                    <TableHead>إجمالي المكافآت</TableHead>
                    <TableHead>المدفوع</TableHead>
                    <TableHead>الرصيد الحالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallets.map((wallet) => (
                    <TableRow key={wallet.agent.id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{wallet.agent.name}</div>
                        <div className="text-xs text-slate-500">
                          {wallet.agent.username}
                          {wallet.agent.phone ? ` • ${wallet.agent.phone}` : ''}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-slate-900 font-medium">{wallet.stats.shipments.count}</div>
                        <div className="text-xs text-slate-500">
                          {formatCurrency(wallet.stats.shipments.total)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-slate-900 font-medium">{wallet.stats.tasks.count}</div>
                        <div className="text-xs text-slate-500">
                          {formatCurrency(wallet.stats.tasks.total)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-slate-900 font-medium">
                          {formatCurrency(wallet.stats.totalEarned)}
                        </div>
                        <div className="text-xs text-slate-500">شحنات + مهام</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-slate-900 font-medium">
                          {formatCurrency(wallet.stats.totalPaid)}
                        </div>
                        <div className="text-xs text-slate-500">خصومات مسجلة</div>
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
                    </TableRow>
                  ))}
                  {!wallets.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-slate-500 py-6">
                        لا توجد بيانات محافظ حتى الآن
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">تسجيل دفعة لمندوب</h2>
            <form className="space-y-4" onSubmit={handleRecordPayout}>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">
                  اختر المندوب
                </label>
                <Select
                  value={formState.deliveryAgentId}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, deliveryAgentId: event.target.value }))
                  }
                >
                  <option value="">اختر المندوب</option>
                  {wallets.map((wallet) => (
                    <option key={wallet.agent.id} value={wallet.agent.id}>
                      {wallet.agent.name} — رصيد {formatCurrency(wallet.balance)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">
                  المبلغ (ر.س)
                </label>
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
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">
                  طريقة الدفع
                </label>
                <Select
                  value={formState.paymentMethod}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, paymentMethod: event.target.value }))
                  }
                >
                  <option value="cash">نقداً</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="wallet">محفظة إلكترونية</option>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 mb-1 block">
                  ملاحظات (اختياري)
                </label>
                <Input
                  type="text"
                  value={formState.notes}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, notes: event.target.value }))
                  }
                  placeholder="مثال: دفعة أسبوعية"
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'جاري تسجيل الدفعة...' : 'تسجيل الدفعة وخصم الرصيد'}
              </Button>
              <p className="text-xs text-slate-500 text-center">
                يتم خصم الدفعات من رصيد المندوب وتظهر مباشرة في التقرير أعلاه
              </p>
            </form>
          </Card>
        </div>

        {loading && (
          <div className="text-center text-slate-500">جاري تحميل بيانات المحافظ...</div>
        )}
      </div>
    </div>
  );
}
