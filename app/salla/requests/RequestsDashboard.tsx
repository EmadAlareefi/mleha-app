'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, RefreshCcw } from 'lucide-react';
import { EmptyState } from '@/components/dashboard/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import type { QuantityRequestRecord } from '@/app/lib/salla-product-requests';

type RequestsDashboardProps = {
  initialRequests: QuantityRequestRecord[];
};

type FulfillPayload = {
  providedBy: string;
  providedAmount: number;
};

type ActionResult =
  | { success: true; request: QuantityRequestRecord }
  | { success: false; error: string };

function formatDate(value?: string | Date | null) {
  if (!value) {
    return 'غير محدد';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export function RequestsDashboard({ initialRequests }: RequestsDashboardProps) {
  const [requests, setRequests] = useState<QuantityRequestRecord[]>(initialRequests);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'completed' | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const { data: session } = useSession();
  const fulfillmentUserName =
    (session?.user as any)?.name || session?.user?.email || 'مستخدم';

  useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      const matchesStatus =
        statusFilter === 'all' || request.status === statusFilter;
      if (!matchesStatus) {
        return false;
      }

      const query = searchQuery.trim().toLowerCase();
      if (!query) {
        return true;
      }

      const haystack = [request.productName, request.productSku]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [requests, statusFilter, searchQuery]);

  const groupedRequests = useMemo(() => {
    const grouped = new Map<
      number,
      {
        productId: number;
        productName: string;
        productSku?: string | null;
        requests: QuantityRequestRecord[];
        productImageUrl?: string | null;
      }
    >();

    filteredRequests.forEach((request) => {
      if (!grouped.has(request.productId)) {
        grouped.set(request.productId, {
          productId: request.productId,
          productName: request.productName,
          productSku: request.productSku,
          requests: [],
          productImageUrl: request.productImageUrl ?? null,
        });
      }
      const groupEntry = grouped.get(request.productId)!;
      if (!groupEntry.productImageUrl && request.productImageUrl) {
        groupEntry.productImageUrl = request.productImageUrl;
      }
      groupEntry.requests.push(request);
    });

    const groupedArray = Array.from(grouped.values()).map((group) => {
      const pending = group.requests.filter((req) => req.status === 'pending');
      const completed = group.requests.filter((req) => req.status === 'completed');
      return { ...group, pending, completed };
    });

    groupedArray.sort((a, b) => b.pending.length - a.pending.length);
    return groupedArray;
  }, [filteredRequests]);

  const totalPending = groupedRequests.reduce((sum, group) => sum + group.pending.length, 0);
  const totalCompleted = groupedRequests.reduce((sum, group) => sum + group.completed.length, 0);
  const totalRequests = filteredRequests.length;
  const totalRefundRequested = filteredRequests.reduce(
    (sum, request) => sum + (request.requestedRefundAmount ?? 0),
    0
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch('/api/salla/requests', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحديث قائمة الطلبات');
      }
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'تعذر تحديث قائمة الطلبات');
    } finally {
      setRefreshing(false);
    }
  };

  const handleFulfillRequest = async (
    requestId: string,
    payload: FulfillPayload
  ): Promise<ActionResult> => {
    try {
      const response = await fetch(`/api/salla/requests/${requestId}/fulfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحديث حالة الطلب');
      }
      const updated: QuantityRequestRecord = data.request;
      setRequests((prev) => prev.map((req) => (req.id === updated.id ? updated : req)));
      return { success: true, request: updated };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'تعذر تحديث حالة الطلب',
      };
    }
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'إجمالي الطلبات', value: formatNumber(totalRequests), className: 'text-foreground' },
          { label: 'بانتظار التوفير', value: formatNumber(totalPending), className: 'text-amber-600' },
          { label: 'مكتملة', value: formatNumber(totalCompleted), className: 'text-emerald-600' },
          { label: 'كمية المرتجع المطلوبة', value: formatNumber(totalRefundRequested), className: 'text-primary' },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className={`text-3xl font-semibold ${stat.className}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">متابعة طلبات الكميات</h2>
            <p className="text-sm text-slate-500">
              يتم عرض الطلبات بانتظار التوفير بشكل افتراضي، ويمكنك تعديل المرشحات أدناه.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="flex items-center gap-2 rounded-2xl"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCcw className="h-4 w-4" />
            {refreshing ? 'جاري التحديث...' : 'تحديث القائمة'}
          </Button>
        </div>
        {refreshError && (
          <Alert variant="destructive">
            <AlertDescription>تعذر تحديث القائمة: {refreshError}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-slate-600">حالة الطلب</span>
            <NativeSelect
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <NativeSelectOption value="pending">بانتظار</NativeSelectOption>
              <NativeSelectOption value="completed">مكتمل</NativeSelectOption>
              <NativeSelectOption value="all">الكل</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-col flex-1 min-w-[220px] gap-2">
            <label className="text-xs font-semibold text-slate-600" htmlFor="requests-search">
              بحث عن منتج أو SKU
            </label>
            <Input
              id="requests-search"
              placeholder="ابحث عن منتج..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="rounded-2xl"
            />
          </div>
        </div>
        </CardContent>
      </Card>

      {groupedRequests.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState title="لا توجد طلبات مسجلة حالياً" />
          </CardContent>
        </Card>
      ) : (
        groupedRequests.map((group) => (
          <Card key={group.productId}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {group.productImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={group.productImageUrl}
                      alt={group.productName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
                      لا صورة
                    </div>
                  )}
                </div>
                <div>
                  <CardTitle className="text-xl text-slate-900">{group.productName}</CardTitle>
                  <CardDescription className="text-sm text-slate-500">
                    SKU: {group.productSku || '—'}
                  </CardDescription>
                </div>
              </div>
              <div className="flex gap-4 text-sm">
                <div className="rounded-2xl bg-slate-50 px-4 py-2 text-slate-700">
                  الكل: <span className="font-semibold">{formatNumber(group.requests.length)}</span>
                </div>
                <div className="rounded-2xl bg-amber-50 px-4 py-2 text-amber-700">
                  بانتظار: <span className="font-semibold">{formatNumber(group.pending.length)}</span>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-4 py-2 text-emerald-700">
                  مكتملة: <span className="font-semibold">{formatNumber(group.completed.length)}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>تاريخ الطلب</TableHead>
                      <TableHead>أضيف بواسطة</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>كمية المرتجع</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>تاريخ التوريد</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      <TableHead>تحديث</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.requests.map((request) => (
                      <TableRow key={request.id} className="align-top">
                        <TableCell className="whitespace-nowrap">{formatDate(request.requestedAt)}</TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {request.requestedBy || 'مستخدم'}
                        </TableCell>
                        <TableCell>{formatNumber(request.requestedAmount)}</TableCell>
                        <TableCell>
                          {request.requestedRefundAmount
                            ? formatNumber(request.requestedRefundAmount)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={request.status === 'completed' ? 'default' : 'secondary'}>
                            {request.status === 'completed' ? 'مكتمل' : 'بانتظار'}
                          </Badge>
                          {request.status === 'completed' && (
                            <div className="mt-1 text-xs text-slate-500">
                              وفّر {request.providedBy} {formatNumber(request.providedAmount ?? null)} في{' '}
                              {formatDate(request.fulfilledAt)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {request.requestedFor ? formatDate(request.requestedFor) : '—'}
                        </TableCell>
                        <TableCell className="text-slate-500">
                          {request.notes || <span className="text-slate-400">—</span>}
                        </TableCell>
                        <TableCell>
                          {request.status === 'pending' ? (
                            <FulfillRequestForm
                              request={request}
                              fulfilledByName={fulfillmentUserName}
                              onSubmit={(payload) => handleFulfillRequest(request.id, payload)}
                            />
                          ) : (
                            <p className="text-xs text-emerald-600">تم التحديث</p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

type FulfillRequestFormProps = {
  request: QuantityRequestRecord;
  onSubmit: (payload: FulfillPayload) => Promise<ActionResult>;
  fulfilledByName: string;
};

function FulfillRequestForm({ request, onSubmit, fulfilledByName }: FulfillRequestFormProps) {
  const [providedAmount, setProvidedAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (request.status === 'completed') {
      setProvidedAmount('');
      setError(null);
      setSuccess(null);
    }
  }, [request.status]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number.parseInt(providedAmount, 10);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('يرجى إدخال الكمية الموفرة (أكبر من صفر).');
      return;
    }

    setLoading(true);
    const result = await onSubmit({ providedBy: fulfilledByName, providedAmount: amount });
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess('تم تحديث الطلب بنجاح.');
    setProvidedAmount('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-1">
      <Input
        placeholder="الكمية الموفرة"
        type="number"
        min={1}
        value={providedAmount}
        onChange={(event) => setProvidedAmount(event.target.value)}
      />
      <p className="text-[11px] text-slate-500">سيتم تسجيله باسم {fulfilledByName}</p>
      <Button
        type="submit"
        className="w-full text-sm flex items-center justify-center gap-2"
        disabled={loading}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        تحديث الطلب
      </Button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {success && <p className="text-[11px] text-emerald-600">{success}</p>}
    </form>
  );
}

export default RequestsDashboard;
