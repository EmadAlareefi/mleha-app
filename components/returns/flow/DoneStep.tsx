'use client';

import { useEffect, useState } from 'react';
import { formatMoney, STORE_URL, Timeline } from './ui';

// Salla issues the return waybill asynchronously, so poll until it is ready.
const TRACKING_POLL_INTERVAL_MS = 2000;
const TRACKING_MAX_WAIT_MS = 2 * 60 * 1000;

export interface CreatedReturn {
  id: string;
  orderNumber: string;
  type: 'return' | 'exchange' | 'mixed';
  status: string;
  smsaTrackingNumber?: string;
  smsaLabelDataUrl?: string | null;
  totalRefundAmount?: number;
  refundAmount?: number;
  couponAmount?: number;
  currency?: string;
  statusUrl?: string | null;
  exchangeOrder?: {
    created: boolean;
    orderNumber?: string;
    amountDue?: number;
    paymentUrl?: string | null;
    leftover?: number;
    fellBackToCoupon?: boolean;
  } | null;
  createdAt: string;
}

/* ---------------- 22: confirmation ---------------- */

export function DoneStep({ request }: { request: CreatedReturn }) {
  const [trackingNumber, setTrackingNumber] = useState(request.smsaTrackingNumber);
  const [waiting, setWaiting] = useState(!request.smsaTrackingNumber);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const response = await fetch(`/api/returns/tracking-status?returnRequestId=${encodeURIComponent(request.id)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data?.ready && data.trackingNumber) {
          setTrackingNumber(data.trackingNumber);
          setWaiting(false);
        } else if (!cancelled && data?.stuck) {
          // Late: say so plainly; the status page keeps checking.
          setTimedOut(true);
          setWaiting(false);
        }
      } catch {
        // Transient error — keep polling.
      }
    };
    void poll();
    const interval = setInterval(() => {
      if (Date.now() - startedAt >= TRACKING_MAX_WAIT_MS) {
        if (!cancelled) {
          setTimedOut(true);
          setWaiting(false);
        }
        return;
      }
      void poll();
    }, TRACKING_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [waiting, request.id]);

  const currency = request.currency;
  const refund = request.refundAmount ?? (request.type === 'return' ? request.totalRefundAmount : undefined);
  const exchangeOrder = request.exchangeOrder;
  const coupon = exchangeOrder?.created ? 0 : request.couponAmount;

  return (
    <div className="pad">
      <h1>تم استلام طلبك</h1>
      <p className="lead">يمكنك متابعة الطلب ومعرفة التحديثات من هنا.</p>
      <div className="banner">
        <div className="row">
          <span>رقم الطلب الأصلي</span>
          <span className="v">{request.orderNumber}</span>
        </div>
        {exchangeOrder?.created && exchangeOrder.orderNumber && (
          <div className="row">
            <span>طلب الاستبدال الجديد</span>
            <span className="v">#{exchangeOrder.orderNumber}</span>
          </div>
        )}
        <div style={{ color: 'var(--brand)', fontWeight: 700, fontSize: 14 }}>تم الإرسال بنجاح</div>
      </div>

      <Timeline names={['مراجعة الطلب', 'إعادة القطعة', 'الفحص وإتمام الطلب']} current={1} />

      {(Number(refund) > 0 || Number(coupon) > 0 || exchangeOrder?.created) && (
        <div className="card calc">
          <div className="ttl">المبالغ المتوقعة</div>
          {Number(refund) > 0 && (
            <div className="crow">
              <span>
                المبلغ المسترد<small>يُرد لوسيلة الدفع الأصلية بعد فحص القطعة</small>
              </span>
              <span className="v">{formatMoney(refund, currency)}</span>
            </div>
          )}
          {Number(coupon) > 0 && (
            <div className="crow">
              <span>
                رصيد الكوبون<small>يصلك عبر واتساب بعد فحص القطعة وقبولها</small>
              </span>
              <span className="v">{formatMoney(coupon, currency)}</span>
            </div>
          )}
          {exchangeOrder?.created && (
            <div className="crow">
              <span>
                القطعة البديلة<small>تُشحن لكِ مجانًا بعد وصول القطعة المرتجعة وفحصها</small>
              </span>
              <span className="v">#{exchangeOrder.orderNumber}</span>
            </div>
          )}
          {Number(exchangeOrder?.leftover) > 0 && (
            <div className="crow">
              <span>
                رصيد متبقٍ<small>يصلك ككوبون على واتساب بعد الفحص</small>
              </span>
              <span className="v">{formatMoney(exchangeOrder?.leftover, currency)}</span>
            </div>
          )}
        </div>
      )}
      {exchangeOrder?.fellBackToCoupon && (
        <div className="banner">
          <p>تعذر تجهيز طلب البدائل الآن، لذلك سيصلك رصيد الاستبدال ككوبون على واتساب بعد وصول القطع وفحصها.</p>
        </div>
      )}

      <div className="card">
        <div className="sect">ماذا عليكِ الآن؟</div>
        <p className="lead" style={{ margin: '8px 0' }}>
          ١. أبقي شريط الحماية في مكانه.
          <br />
          ٢. غلّفي القطعة وملحقاتها بشكل آمن.
          <br />
          ٣. سيتواصل معكِ مندوب شركة الشحن خلال يومين لاستلام الشحنة، وإن لم يتواصل سلّميها لأقرب فرع خلال 3 أيام.
        </p>
        <div style={{ color: 'var(--brand)', fontWeight: 700, fontSize: 13 }}>
          في حال التأخر عن تسليم الشحنة يُلغى طلب الاستبدال أو الاسترجاع.
        </div>
        <div className="hr" />
        {waiting && (
          <div className="tiny">
            <span className="spin" />
            جارٍ إصدار بوليصة الإرجاع، سيظهر رقم التتبع هنا خلال لحظات...
          </div>
        )}
        {trackingNumber && (
          <div className="row" style={{ margin: 0 }}>
            <span>رقم تتبع شحنة الإرجاع</span>
            <span className="v" style={{ direction: 'ltr' }}>
              {trackingNumber}
            </span>
          </div>
        )}
        {timedOut && !trackingNumber && (
          <div className="warn" role="status">
            تأخر إصدار بوليصة الإرجاع من شركة الشحن. طلبك محفوظ، وسنرسل لكِ رقم التتبع عبر واتساب فور إصداره، ويمكنك متابعته من صفحة
            متابعة الطلب. لا ترسلي القطعة قبل وصول رقم التتبع.
          </div>
        )}
        {request.smsaLabelDataUrl && (
          <>
            <div className="tiny" style={{ margin: '12px 0 8px' }}>
              ملصق شحنة الإرجاع (اختياري): اطبعيه وضعيه على الطرد قبل التسليم.
            </div>
            <iframe title="ملصق شحنة الإرجاع" src={request.smsaLabelDataUrl} className="label-frame" />
            <a className="btn ghost" href={request.smsaLabelDataUrl} download={`return-label-${trackingNumber || request.orderNumber}.pdf`}>
              تحميل الملصق
            </a>
          </>
        )}
      </div>

      {request.statusUrl && (
        <a className="btn" href={request.statusUrl}>
          متابعة حالة الطلب
        </a>
      )}
      <a className={`btn ${request.statusUrl ? 'ghost' : ''}`} href={STORE_URL}>
        العودة إلى المتجر
      </a>
      <div className="tiny" style={{ textAlign: 'center', marginTop: 14 }}>
        رقم المرجع عند التواصل معنا: <span style={{ direction: 'ltr', display: 'inline-block' }}>{request.id}</span>
      </div>
    </div>
  );
}
