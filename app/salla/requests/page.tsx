import AppNavbar from '@/components/AppNavbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listQuantityRequests, type QuantityRequestRecord } from '@/app/lib/salla-product-requests';

export const revalidate = 0;

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

export default async function SallaRequestsPage() {
  const requests = await listQuantityRequests();
  const grouped = new Map<
    number,
    { productId: number; productName: string; productSku?: string | null; requests: QuantityRequestRecord[] }
  >();

  for (const request of requests) {
    if (!grouped.has(request.productId)) {
      grouped.set(request.productId, {
        productId: request.productId,
        productName: request.productName,
        productSku: request.productSku,
        requests: [] as QuantityRequestRecord[],
      });
    }
    grouped.get(request.productId)!.requests.push(request);
  }

  const groupedArray = Array.from(grouped.values()).map((group) => {
    const pending = group.requests.filter((req) => req.status === 'pending');
    const completed = group.requests.filter((req) => req.status === 'completed');
    return {
      ...group,
      pending,
      completed,
    };
  });

  groupedArray.sort((a, b) => b.pending.length - a.pending.length);

  const totalPending = groupedArray.reduce((sum, group) => sum + group.pending.length, 0);
  const totalCompleted = groupedArray.reduce((sum, group) => sum + group.completed.length, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50">
      <AppNavbar title="طلبات كميات سلة" subtitle="مراجعة طلبات الكميات عبر المنتجات" />
      <main className="max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8 space-y-6">
        <section className="grid gap-4 rounded-3xl border border-indigo-100 bg-white/90 p-6 shadow-lg shadow-indigo-100/60 sm:grid-cols-3">
          <div>
            <p className="text-sm text-slate-500">إجمالي الطلبات</p>
            <p className="text-3xl font-semibold text-slate-900">{formatNumber(requests.length)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">بانتظار التوفير</p>
            <p className="text-3xl font-semibold text-amber-600">{formatNumber(totalPending)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">مكتملة</p>
            <p className="text-3xl font-semibold text-emerald-600">{formatNumber(totalCompleted)}</p>
          </div>
        </section>

        {groupedArray.length === 0 ? (
          <Card className="rounded-3xl border border-slate-100 bg-white/90 p-6 text-center text-slate-500 shadow">
            لا توجد طلبات مسجلة حالياً.
          </Card>
        ) : (
          groupedArray.map((group) => (
            <Card key={group.productId} className="rounded-3xl border border-slate-100 bg-white/95 shadow">
              <CardHeader className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-xl text-slate-900">{group.productName}</CardTitle>
                  <CardDescription className="text-sm text-slate-500">
                    SKU: {group.productSku || '—'}
                  </CardDescription>
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
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">تاريخ الطلب</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">المطلوب من</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">الكمية</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">حالة الطلب</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">تاريخ التوريد</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-600">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.requests.map((request) => (
                        <tr key={request.id} className="text-slate-700">
                          <td className="px-3 py-2">{formatDate(request.requestedAt)}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{request.requestedFrom}</div>
                            <div className="text-xs text-slate-500">بواسطة {request.requestedBy}</div>
                          </td>
                          <td className="px-3 py-2">{formatNumber(request.requestedAmount)}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                                request.status === 'completed'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {request.status === 'completed' ? 'مكتمل' : 'بانتظار'}
                            </span>
                            {request.status === 'completed' && (
                              <div className="text-xs text-slate-500">
                                وفّر {request.providedBy} {formatNumber(request.providedAmount ?? null)} في{' '}
                                {formatDate(request.fulfilledAt)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {request.requestedFor ? formatDate(request.requestedFor) : '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {request.notes || <span className="text-slate-400">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
}
