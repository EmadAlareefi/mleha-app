'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowDownToLine,
  BarChart3,
  Download,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';

interface AffiliateManagementSummary {
  totalAffiliates: number;
  activeAffiliates: number;
  totalOrders: number;
  lifetimeNetSales: number;
  lifetimeCommission: number;
  deliveredCommission: number;
  pendingCommission: number;
  averageCommissionRate: number;
}

interface AffiliateMonthlyReport {
  period: string;
  label: string;
  totalOrders: number;
  deliveredOrders: number;
  netSales: number;
  commissionEarned: number;
  commissionPending: number;
  periodDate: string | null;
}

interface AffiliateWalletTransaction {
  id: string;
  type: 'commission' | 'payout';
  label: string;
  amount: number;
  currency: string;
  date: string;
  status: 'pending' | 'ready' | 'paid';
  orders: number;
}

interface AffiliatePayoutEntry {
  id: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED';
  reference: string | null;
  memo: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  recordedBy: {
    id: string | null;
    name: string | null;
    username: string | null;
  } | null;
}

interface AffiliateRecord {
  id: string;
  userName: string;
  ownerName: string;
  email: string | null;
  phone: string | null;
  affiliateName: string;
  normalizedAffiliateName: string;
  commissionRate: number;
  joinedAt: string;
  stats: {
    totalOrders: number;
    deliveredOrders: number;
    pendingOrders: number;
    netSales: number;
    averageOrderValue: number;
    commissionEarned: number;
    commissionPending: number;
    projectedCommission: number;
    conversionRate: number;
    lastOrderDate: string | null;
  };
  statusBreakdown: {
    key: string;
    label: string;
    count: number;
    netAmount: number;
    commissionEarned: number;
    commissionPotential: number;
  }[];
  wallet: {
    availableBalance: number;
    pendingBalance: number;
    lifetimeCommission: number;
    totalPaid: number;
    transactions: AffiliateWalletTransaction[];
  };
  payouts: AffiliatePayoutEntry[];
  monthlyReports: AffiliateMonthlyReport[];
  latestOrders: {
    id: string;
    orderId: string;
    orderNumber: string | null;
    placedAt: string | null;
    statusSlug: string | null;
    statusName: string | null;
    netAmount: number;
    currency: string | null;
    commissionAmount: number;
    isDelivered: boolean;
  }[];
}

interface AffiliateManagementResponse {
  success: true;
  summary: AffiliateManagementSummary;
  affiliates: AffiliateRecord[];
  reports: AffiliateMonthlyReport[];
  generatedAt: string;
}

type RangePreset = '30' | '90' | 'all' | 'custom';

const DATE_FORMATTER = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' });
const NUMBER_FORMATTER = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1 });
const CURRENCY = 'SAR';
const payoutStatusLabels: Record<AffiliatePayoutEntry['status'], string> = {
  PENDING: 'قيد المراجعة',
  APPROVED: 'جاهز للصرف',
  PAID: 'تم الدفع',
  CANCELLED: 'ملغاة',
};
const payoutStatusStyles: Record<AffiliatePayoutEntry['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-blue-50 text-blue-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
};

const formatCurrency = (value?: number, currency: string = CURRENCY) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatPercent = (value?: number) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '0%';
  }
  return `${NUMBER_FORMATTER.format(value)}%`;
};

const toDateInputValue = (date: Date) => date.toISOString().split('T')[0];
const formatDate = (value?: string | null) => (value ? DATE_FORMATTER.format(new Date(value)) : '—');

export default function AffiliateManagementPage() {
  const [data, setData] = useState<AffiliateManagementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAffiliateId, setSelectedAffiliateId] = useState<string>('all');
  const [selectedAffiliateFilter, setSelectedAffiliateFilter] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState<RangePreset>('90');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [payoutForm, setPayoutForm] = useState({
    amount: '',
    reference: '',
    memo: '',
    status: 'PAID' as 'PENDING' | 'APPROVED' | 'PAID',
  });
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutSuccess, setPayoutSuccess] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (rangePreset === 'custom' && (!customRange.start || !customRange.end)) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedAffiliateFilter) {
        params.append('affiliate', selectedAffiliateFilter);
      }
      if (rangePreset === '30' || rangePreset === '90') {
        const days = Number(rangePreset);
        const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const end = new Date();
        params.append('startDate', toDateInputValue(start));
        params.append('endDate', toDateInputValue(end));
      } else if (rangePreset === 'custom') {
        if (customRange.start) {
          params.append('startDate', customRange.start);
        }
        if (customRange.end) {
          params.append('endDate', customRange.end);
        }
      }

      const query = params.toString();
      const response = await fetch(query ? `/api/affiliate-management?${query}` : '/api/affiliate-management');
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'تعذر تحميل بيانات المسوقين');
      }
      setData(payload);

      if (
        selectedAffiliateId !== 'all' &&
        payload?.affiliates?.every((affiliate: AffiliateRecord) => affiliate.id !== selectedAffiliateId)
      ) {
        setSelectedAffiliateId('all');
        setSelectedAffiliateFilter(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [customRange.end, customRange.start, rangePreset, selectedAffiliateFilter, selectedAffiliateId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateAffiliateSelection = (value: string) => {
    setSelectedAffiliateId(value);
    if (value === 'all') {
      setSelectedAffiliateFilter(null);
    } else {
      const selected = data?.affiliates.find((affiliate) => affiliate.id === value);
      setSelectedAffiliateFilter(selected?.affiliateName ?? null);
    }
  };

  const handleAffiliateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateAffiliateSelection(event.target.value);
  };

  const handleRangeChange = (preset: RangePreset) => {
    setRangePreset(preset);
    if (preset !== 'custom') {
      setCustomRange({ start: '', end: '' });
    }
  };

  const handleDownloadReport = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `affiliate-report-${new Date().toISOString().split('T')[0]}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleRecordPayout = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!highlightedAffiliate || !payoutForm.amount) {
      return;
    }
    setPayoutSubmitting(true);
    setPayoutError(null);
    setPayoutSuccess(null);
    try {
      const response = await fetch('/api/affiliate-management/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliateId: highlightedAffiliate.id,
          amount: Number(payoutForm.amount),
          reference: payoutForm.reference,
          memo: payoutForm.memo,
          status: payoutForm.status,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'تعذر تسجيل الدفعة');
      }
      setPayoutForm({ amount: '', reference: '', memo: '', status: 'PAID' });
      setPayoutSuccess('تم تسجيل الدفعة بنجاح');
      await fetchData();
      setTimeout(() => setPayoutSuccess(null), 4000);
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : 'تعذر تسجيل الدفعة');
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const highlightedAffiliate = useMemo(() => {
    if (!data || data.affiliates.length === 0) {
      return null;
    }
    if (selectedAffiliateId === 'all') {
      return [...data.affiliates].sort((a, b) => b.stats.netSales - a.stats.netSales)[0];
    }
    return data.affiliates.find((affiliate) => affiliate.id === selectedAffiliateId) ?? null;
  }, [data, selectedAffiliateId]);

  const filteredAffiliates = useMemo(() => {
    if (!data) return [];
    if (!searchTerm.trim()) {
      return data.affiliates;
    }
    const query = searchTerm.trim().toLowerCase();
    return data.affiliates.filter(
      (affiliate) =>
        affiliate.ownerName.toLowerCase().includes(query) ||
        affiliate.affiliateName.toLowerCase().includes(query) ||
        affiliate.userName.toLowerCase().includes(query)
    );
  }, [data, searchTerm]);

  const globalReports = useMemo(() => data?.reports.slice(0, 6) ?? [], [data]);
  const latestTransactions = highlightedAffiliate?.wallet.transactions.slice(0, 6) ?? [];
  const recentOrders = highlightedAffiliate?.latestOrders ?? [];
  const payoutLedger = highlightedAffiliate?.payouts ?? [];

  if (loading && !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <LoaderCircle className="h-10 w-10 text-indigo-500 animate-spin" />
        <p className="mt-4 text-gray-600">جاري تحميل لوحة إدارة المسوقين...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AppNavbar title="إدارة المسوقين" />
        <div className="max-w-3xl mx-auto p-6">
          <Card className="p-8 text-center">
            <p className="text-red-600 font-semibold mb-2">{error}</p>
            <Button onClick={fetchData}>إعادة المحاولة</Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      <AppNavbar title="إدارة المسوقين" subtitle="تقارير العمولات والمحافظ" />
      <main className="max-w-7xl mx-auto p-4 space-y-6">
        <Card className="p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">اختر المسوق</label>
                <Select value={selectedAffiliateId} onChange={handleAffiliateChange}>
                  <option value="all">كل المسوقين</option>
                  {(data?.affiliates ?? []).map((affiliate) => (
                    <option key={affiliate.id} value={affiliate.id}>
                      {affiliate.ownerName} — {affiliate.affiliateName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { key: '30', label: 'آخر ٣٠ يوماً' },
                  { key: '90', label: 'آخر ٩٠ يوماً' },
                  { key: 'all', label: 'منذ البداية' },
                  { key: 'custom', label: 'تاريخ مخصص' },
                ] as { key: RangePreset; label: string }[]).map((preset) => (
                  <Button
                    key={preset.key}
                    variant={rangePreset === preset.key ? 'default' : 'outline'}
                    onClick={() => handleRangeChange(preset.key)}
                    size="sm"
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
            {rangePreset === 'custom' && (
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex-1">
                  <label className="block text-sm text-gray-600 mb-1">من تاريخ</label>
                  <Input
                    type="date"
                    value={customRange.start}
                    onChange={(event) => setCustomRange((prev) => ({ ...prev, start: event.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-gray-600 mb-1">إلى تاريخ</label>
                  <Input
                    type="date"
                    value={customRange.end}
                    onChange={(event) => setCustomRange((prev) => ({ ...prev, end: event.target.value }))}
                  />
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="بحث سريع عن مسوق"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={fetchData} disabled={loading}>
                  <RefreshCw className="mr-2 h-4 w-4" /> تحديث
                </Button>
                <Button variant="secondary" onClick={handleDownloadReport}>
                  <Download className="mr-2 h-4 w-4" /> تنزيل التقرير
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {error && (
          <Card className="border border-red-200 bg-red-50/60 p-4">
            <p className="text-red-600 text-sm">{error}</p>
          </Card>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="p-4">
            <p className="text-sm text-gray-500">عدد المسوقين النشطين</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{data?.summary.activeAffiliates ?? 0}</p>
            <p className="text-xs text-gray-400">من أصل {data?.summary.totalAffiliates ?? 0}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">صافي المبيعات</p>
                <p className="mt-2 text-2xl font-bold">{formatCurrency(data?.summary.lifetimeNetSales ?? 0)}</p>
              </div>
              <BarChart3 className="h-8 w-8 text-indigo-500" />
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">العمولات المكتسبة</p>
                <p className="mt-2 text-2xl font-bold text-emerald-600">
                  {formatCurrency(data?.summary.deliveredCommission ?? 0)}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-emerald-500" />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {formatCurrency(data?.summary.pendingCommission ?? 0)} قيد التسوية
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-gray-500">متوسط نسبة العمولة</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {formatPercent(data?.summary.averageCommissionRate ?? 0)}
            </p>
            <p className="text-xs text-gray-400">بناءً على إعدادات المسوقين</p>
          </Card>
        </section>

        <Card className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="text-sm text-gray-500">نظرة سريعة</p>
              <h2 className="text-lg font-semibold">قائمة المسوقين والعمولات</h2>
            </div>
            <span className="text-xs text-gray-400">{filteredAffiliates.length} مسوق</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المسوق</TableHead>
                <TableHead>كود الحملة</TableHead>
                <TableHead>الطلبات</TableHead>
                <TableHead>صافي المبيعات</TableHead>
                <TableHead>العمولة المكتسبة</TableHead>
                <TableHead>الرصيد المتاح</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAffiliates.map((affiliate) => (
                <TableRow
                  key={affiliate.id}
                  className={selectedAffiliateId === affiliate.id ? 'bg-indigo-50/60' : ''}
                  onClick={() => updateAffiliateSelection(affiliate.id)}
                >
                  <TableCell>
                    <div className="font-semibold text-slate-900">{affiliate.ownerName}</div>
                    <p className="text-xs text-gray-500">{affiliate.email || affiliate.phone || affiliate.userName}</p>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium text-indigo-600">{affiliate.affiliateName}</span>
                    <p className="text-xs text-gray-400">{formatPercent(affiliate.commissionRate)}</p>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold">{affiliate.stats.totalOrders}</div>
                    <p className="text-xs text-gray-500">
                      {affiliate.stats.deliveredOrders} مكتمل / {affiliate.stats.pendingOrders} قيد التنفيذ
                    </p>
                  </TableCell>
                  <TableCell>{formatCurrency(affiliate.stats.netSales)}</TableCell>
                  <TableCell>{formatCurrency(affiliate.stats.commissionEarned)}</TableCell>
                  <TableCell>{formatCurrency(affiliate.wallet.availableBalance)}</TableCell>
                </TableRow>
              ))}
              {!filteredAffiliates.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-6 text-gray-500">
                    لا توجد بيانات مطابقة للبحث الحالي
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        {highlightedAffiliate && (
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2 p-5">
              <div className="flex flex-col gap-2 border-b pb-4 mb-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-gray-500">المسوق المحدد</span>
                  <h3 className="text-2xl font-bold text-slate-900">{highlightedAffiliate.ownerName}</h3>
                  <p className="text-sm text-gray-500">
                    كود: {highlightedAffiliate.affiliateName} • نسبة العمولة {formatPercent(highlightedAffiliate.commissionRate)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                  <span>تاريخ الإضافة: {DATE_FORMATTER.format(new Date(highlightedAffiliate.joinedAt))}</span>
                  <span>
                    آخر طلب: {highlightedAffiliate.stats.lastOrderDate ? DATE_FORMATTER.format(new Date(highlightedAffiliate.stats.lastOrderDate)) : '—'}
                  </span>
                  <span>معدل التحويل: {formatPercent(highlightedAffiliate.stats.conversionRate)}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-2xl border bg-slate-50/70 p-4">
                  <p className="text-sm text-gray-500">صافي المبيعات</p>
                  <p className="mt-2 text-xl font-semibold">{formatCurrency(highlightedAffiliate.stats.netSales)}</p>
                  <p className="text-xs text-gray-400">متوسط الطلب {formatCurrency(highlightedAffiliate.stats.averageOrderValue)}</p>
                </div>
                <div className="rounded-2xl border bg-emerald-50/70 p-4">
                  <p className="text-sm text-emerald-700">عمولات مكتسبة</p>
                  <p className="mt-2 text-xl font-semibold text-emerald-700">
                    {formatCurrency(highlightedAffiliate.stats.commissionEarned)}
                  </p>
                  <p className="text-xs text-emerald-600">
                    {formatCurrency(highlightedAffiliate.wallet.availableBalance)} متاح للدفع
                  </p>
                </div>
                <div className="rounded-2xl border bg-amber-50/80 p-4">
                  <p className="text-sm text-amber-700">قيد التسوية</p>
                  <p className="mt-2 text-xl font-semibold text-amber-700">
                    {formatCurrency(highlightedAffiliate.stats.commissionPending)}
                  </p>
                  <p className="text-xs text-amber-600">من {highlightedAffiliate.stats.pendingOrders} طلب</p>
                </div>
              </div>
              <div className="mt-6">
                <h4 className="text-sm font-semibold text-slate-800 mb-3">تصنيف الحالات</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {highlightedAffiliate.statusBreakdown.map((status) => (
                    <div key={status.key} className="rounded-xl border bg-white/80 p-3">
                      <p className="text-sm font-semibold text-slate-900">{status.label}</p>
                      <p className="text-xs text-gray-500">
                        {status.count} طلب — {formatCurrency(status.netAmount)}
                      </p>
                      <p className="text-xs text-indigo-600 mt-1">
                        {formatCurrency(status.commissionEarned)} عمولة مكتسبة
                      </p>
                    </div>
                  ))}
                  {!highlightedAffiliate.statusBreakdown.length && (
                    <p className="text-sm text-gray-500">لا تتوفر بيانات للحالات خلال الفترة المحددة</p>
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">محفظة العمولات</p>
                  <h3 className="text-xl font-semibold">{formatCurrency(highlightedAffiliate.wallet.availableBalance)}</h3>
                </div>
                <Wallet className="h-8 w-8 text-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border bg-white/80 p-3">
                  <p className="text-xs text-gray-500">مدفوع</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(highlightedAffiliate.wallet.totalPaid)}
                  </p>
                </div>
                <div className="rounded-xl border bg-white/80 p-3">
                  <p className="text-xs text-gray-500">قيد التسوية</p>
                  <p className="text-lg font-semibold text-slate-900">
                    {formatCurrency(highlightedAffiliate.wallet.pendingBalance)}
                  </p>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">حركة السجل</h4>
                <div className="space-y-2">
                  {latestTransactions.length === 0 && (
                    <p className="text-sm text-gray-500">لا توجد معاملات خلال الفترة المحددة</p>
                  )}
                  {latestTransactions.map((transaction) => (
                    <div key={transaction.id} className="flex items-center justify-between rounded-xl border bg-slate-50/80 px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{transaction.label}</p>
                        <p className="text-xs text-gray-500">
                          {DATE_FORMATTER.format(new Date(transaction.date))} • {transaction.orders} طلب
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm font-semibold ${
                            transaction.type === 'payout' ? 'text-emerald-600' : 'text-indigo-600'
                          }`}
                        >
                          {formatCurrency(transaction.amount, transaction.currency)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {transaction.status === 'paid'
                            ? 'تم السداد'
                            : transaction.status === 'ready'
                            ? 'جاهز للدفع'
                            : 'قيد الانتظار'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <form onSubmit={handleRecordPayout} className="space-y-3 border-t border-slate-100 pt-3">
                <p className="text-sm font-semibold text-slate-800">تسجيل دفعة جديدة</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">المبلغ</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={payoutForm.amount}
                      onChange={(event) => setPayoutForm((prev) => ({ ...prev, amount: event.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">المرجع</label>
                    <Input
                      type="text"
                      value={payoutForm.reference}
                      onChange={(event) => setPayoutForm((prev) => ({ ...prev, reference: event.target.value }))}
                      placeholder="رقم التحويل أو وصف مختصر"
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">حالة الدفعة</label>
                    <Select
                      value={payoutForm.status}
                      onChange={(event) =>
                        setPayoutForm((prev) => ({ ...prev, status: event.target.value as 'PENDING' | 'APPROVED' | 'PAID' }))
                      }
                    >
                      <option value="PAID">تم الدفع</option>
                      <option value="APPROVED">جاهز للصرف</option>
                      <option value="PENDING">قيد المراجعة</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">ملاحظات</label>
                    <textarea
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      rows={2}
                      value={payoutForm.memo}
                      onChange={(event) => setPayoutForm((prev) => ({ ...prev, memo: event.target.value }))}
                      placeholder="تفاصيل إضافية (اختياري)"
                    />
                  </div>
                </div>
                {payoutError && <p className="text-xs text-red-600">{payoutError}</p>}
                {payoutSuccess && <p className="text-xs text-emerald-600">{payoutSuccess}</p>}
                <Button type="submit" disabled={payoutSubmitting || !payoutForm.amount}>
                  {payoutSubmitting ? 'جاري التسجيل...' : 'تسجيل الدفعة'}
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={handleDownloadReport}>
                  <ArrowDownToLine className="mr-2 h-4 w-4" /> تصدير بيانات المحفظة
                </Button>
              </form>
            </Card>
          </section>
        )}

        {payoutLedger.length > 0 && (
          <Card className="p-5">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">سجل الدفعات</h3>
                <p className="text-sm text-gray-500">عرض جميع الدفعات المسجلة للمسوق المحدد</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>المرجع</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المسؤول</TableHead>
                    <TableHead>تاريخ الصرف</TableHead>
                    <TableHead>الفترة المغطاة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payoutLedger.map((payout) => (
                    <TableRow key={payout.id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{payout.reference || '—'}</div>
                        <p className="text-xs text-gray-500">{payout.memo || 'بدون ملاحظات'}</p>
                      </TableCell>
                      <TableCell>{formatCurrency(payout.amount, payout.currency)}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${
                            payoutStatusStyles[payout.status]
                          }`}
                        >
                          {payoutStatusLabels[payout.status]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900">{payout.recordedBy?.name || '—'}</div>
                        <p className="text-xs text-gray-500">{payout.recordedBy?.username || ''}</p>
                      </TableCell>
                      <TableCell>{formatDate(payout.paidAt || payout.createdAt)}</TableCell>
                      <TableCell>
                        {payout.periodStart || payout.periodEnd
                          ? `${formatDate(payout.periodStart)} – ${formatDate(payout.periodEnd)}`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        {highlightedAffiliate && (
          <Card className="p-5">
            <div className="flex flex-col gap-2 border-b pb-4 mb-4">
              <div className="flex items-center gap-2 text-slate-800">
                <ShieldCheck className="h-5 w-5 text-indigo-500" />
                <h3 className="text-lg font-semibold">تقارير شهرية للمسوق</h3>
              </div>
              <p className="text-sm text-gray-500">
                متابعة دورات الدفع شهرياً لمعرفة ما تم صرفه وما ينتظر التسوية
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>الشهر</TableHead>
                    <TableHead>الطلبات</TableHead>
                    <TableHead>صافي المبيعات</TableHead>
                    <TableHead>عمولة جاهزة</TableHead>
                    <TableHead>قيد التسوية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {highlightedAffiliate.monthlyReports.slice(0, 6).map((report) => (
                    <TableRow key={report.period}>
                      <TableCell>{report.label}</TableCell>
                      <TableCell>
                        {report.deliveredOrders} مكتمل / {report.totalOrders} الكل
                      </TableCell>
                      <TableCell>{formatCurrency(report.netSales)}</TableCell>
                      <TableCell>{formatCurrency(report.commissionEarned)}</TableCell>
                      <TableCell>{formatCurrency(report.commissionPending)}</TableCell>
                    </TableRow>
                  ))}
                  {highlightedAffiliate.monthlyReports.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-gray-500">
                        لا توجد بيانات شهرية لهذه الفترة
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        {recentOrders.length > 0 && (
          <Card className="p-5">
            <div className="flex items-center gap-2 text-slate-800 border-b pb-3 mb-4">
              <BarChart3 className="h-5 w-5 text-indigo-500" />
              <h3 className="text-lg font-semibold">الطلبات الأخيرة المرتبطة بالمسوق</h3>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الطلب</TableHead>
                    <TableHead>تاريخ الطلب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>صافي المبيعات</TableHead>
                    <TableHead>العمولة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{order.orderNumber || order.orderId}</div>
                        <p className="text-xs text-gray-500">#{order.id}</p>
                      </TableCell>
                      <TableCell>
                        {order.placedAt ? DATE_FORMATTER.format(new Date(order.placedAt)) : '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                            order.isDelivered
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {order.statusName || order.statusSlug || 'غير معروف'}
                        </span>
                      </TableCell>
                      <TableCell>{formatCurrency(order.netAmount, order.currency ?? CURRENCY)}</TableCell>
                      <TableCell>{formatCurrency(order.commissionAmount, order.currency ?? CURRENCY)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        {globalReports.length > 0 && (
          <Card className="p-5">
            <div className="flex items-center gap-2 text-slate-800 border-b pb-3 mb-4">
              <TrendingUp className="h-5 w-5 text-indigo-500" />
              <h3 className="text-lg font-semibold">تقرير ربع سنوي مجمع</h3>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>الشهر</TableHead>
                    <TableHead>إجمالي الطلبات</TableHead>
                    <TableHead>صافي المبيعات</TableHead>
                    <TableHead>عمولات مدفوعة</TableHead>
                    <TableHead>عمولات قيد الانتظار</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {globalReports.map((report) => (
                    <TableRow key={report.period}>
                      <TableCell>{report.label}</TableCell>
                      <TableCell>
                        {report.deliveredOrders} مكتمل / {report.totalOrders} إجمالي
                      </TableCell>
                      <TableCell>{formatCurrency(report.netSales)}</TableCell>
                      <TableCell>{formatCurrency(report.commissionEarned)}</TableCell>
                      <TableCell>{formatCurrency(report.commissionPending)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
