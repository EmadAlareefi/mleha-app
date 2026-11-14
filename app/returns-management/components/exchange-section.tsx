'use client';

import Image from 'next/image';
import { Check, CircleDashed, ExternalLink, Loader2, PackagePlus, Send, Ticket, TicketX, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { summarizeRequestMoney } from '@/lib/returns/money-summary';
import { cn } from '@/lib/utils';
import type { RequestActions } from './use-request-actions';
import { describeCouponNotification, formatDateTime, formatMoney, toNumber, type ReturnRequest } from './types';

type StepState = 'done' | 'current' | 'failed' | 'todo';

function Step({ state, title, detail }: { state: StepState; title: string; detail?: string | null }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        className={cn(
          'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 bg-card',
          state === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
          state === 'current' && 'border-amber-500 text-amber-600',
          state === 'failed' && 'border-red-500 bg-red-500 text-white',
          state === 'todo' && 'border-border text-muted-foreground',
        )}
        aria-hidden
      >
        {state === 'done' ? <Check className="size-4" /> : state === 'failed' ? <X className="size-4" /> : <CircleDashed className="size-3.5" />}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={cn('text-sm', state === 'todo' ? 'text-muted-foreground' : 'font-medium')}>{title}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

const sallaOrderUrl = (orderId: string) => `https://s.salla.sa/orders/order/${orderId}`;

export function ExchangeSection({ request, actions }: { request: ReturnRequest; actions: RequestActions }) {
  const money = summarizeRequestMoney(request);
  const currency = money.currency;
  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status);
  const lines = request.exchangeLines ?? [];
  const orderMode = request.exchangeMode === 'order' && Boolean(request.exchangeOrderId);
  const payment = request.exchangePaymentStatus || 'none';
  const busy = actions.busy !== null;

  if (!money.hasExchange && !orderMode && lines.length === 0) return null;

  // ---- Replacement order the app created ----------------------------------
  if (orderMode) {
    const exchangePieces = request.items.filter((item) => item.type === 'exchange');
    const inspected = exchangePieces.length > 0 && exchangePieces.every((item) => item.conditionStatus);
    const passed = inspected && exchangePieces.every((item) => item.conditionStatus === 'good');
    const failed = exchangePieces.some((item) => item.conditionStatus && item.conditionStatus !== 'good');
    const gone = payment === 'expired' || payment === 'cancelled' || payment === 'failed';
    const released = Boolean(request.exchangeOrderReleasedAt);
    const active = ['pending', 'paid', 'not_required'].includes(payment);

    const paymentStep: { state: StepState; title: string; detail?: string | null } =
      payment === 'pending'
        ? {
            state: 'current',
            title: `بانتظار دفع العميل: ${formatMoney(request.exchangeAmountDue, currency)}`,
            detail: request.exchangePaymentDueAt ? `المهلة حتى ${formatDateTime(request.exchangePaymentDueAt)}` : null,
          }
        : payment === 'paid'
          ? { state: 'done', title: `دفع العميل الفرق (${formatMoney(request.exchangeAmountDue, currency)})` }
          : payment === 'not_required'
            ? { state: 'done', title: 'مغطى برصيد الاستبدال، لا يوجد دفع' }
            : { state: 'failed', title: payment === 'expired' ? 'انتهت مهلة الدفع وأُلغي الطلب' : 'أُلغي الطلب البديل' };

    return (
      <section aria-labelledby="replacement-title" className="space-y-3 rounded-xl border border-emerald-200 bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="replacement-title" className="flex items-center gap-2 font-semibold">
            الطلب البديل
            {request.exchangeOrderNumber && (
              <a
                href={sallaOrderUrl(request.exchangeOrderId!)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-normal text-primary hover:underline"
                dir="ltr"
              >
                #{request.exchangeOrderNumber} <ExternalLink className="size-3" />
              </a>
            )}
          </h3>
          {request.exchangeOrderHoldActive && <Badge className="bg-amber-100 text-amber-900">محجوز: تحت المراجعة حجز قطع</Badge>}
          {released && <Badge className="bg-emerald-100 text-emerald-800">طلب جديد — للتجهيز</Badge>}
        </div>

        <ol className="relative before:absolute before:inset-y-3 before:right-[13px] before:w-0.5 before:bg-border">
          <Step state="done" title="أُنشئ الطلب في سلة برصيد الاستبدال" detail={formatDateTime(request.exchangeOrderLinkedAt ?? null) || null} />
          <Step {...paymentStep} />
          {!gone && (
            <>
              <Step
                state={request.exchangeOrderHoldActive ? 'current' : released ? 'done' : 'todo'}
                title="محجوز حتى فحص القطعة المرتجعة"
                detail={request.exchangeOrderHoldActive ? 'الحالة في سلة: تحت المراجعة حجز قطع' : null}
              />
              <Step
                state={passed ? 'done' : failed ? 'failed' : 'todo'}
                title={passed ? 'القطعة المرتجعة سليمة' : failed ? 'القطعة المرتجعة ليست بحالة جيدة' : 'بانتظار فحص القطعة المرتجعة في المستودع'}
                detail={failed ? 'قرري: إرسال الطلب البديل رغم ذلك، أو إلغاؤه وتحويل الرصيد لكوبون.' : null}
              />
              <Step
                state={released ? 'done' : 'todo'}
                title="تحويل الطلب إلى «طلب جديد» ليُجهّز ويُشحن"
                detail={released ? formatDateTime(request.exchangeOrderReleasedAt ?? null) : null}
              />
            </>
          )}
        </ol>

        {request.exchangeOrderError && <p className="rounded-md bg-red-50 p-2 text-xs text-red-800">{request.exchangeOrderError}</p>}

        {lines.length > 0 && (
          <ul className="space-y-2">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center gap-3 rounded-lg bg-muted/50 p-2 text-sm">
                {line.imageUrl ? (
                  <Image src={line.imageUrl} alt="" width={40} height={40} className="size-10 rounded-md object-cover" unoptimized />
                ) : (
                  <span className="size-10 rounded-md bg-muted" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {line.name}
                  {line.variantName ? ` · ${line.variantName}` : ''} × {line.quantity}
                </span>
                <span className="tabular-nums text-muted-foreground">{formatMoney(Number(line.unitPrice) * line.quantity, currency)}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-sm">
          <dt className="text-muted-foreground">رصيد الاستبدال</dt>
          <dd className="text-left tabular-nums">{formatMoney(request.exchangeCreditAmount, currency)}</dd>
          <dt className="text-muted-foreground">مستخدم في الطلب</dt>
          <dd className="text-left tabular-nums">{formatMoney(request.exchangeCreditApplied, currency)}</dd>
          {toNumber(request.exchangeAmountDue) ? (
            <>
              <dt className="text-muted-foreground">الفرق{request.exchangePaymentMethod ? ` (${request.exchangePaymentMethod})` : ''}</dt>
              <dd className="text-left font-semibold tabular-nums">{formatMoney(request.exchangeAmountDue, currency)}</dd>
            </>
          ) : null}
          {toNumber(request.leftoverCouponAmount) ? (
            <>
              <dt className="text-muted-foreground">رصيد متبقٍ</dt>
              <dd className="text-left text-xs">
                {request.leftoverCouponCode
                  ? `${request.leftoverCouponCode} · ${formatMoney(request.leftoverCouponAmount, currency)}`
                  : `${formatMoney(request.leftoverCouponAmount, currency)} — كوبون عند المعالجة`}
              </dd>
            </>
          ) : null}
        </dl>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {payment === 'pending' && (
            <Button variant="outline" className="h-11 sm:h-8" size="sm" disabled={busy} onClick={() => actions.exchangeAction('resend_link')}>
              {actions.busy === 'exchange:resend_link' ? <Loader2 className="animate-spin" /> : <Send />}
              إعادة إرسال رابط الدفع
            </Button>
          )}
          {request.exchangeOrderHoldActive && (payment === 'paid' || payment === 'not_required') && (
            <Button size="sm" className="h-11 sm:h-8" disabled={busy} onClick={() => actions.exchangeAction('release')}>
              إرسال للتجهيز الآن
            </Button>
          )}
          {active && !closed && (
            <Button
              size="sm"
              variant="ghost"
              className="h-11 text-red-700 sm:h-8"
              disabled={busy}
              onClick={() => actions.exchangeAction('cancel')}
            >
              إلغاء الطلب البديل
            </Button>
          )}
          {gone && !closed && money.hasExchange && !request.couponCode && actions.exchangeOrdersEnabled && (
            <>
              {lines.length > 0 && (
                <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={busy} onClick={() => actions.exchangeAction('retry')}>
                  {actions.busy === 'exchange:retry' ? <Loader2 className="animate-spin" /> : null}
                  إعادة إنشاء نفس الطلب البديل
                </Button>
              )}
              <Button size="sm" className="h-11 sm:h-8" disabled={busy} onClick={() => actions.open('replacement')}>
                <PackagePlus /> طلب بديل بمنتجات أخرى
              </Button>
            </>
          )}
        </div>
      </section>
    );
  }

  // ---- Credit as a coupon (or not handed out yet) --------------------------
  const credit = money.credit;
  const customerUsedCoupon = request.exchangeMode !== 'order' && request.exchangeOrderId;
  const canHandOut = money.hasExchange && !closed && !request.couponCode && request.processingStatus !== 'processing';

  return (
    <section aria-labelledby="credit-title" className="space-y-3 rounded-xl border border-emerald-200 bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="credit-title" className="font-semibold">
          رصيد الاستبدال
        </h3>
        <span className="flex items-center gap-2">
          {credit?.overridden && <Badge className="bg-amber-100 text-amber-800">معدّل يدوياً</Badge>}
          <strong className="text-lg tabular-nums text-emerald-700">{formatMoney(credit?.amount ?? 0, currency)}</strong>
        </span>
      </div>

      {request.couponCode ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Ticket className="size-4 text-emerald-700" /> كوبون
          <code className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800" dir="ltr">
            {request.couponCode}
          </code>
          {customerUsedCoupon && (
            <a
              href={sallaOrderUrl(request.exchangeOrderId!)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              استخدمه العميل في الطلب #{request.exchangeOrderNumber || request.exchangeOrderId} <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      ) : (
        canHandOut && (
          <p className="text-sm text-muted-foreground">
            {actions.exchangeOrdersEnabled
              ? 'لم يُسلَّم الرصيد بعد: اختاري طلباً بديلاً بمنتجات يحددها العميل، أو كوبوناً يستخدمه بنفسه.'
              : 'لم يُسلَّم الرصيد بعد: أنشئي كوبون الاستبدال وأرسليه للعميل.'}
          </p>
        )
      )}

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {canHandOut && (
          <>
            {actions.exchangeOrdersEnabled && (
              <Button className="h-11 sm:h-9" disabled={actions.busy !== null} onClick={() => actions.open('replacement')}>
                <PackagePlus /> إنشاء طلب بديل وإرسال رابط الدفع
              </Button>
            )}
            <Button
              variant={actions.exchangeOrdersEnabled ? 'outline' : 'default'}
              className="h-11 sm:h-9"
              disabled={actions.busy !== null}
              onClick={actions.issueCoupon}
            >
              {actions.busy === 'create-coupon' ? <Loader2 className="animate-spin" /> : <Ticket />}
              إنشاء كوبون وإرساله
            </Button>
          </>
        )}
        {request.couponCode && (
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            disabled={actions.busy !== null}
            onClick={() =>
              void actions.run('resend-coupon', '/api/returns/resend-coupon', { returnRequestId: request.id }, (data) =>
                describeCouponNotification(data.notification, 'تم إرسال الكوبون للعميل على الواتساب.'),
              )
            }
          >
            {actions.busy === 'resend-coupon' ? <Loader2 className="animate-spin" /> : <Send />}
            إعادة إرسال الكوبون
          </Button>
        )}
        {money.hasExchange && (
          <Button variant="ghost" className="h-11 sm:h-9" onClick={() => actions.open('coupon-amount')}>
            تعديل قيمة الرصيد
          </Button>
        )}
        {request.couponCode && !customerUsedCoupon && !closed && (
          <Button variant="ghost" className="h-11 text-red-700 sm:h-9" onClick={() => actions.open('revoke-coupon')}>
            <TicketX /> إلغاء الكوبون (إن لم يُستخدم)
          </Button>
        )}
      </div>

      {actions.manualCoupon.open && !request.couponCode && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            تعذر إنشاء الكوبون تلقائياً (صلاحيات سلة). أنشئي كوبوناً
            {(credit?.amount ?? 0) > 0 ? ` بقيمة ${formatMoney(credit?.amount, currency)}` : ''} من لوحة سلة ثم أدخلي رمزه:
          </p>
          <div className="flex gap-2">
            <Input
              value={actions.manualCoupon.code}
              onChange={(event) => actions.manualCoupon.setCode(event.target.value)}
              placeholder="رمز الكوبون"
              className="h-11 sm:h-9"
              dir="ltr"
            />
            <Button
              className="h-11 sm:h-9"
              disabled={actions.busy !== null || !actions.manualCoupon.code.trim()}
              onClick={() => void actions.manualCoupon.submit()}
            >
              تسجيل وإرسال
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
