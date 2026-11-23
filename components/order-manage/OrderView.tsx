'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  formatDate,
  formatMoney,
  supportLink,
  type ManageAction,
  type ManageChange,
  type ManageOrderResponse,
} from './types';

const ACTION_LABELS: Record<ManageAction, { title: string; hint: string }> = {
  cancel: { title: 'إلغاء الطلب', hint: 'إلغاء الطلب كاملاً واسترجاع المبلغ' },
  address: { title: 'تعديل العنوان', hint: 'تصحيح عنوان التوصيل أو بيانات المستلم' },
  swap: { title: 'تغيير المقاس أو اللون', hint: 'استبدال قطعة بمقاس أو لون آخر من نفس المنتج' },
  items: { title: 'إضافة أو حذف منتجات', hint: 'تعديل المنتجات أو الكميات في الطلب' },
};

const ACTION_ORDER: ManageAction[] = ['swap', 'address', 'items', 'cancel'];

const CHANGE_LABELS: Record<string, string> = {
  cancel: 'إلغاء الطلب',
  address: 'تعديل العنوان',
  swap: 'تغيير المقاس أو اللون',
  items: 'تعديل المنتجات',
};

function changeStatus(change: ManageChange): string {
  if (change.state === 'needs_staff') return 'قيد المراجعة من خدمة العملاء';
  if (change.state === 'failed') return 'لم يتم التعديل';
  if (change.state === 'awaiting_payment') return 'بانتظار الدفع';
  if (change.state !== 'completed') return 'قيد التنفيذ';
  const amount = change.refundAmount ? formatMoney(change.refundAmount, change.currency || 'SAR') : '';
  if (change.refundStatus === 'refunded') return `تم — استرجاع ${amount}`;
  if (['requested', 'manual', 'unknown', 'failed'].includes(change.refundStatus)) return 'تم — جاري معالجة استرجاع المبلغ';
  return 'تم';
}

export function OrderView({
  data,
  onRefresh,
  onSignOut,
}: {
  data: ManageOrderResponse;
  onRefresh: () => Promise<boolean>;
  onSignOut: () => void;
}) {
  const { order, actions } = data;
  const anyAllowed = ACTION_ORDER.some((action) => actions[action].allowed);
  // When nothing is possible every action carries the same reason: say it once.
  const sharedReason = !anyAllowed ? actions.cancel : null;
  // Actions that are switched off are not listed at all.
  const listed = ACTION_ORDER.filter((action) => {
    const verdict = actions[action];
    return verdict.allowed || verdict.code !== 'unavailable';
  });

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info' | 'error'; text: string } | null>(null);
  // One key per intent: a retry after a dropped connection must not cancel twice.
  const cancelKey = useRef<string | null>(null);

  const submitCancel = async () => {
    setConfirmCancel(false);
    setBusy(true);
    setNotice(null);
    cancelKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch('/api/public/order-manage/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: cancelKey.current }),
      });
      if (response.status === 401) return onSignOut();
      const outcome = (await response.json().catch(() => ({}))) as { status?: string; message?: string };
      if (outcome.status === 'completed') {
        setNotice({ tone: 'success', text: 'تم إلغاء طلبك. إذا كان الطلب مدفوعاً فسيُسترجع المبلغ إلى وسيلة الدفع نفسها.' });
      } else if (outcome.status === 'pending_review' || outcome.status === 'in_progress') {
        setNotice({ tone: 'info', text: outcome.message || 'طلبك قيد التنفيذ.' });
      } else {
        // Refused or failed with nothing changed: a new attempt is a new intent.
        cancelKey.current = null;
        setNotice({ tone: 'error', text: outcome.message || 'تعذر إلغاء الطلب. يرجى المحاولة مرة أخرى.' });
      }
      await onRefresh();
    } catch {
      // The key is kept: the request may have gone through.
      setNotice({ tone: 'error', text: 'تعذر الاتصال. تحققي من الإنترنت ثم اضغطي إلغاء الطلب مرة أخرى.' });
    } finally {
      setBusy(false);
    }
  };

  const noticeStyle = {
    success: 'border-green-200 bg-green-50 text-green-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    error: 'border-red-200 bg-red-50 text-red-800',
  } as const;

  return (
    <div className="space-y-4">
      {notice && (
        <div role="status" className={`rounded-lg border p-4 text-sm leading-relaxed ${noticeStyle[notice.tone]}`}>
          {notice.text}
        </div>
      )}

      <Card className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">طلب رقم {order.orderNumber}</h2>
            {order.placedAt && <p className="text-sm text-gray-500">{formatDate(order.placedAt)}</p>}
          </div>
          {order.statusName && <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-sm">{order.statusName}</span>}
        </div>
        <ul className="divide-y">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-3 py-3">
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- storefront CDN image, no optimisation needed
                <img src={item.image} alt="" className="size-16 shrink-0 rounded-lg border object-cover" loading="lazy" />
              ) : (
                <div className="size-16 shrink-0 rounded-lg border bg-gray-100" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">{item.name}</p>
                {item.options.length > 0 && (
                  <p className="text-sm text-gray-600">{item.options.map((option) => `${option.name}: ${option.value}`).join(' · ')}</p>
                )}
                <p className="text-sm text-gray-500">الكمية: {item.quantity}</p>
              </div>
              {item.total !== null && <p className="shrink-0 text-sm font-medium">{formatMoney(item.total, order.currency)}</p>}
            </li>
          ))}
        </ul>
        {order.total !== null && (
          <div className="flex items-center justify-between border-t pt-3 font-semibold">
            <span>الإجمالي</span>
            <span>{formatMoney(order.total, order.currency)}</span>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-bold">ماذا تريدين أن تفعلي؟</h2>
        {sharedReason && !sharedReason.allowed ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">{sharedReason.reason}</p>
            <Button asChild variant="outline" className="w-full py-6 text-base">
              <a href={supportLink(order.orderNumber, 'طلبي')} target="_blank" rel="noopener noreferrer">
                التواصل مع خدمة العملاء عبر واتساب
              </a>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {listed.map((action) => {
              const verdict = actions[action];
              const label = ACTION_LABELS[action];
              return (
                <li key={action} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{label.title}</p>
                      <p className="text-sm text-gray-600">{verdict.allowed ? label.hint : verdict.reason}</p>
                    </div>
                    {action === 'cancel' && verdict.allowed ? (
                      <Button
                        type="button"
                        variant="destructive"
                        className="min-h-11 shrink-0"
                        disabled={busy}
                        onClick={() => setConfirmCancel(true)}
                      >
                        {busy ? 'جاري الإلغاء...' : 'إلغاء الطلب'}
                      </Button>
                    ) : (
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs ${
                          verdict.allowed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {verdict.allowed ? 'قريباً' : 'غير متاح'}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {order.changes.length > 0 && (
        <Card className="space-y-2 p-5">
          <h2 className="font-bold">تعديلاتك السابقة</h2>
          <ul className="divide-y text-sm">
            {order.changes.map((change) => (
              <li key={change.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-medium">{CHANGE_LABELS[change.kind] || change.kind}</p>
                  <p className="text-gray-500">{formatDate(change.createdAt)}</p>
                </div>
                <p className="text-gray-700">{changeStatus(change)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmationDialog
        open={confirmCancel}
        title={`إلغاء الطلب رقم ${order.orderNumber}؟`}
        message="سيُلغى الطلب كاملاً ولا يمكن التراجع عن ذلك. إذا كان الطلب مدفوعاً فسيُسترجع المبلغ إلى وسيلة الدفع نفسها، وقد يستغرق ظهوره عدة أيام عمل حسب البنك."
        confirmLabel="نعم، إلغاء الطلب"
        cancelLabel="تراجع"
        confirmVariant="danger"
        onConfirm={() => void submitCancel()}
        onCancel={() => setConfirmCancel(false)}
      />

      <div className="flex items-center justify-between text-sm">
        <button type="button" className="min-h-11 text-gray-600 underline" onClick={() => void onRefresh()}>
          تحديث
        </button>
        <button type="button" className="min-h-11 text-gray-600 underline" onClick={onSignOut}>
          خروج
        </button>
      </div>
    </div>
  );
}
