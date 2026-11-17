import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyReturnStatusToken } from '@/app/lib/returns/status-token';
import { applyExchangeOrderState } from '@/app/lib/returns/exchange-order-flow';
import { getExchangeOrderState } from '@/app/lib/salla-exchange-order';
import { typeLabel } from '@/app/lib/returns/status';
import { deriveStage, type ReturnStage } from '@/lib/returns/workflow';
import { getSallaOrder } from '@/app/lib/salla-api';
import { itemImage, type OrderItem } from '@/components/returns/flow/model';
import { AutoRefresh, CopyCode, formatMoney, HelpButton, ProdRow, STORE_URL, Timeline } from '@/components/returns/flow/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'مليحة · متابعة طلبك', robots: { index: false } };

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'بانتظار دفع الفرق',
  paid: 'تم الدفع',
  not_required: 'مغطى برصيد الاستبدال',
  expired: 'انتهت مهلة الدفع — حُوّل الرصيد إلى كوبون',
  cancelled: 'أُلغي طلب الاستبدال — حُوّل الرصيد إلى كوبون',
  failed: 'سيصلك الرصيد ككوبون',
};

const STEPS = ['إرسال الطلب', 'إعادة القطعة', 'فحص القطعة', 'إتمام الطلب'];

/**
 * Where the request sits on the four-step timeline, and the one wording used
 * both in the banner and for the current step, so the two never disagree.
 */
const STAGE_VIEW: Record<ReturnStage, { current: number; label: string }> = {
  awaiting_pickup: { current: 2, label: 'بانتظار إعادة القطعة' },
  in_transit: { current: 2, label: 'القطعة في الطريق إلينا' },
  received: { current: 3, label: 'قيد فحص القطعة' },
  ready: { current: 4, label: 'بانتظار إتمام الطلب' },
  processing: { current: 4, label: 'بانتظار إتمام الطلب' },
  needs_attention: { current: 4, label: 'بانتظار إتمام الطلب' },
  completed: { current: 5, label: 'مكتمل' },
  closed: { current: 0, label: 'مغلق' },
};

/** Product images by product id, read from the Salla order (not stored on the request). */
async function loadItemImages(merchantId: string, orderId: string): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  try {
    const order = await getSallaOrder(merchantId, orderId);
    for (const item of (order?.items ?? []) as unknown as OrderItem[]) {
      const productId = String(item.product?.id ?? item.product_id ?? item.productId ?? '');
      const src = itemImage(item);
      if (productId && src && !images.has(productId)) images.set(productId, src);
    }
  } catch {
    // Images are decoration; the page works without them.
  }
  return images;
}

/** Customer status page, linked from WhatsApp and the returns flow with a signed token. */
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

  const images = await loadItemImages(request.merchantId, request.orderId);
  const stage = deriveStage(request);
  const view = STAGE_VIEW[stage];
  const currency = request.currency;
  const showOrder = Boolean(request.exchangeOrderId && request.exchangeLines.length > 0);
  const rejected = request.status === 'rejected';
  const cancelled = request.status === 'cancelled';
  const completed = stage === 'completed';
  const refunded = request.refundStatus === 'refunded' && Number(request.refundedAmount) > 0;

  const header = (title: string, lead: string, statusLabel: string) => (
    <>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      <div className="banner">
        <div className="row" style={{ margin: 0 }}>
          <span>نوع الطلب</span>
          <span className="v">طلب {typeLabel(request.type)}</span>
        </div>
        <div className="row" style={{ margin: 0 }}>
          <span>رقم الطلب الأصلي</span>
          <span className="v">{request.orderNumber}</span>
        </div>
        <div className="row" style={{ margin: 0 }}>
          <span>الحالة الحالية</span>
          <span className="v" style={{ color: 'var(--brand)' }}>
            {statusLabel}
          </span>
        </div>
      </div>
    </>
  );

  const pieces = (title: string) => (
    <div className="card">
      <div className="sect brand">{title}</div>
      {request.items.map((item) => (
        <div key={item.id} style={{ marginBottom: 10 }}>
          <ProdRow
            name={item.productName}
            imageUrl={images.get(item.productId) ?? null}
            details={[item.variantName, item.type === 'exchange' ? 'استبدال' : 'استرجاع'].filter(Boolean).join(' · ')}
          />
        </div>
      ))}
    </div>
  );

  const exchangeOrderCard = showOrder && (
    <div className="card calc">
      <div className="ttl">
        طلب الاستبدال #{request.exchangeOrderNumber}
        <span className="tiny" style={{ marginInlineStart: 8 }}>
          {PAYMENT_LABELS[request.exchangePaymentStatus] || ''}
        </span>
      </div>
      {request.exchangeLines.map((line) => (
        <div key={line.id} className="crow">
          <span>
            {line.name}
            <small>
              {[line.variantName, line.quantity > 1 ? `الكمية: ${line.quantity}` : ''].filter(Boolean).join(' · ')}
            </small>
          </span>
          <span className="v">{formatMoney(Number(line.unitPrice) * line.quantity, currency)}</span>
        </div>
      ))}
      <div className="crow">
        <span>من رصيد الاستبدال</span>
        <span className="v">−{formatMoney(request.exchangeCreditApplied, currency)}</span>
      </div>
      <div className={`ctot ${Number(request.exchangeAmountDue) > 0 && request.exchangePaymentStatus === 'pending' ? 'due' : ''}`}>
        <span>فرق السعر</span>
        <span className="v">{formatMoney(request.exchangeAmountDue, currency)}</span>
      </div>
      {request.exchangePaymentStatus === 'pending' && request.exchangeCheckoutUrl && (
        <a className="btn" style={{ marginTop: 12 }} href={request.exchangeCheckoutUrl}>
          إكمال دفع الفرق ({formatMoney(request.exchangeAmountDue, currency)})
        </a>
      )}
      {request.exchangePaymentStatus === 'pending' && request.exchangePaymentDueAt && (
        <div className="tiny" style={{ marginTop: 8 }}>
          يُلغى طلب الاستبدال تلقائيًا إذا لم يكتمل الدفع قبل{' '}
          {new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(request.exchangePaymentDueAt)}، ويصلك
          رصيدك ككوبون.
        </div>
      )}
      {['paid', 'not_required'].includes(request.exchangePaymentStatus) && !completed && (
        <div className="tiny" style={{ marginTop: 8 }}>
          يُشحن طلبك الجديد مجانًا بعد وصول القطعة المرتجعة وفحصها.
        </div>
      )}
    </div>
  );

  /* ---------- 27: not accepted after inspection ---------- */
  if (rejected) {
    return (
      <div className="pad">
        {header('لم تُقبل القطعة بعد الفحص', 'راجعي نتيجة الفحص وخيارات التواصل معنا.', 'لم يُقبل بعد الفحص')}
        {pieces(request.items.length > 1 ? 'القطع التي تمت مراجعتها' : 'القطعة التي تمت مراجعتها')}
        <div className="banner">
          <b>لم تستوفِ القطعة شروط الإرجاع والاستبدال</b>
          <p>لا يُقبل الاستبدال أو الاسترجاع في حال إزالة شريط الحماية أو استخدام القطعة.</p>
        </div>
        <div className="card">
          <div className="sect">تعتقدين أن هناك خطأً؟</div>
          <p className="lead" style={{ margin: '8px 0' }}>
            يمكنك طلب مراجعة نتيجة الفحص والتواصل معنا لمعرفة الخطوة التالية بخصوص القطعة.
          </p>
          <p className="lead" style={{ margin: 0 }}>
            إذا كان هناك مبلغ مدفوع، تواصلي معنا لمراجعة معالجته.
          </p>
        </div>
        <HelpButton className="btn" label="طلب مراجعة النتيجة" orderNumber={request.orderNumber} />
        <a className="btn ghost" href={STORE_URL}>
          العودة إلى المتجر
        </a>
      </div>
    );
  }

  /* ---------- cancelled ---------- */
  if (cancelled) {
    return (
      <div className="pad">
        {header('تم إلغاء الطلب', 'أُلغي طلب الاستبدال أو الاسترجاع هذا.', 'ملغى')}
        {pieces(request.items.length > 1 ? 'القطع' : 'القطعة')}
        <div className="card">
          <div className="sect">هل تحتاجين مساعدة؟</div>
          <p className="lead" style={{ margin: '8px 0 0' }}>
            إن كان الإلغاء غير متوقع أو أردتِ تقديم طلب جديد، تواصلي معنا.
          </p>
        </div>
        <HelpButton className="btn" orderNumber={request.orderNumber} />
        <a className="btn ghost" href="/returns">
          تقديم طلب جديد
        </a>
      </div>
    );
  }

  /* ---------- 24-26: final results ---------- */
  if (completed) {
    const couponCode = request.couponCode || request.leftoverCouponCode;
    const couponValue = request.couponCode ? request.couponAmount : request.leftoverCouponAmount;
    const deliveredReplacement = showOrder && ['paid', 'not_required'].includes(request.exchangePaymentStatus);
    const title = refunded && !couponCode && !deliveredReplacement ? 'تم تنفيذ الاسترداد' : deliveredReplacement ? 'اكتمل الاستبدال' : couponCode ? 'كوبونك جاهز' : 'اكتمل طلبك';
    const lead =
      title === 'تم تنفيذ الاسترداد'
        ? 'اكتملت معالجة مبلغ الاسترجاع المعتمد.'
        : title === 'اكتمل الاستبدال'
          ? 'تم شحن القطعة البديلة وإغلاق طلب الاستبدال.'
          : title === 'كوبونك جاهز'
            ? 'تم قبول القطعة وإصدار كوبون الاستبدال.'
            : 'تمت معالجة طلبك بعد فحص القطعة.';
    return (
      <div className="pad">
        {header(title, lead, 'مكتمل')}
        {refunded && (
          <div className="card">
            <div className="tiny" style={{ fontSize: 14 }}>
              مبلغ الاسترداد المعتمد
            </div>
            <div className="big">{formatMoney(request.refundedAmount, currency)}</div>
            <div className="tiny">تم تنفيذ الاسترداد إلى وسيلة الدفع الأصلية بعد فحص القطعة واعتماد الطلب.</div>
          </div>
        )}
        {couponCode && (
          <div className="banner" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700 }}>رصيدك للتسوّق لاحقًا</div>
            {Number(couponValue) > 0 && <div className="big">{formatMoney(couponValue, currency)}</div>}
            <CopyCode code={couponCode} />
            <div className="tiny" style={{ marginTop: 8 }}>
              أُرسل الكوبون أيضًا عبر واتساب إلى رقم الجوال المرتبط بالطلب.
            </div>
          </div>
        )}
        {exchangeOrderCard}
        {pieces(request.items.length > 1 ? 'القطع' : 'القطعة')}
        {refunded && (
          <div className="tiny" style={{ marginBottom: 10 }}>
            إن لم يظهر المبلغ لديكِ، تواصلي معنا لمراجعة تفاصيل العملية.
          </div>
        )}
        <a className="btn" href={STORE_URL}>
          {couponCode ? 'تسوّقي الآن' : 'العودة إلى المتجر'}
        </a>
        <HelpButton orderNumber={request.orderNumber} />
      </div>
    );
  }

  /* ---------- 23: tracking ---------- */
  return (
    <div className="pad">
      {header('متابعة طلبك', 'ستظهر حالة كل مرحلة عند تحديث الطلب.', view.label)}
      <AutoRefresh seconds={60} />
      <Timeline names={STEPS} current={view.current} currentLabel={view.label} />
      {exchangeOrderCard}
      {pieces(request.items.length > 1 ? 'القطع المرتجعة' : 'القطعة المرتجعة')}
      {stage === 'awaiting_pickup' && (
        <div className="card">
          <div className="sect">إرشادات إعادة القطعة</div>
          <p className="lead" style={{ margin: '8px 0' }}>
            ١. أبقي شريط الحماية في مكانه.
            <br />
            ٢. غلّفي القطعة وملحقاتها بشكل آمن.
            <br />
            ٣. سيتواصل معكِ مندوب شركة الشحن خلال يومين لاستلام الشحنة، وإن لم يتواصل سلّميها لأقرب فرع خلال 3 أيام.
          </p>
          {request.smsaTrackingNumber && (
            <div className="row">
              <span className="k">رقم تتبع شحنة الإرجاع</span>
              <span className="v" style={{ direction: 'ltr' }}>
                {request.smsaTrackingNumber}
              </span>
            </div>
          )}
          <div style={{ color: 'var(--brand)', fontWeight: 700, fontSize: 13 }}>
            في حال التأخر عن تسليم الشحنة يُلغى طلب الاستبدال أو الاسترجاع.
          </div>
        </div>
      )}
      {stage !== 'awaiting_pickup' && request.smsaTrackingNumber && (
        <div className="card">
          <div className="row" style={{ margin: 0 }}>
            <span className="k">رقم تتبع شحنة الإرجاع</span>
            <span className="v" style={{ direction: 'ltr' }}>
              {request.smsaTrackingNumber}
            </span>
          </div>
        </div>
      )}
      <a className="btn" href="">
        تحديث حالة الطلب
      </a>
      <HelpButton orderNumber={request.orderNumber} />
    </div>
  );
}
