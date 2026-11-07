import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyReturnStatusToken } from '@/app/lib/returns/status-token';
import { applyExchangeOrderState } from '@/app/lib/returns/exchange-order-flow';
import { getExchangeOrderState } from '@/app/lib/salla-exchange-order';
import { typeLabel } from '@/app/lib/returns/status';
import { deriveStage, STAGE_LABELS } from '@/lib/returns/workflow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'متابعة طلب الإرجاع', robots: { index: false } };

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'بانتظار دفع الفرق',
  paid: 'تم الدفع',
  not_required: 'مغطى برصيد الاستبدال',
  expired: 'انتهت مهلة الدفع — حُوّل الرصيد إلى كوبون',
  cancelled: 'أُلغي طلب الاستبدال — حُوّل الرصيد إلى كوبون',
  failed: 'سيصلك الرصيد ككوبون',
};

const money = (value: unknown, currency = 'SAR') =>
  `${(Number(value) || 0).toFixed(2)} ${currency === 'SAR' ? 'ر.س' : currency}`;

/** Customer status page, linked from WhatsApp with a signed token. */
export default async function ReturnStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  if (!verifyReturnStatusToken(id, t)) notFound();

  let request = await prisma.returnRequest.findUnique({ where: { id }, include: { items: true, exchangeLines: true } });
  if (!request) notFound();

  // Coming back from the payment page: refresh the payment state right away.
  if (request.exchangeMode === 'order' && request.exchangePaymentStatus === 'pending' && request.exchangeOrderId) {
    try {
      const state = await getExchangeOrderState(request.merchantId, request.exchangeOrderId);
      if ((await applyExchangeOrderState(request, state)) !== 'unchanged') {
        request = (await prisma.returnRequest.findUnique({ where: { id }, include: { items: true, exchangeLines: true } }))!;
      }
    } catch {
      // Showing the last known state is fine.
    }
  }

  const stage = deriveStage(request);
  const currency = request.currency;
  const showOrder = request.exchangeOrderId && request.exchangeLines.length > 0;

  return (
    <main dir="rtl" className="mx-auto min-h-screen max-w-xl space-y-4 bg-gray-50 p-4">
      <header className="rounded-xl bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-500">طلب {typeLabel(request.type)}</p>
        <h1 className="text-xl font-bold">طلب رقم #{request.orderNumber}</h1>
        <p className="mt-2 inline-block rounded-full bg-gray-100 px-3 py-1 text-sm">{STAGE_LABELS[stage]}</p>
      </header>

      {showOrder && (
        <section className="space-y-3 rounded-xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">طلب الاستبدال #{request.exchangeOrderNumber}</h2>
            <span className="text-sm text-gray-600">{PAYMENT_LABELS[request.exchangePaymentStatus] || ''}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {request.exchangeLines.map((line) => (
              <li key={line.id} className="flex justify-between gap-2">
                <span>
                  {line.name}
                  {line.variantName ? ` · ${line.variantName}` : ''} × {line.quantity}
                </span>
                <span>{money(Number(line.unitPrice) * line.quantity, currency)}</span>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t pt-2 text-sm">
            <div className="flex justify-between">
              <span>من رصيد الاستبدال</span>
              <span>-{money(request.exchangeCreditApplied, currency)}</span>
            </div>
            {Number(request.exchangeAmountDue) > 0 && (
              <div className="flex justify-between font-semibold">
                <span>الفرق</span>
                <span>{money(request.exchangeAmountDue, currency)}</span>
              </div>
            )}
          </div>
          {request.exchangePaymentStatus === 'pending' && request.exchangeCheckoutUrl && (
            <a
              href={request.exchangeCheckoutUrl}
              className="block rounded-lg bg-gray-900 py-3 text-center font-semibold text-white"
            >
              إكمال دفع الفرق ({money(request.exchangeAmountDue, currency)})
            </a>
          )}
          {request.exchangePaymentStatus === 'pending' && request.exchangePaymentDueAt && (
            <p className="text-xs text-gray-500">
              يُلغى طلب الاستبدال تلقائياً إذا لم يكتمل الدفع قبل{' '}
              {new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(request.exchangePaymentDueAt)}
              ، ويصلك رصيدك ككوبون.
            </p>
          )}
          {['paid', 'not_required'].includes(request.exchangePaymentStatus) && (
            <p className="text-xs text-gray-600">يُشحن طلبك الجديد بعد وصول القطعة المرتجعة وفحصها.</p>
          )}
        </section>
      )}

      <section className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="mb-2 font-semibold">القطع المرتجعة</h2>
        <ul className="space-y-1 text-sm">
          {request.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span>
                {item.productName}
                {item.variantName ? ` · ${item.variantName}` : ''}
              </span>
              <span className="text-gray-500">{item.type === 'exchange' ? 'استبدال' : 'استرجاع'}</span>
            </li>
          ))}
        </ul>
        {request.refundStatus === 'refunded' && (
          <p className="mt-3 rounded-lg bg-green-50 p-2 text-sm text-green-800">
            تم استرجاع {money(request.refundedAmount, currency)} لوسيلة الدفع.
          </p>
        )}
        {request.leftoverCouponCode && (
          <p className="mt-3 rounded-lg bg-green-50 p-2 text-sm text-green-800">
            كوبون رصيدك المتبقي: <span className="font-mono font-semibold">{request.leftoverCouponCode}</span>
          </p>
        )}
        {request.couponCode && (
          <p className="mt-3 rounded-lg bg-green-50 p-2 text-sm text-green-800">
            كوبون الاستبدال: <span className="font-mono font-semibold">{request.couponCode}</span>
          </p>
        )}
      </section>
    </main>
  );
}
