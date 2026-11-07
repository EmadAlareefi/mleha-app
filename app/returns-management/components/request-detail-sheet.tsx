'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink, Loader2, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import ShipmentTrackingSummary from '@/components/local-shipping/ShipmentTrackingSummary';
import { CONDITION_LABELS } from '@/app/lib/returns/inspection';
import { STATUS_LABELS, TYPE_COLORS, typeLabel } from '@/app/lib/returns/status';
import { RETURN_REASON_LABELS } from '@/lib/returns/reasons';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import { buildTrackingUrl } from '@/lib/tracking-url';
import { detectShipmentCompany, SHIPMENT_COMPANIES } from '@/lib/shipment-detector';
import { STAGE_LABELS } from '@/lib/returns/workflow';
import { STAGE_BADGE } from './request-row';
import {
  AUDIT_STEP_LABELS,
  EXCHANGE_PAYMENT_LABELS,
  formatDate,
  formatDateTime,
  formatMoney,
  pieceLabel,
  REFUND_STATUS_LABELS,
  RESTOCK_LABELS,
  toNumber,
  type ReturnRequest,
} from './types';

type Notify = (message: string, variant?: 'default' | 'destructive') => void;

interface RequestDetailSheetProps {
  request: ReturnRequest | null;
  onClose: () => void;
  onChanged: () => void;
  onProcess: (request: ReturnRequest) => void;
  onEditCoupon: (request: ReturnRequest) => void;
  onEditInspectorNotes: (request: ReturnRequest) => void;
  notify: Notify;
}

const LABEL_ACTIONS = {
  sync: 'تحديث من سلة',
  reissue: 'إعادة إصدار البوليصة',
  resend: 'إعادة إرسال الواتساب',
} as const;

const LABEL_SYNC_MESSAGES: Record<string, string> = {
  notified: 'تم العثور على البوليصة وإرسالها للعميل.',
  already_notified: 'البوليصة موجودة وسبق إرسالها للعميل.',
  tracking_only: 'تم تحديث رقم التتبع، لكن سلة لم تصدر البوليصة بعد.',
  pending: 'سلة ما زالت تُنشئ شحنة المرتجع. حاول بعد قليل.',
  stuck: 'لم تتوفر شحنة المرتجع بعد. افتح الطلب في سلة وتحقق من الشحنة.',
  error: 'تعذر الاتصال بسلة.',
};

type Confirm = { title: string; message: string; action: () => Promise<void>; danger?: boolean } | null;

export function RequestDetailSheet({
  request,
  onClose,
  onChanged,
  onProcess,
  onEditCoupon,
  onEditInspectorNotes,
  notify,
}: RequestDetailSheetProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [manualAmount, setManualAmount] = useState('');

  const call = async (key: string, url: string, body: unknown, success?: (data: any) => string) => {
    setBusy(key);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشل تنفيذ الإجراء');
      if (success) notify(success(data));
      onChanged();
      return data;
    } catch (err) {
      notify(err instanceof Error ? err.message : 'حدث خطأ', 'destructive');
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (!request) {
    return <Sheet open={false} onOpenChange={() => onClose()} />;
  }

  const currency = request.currency;
  const moneyMoved = (request.refundStatus && request.refundStatus !== 'none') || Boolean(request.couponCode);
  const closed = ['completed', 'cancelled', 'rejected'].includes(request.status);
  const canEditPieces = !moneyMoved && !closed && request.processingStatus !== 'processing';
  const hasReturn = request.items.some((item) => item.type !== 'exchange');
  const hasExchange = request.items.some((item) => item.type === 'exchange');
  const refundAmount = request.type === 'exchange' ? null : toNumber(request.totalRefundAmount);
  const couponAmount = request.type === 'exchange' ? toNumber(request.couponAmount ?? request.totalRefundAmount) : toNumber(request.couponAmount);

  const trackingNumber = request.smsaTrackingNumber?.trim() || request.smsaAwbNumber?.trim() || '';
  const provider = request.smsaResponse?.provider?.trim().toLowerCase();
  const detected = detectShipmentCompany(trackingNumber);
  const company = SHIPMENT_COMPANIES[provider || ''] || (detected.id !== 'unknown' ? detected : SHIPMENT_COMPANIES.smsa);
  const trackingLink = trackingNumber
    ? buildTrackingUrl(request.smsaAwbNumber || trackingNumber, company.id, request.smsaResponse?.labelUrl || request.returnLabelUrl)
    : null;
  const live = request.smsaLiveStatus;
  const audit = Array.isArray(request.processingAudit) ? [...request.processingAudit].reverse() : [];

  const exchangeAction = async (action: 'release' | 'cancel' | 'resend_link' | 'retry') => {
    await call(`exchange:${action}`, '/api/returns/exchange-order', { returnRequestId: request.id, action }, (data) => data.message || 'تم.');
  };

  const updatePiece = (itemId: string, patch: { type?: string; refundIncluded?: boolean }) =>
    call(`piece:${itemId}`, '/api/returns/update', { id: request.id, items: [{ id: itemId, ...patch }] });

  return (
    <>
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="left" dir="rtl" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <SheetHeader className="sticky top-0 z-10 border-b bg-white p-4 text-right">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="text-lg">طلب #{request.orderNumber}</SheetTitle>
              <Badge className={TYPE_COLORS[request.type] || TYPE_COLORS.return}>{typeLabel(request.type)}</Badge>
              <Badge className={STAGE_BADGE[request.stage]}>{STAGE_LABELS[request.stage]}</Badge>
            </div>
            <SheetDescription className="flex flex-wrap gap-x-3 gap-y-1">
              <span>{request.customerName}</span>
              <span dir="ltr">{request.customerPhone}</span>
              <span>{formatDate(request.createdAt)}</span>
              <a
                href={`https://s.salla.sa/orders/order/${request.orderId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
              >
                سلة <ExternalLink className="size-3" />
              </a>
              <Link href={`/returns-management/${request.id}`} className="text-indigo-600 hover:underline">
                الصفحة الكاملة
              </Link>
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 p-4">
            {/* Needs attention */}
            {request.stage === 'needs_attention' && (
              <section className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="whitespace-pre-line text-sm text-red-900">{request.processingError || 'يحتاج تدخل'}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onProcess(request)}>
                    <RotateCcw className="size-4" /> إعادة المحاولة
                  </Button>
                  {hasReturn && request.refundStatus !== 'refunded' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        call('salla-refund', '/api/returns/refund-manual', { returnRequestId: request.id, mode: 'salla' }, () =>
                          'تم العثور على الاسترجاع في سلة وتسجيله. اضغطي إعادة المحاولة لإكمال باقي الخطوات.',
                        )
                      }
                    >
                      تم الاسترجاع من لوحة سلة
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-700"
                    onClick={() =>
                      setConfirm({
                        title: 'إغلاق بدون معالجة',
                        message: 'سيُغلق الطلب دون استرجاع أو إرجاع للمخزون أو كوبون من النظام. استخدميه فقط إذا تمت المعالجة خارج النظام.',
                        danger: true,
                        action: async () => {
                          await call('close', '/api/returns/update', { id: request.id, status: 'completed' }, () => 'تم إغلاق الطلب.');
                        },
                      })
                    }
                  >
                    إغلاق بدون معالجة
                  </Button>
                </div>
                {hasReturn && request.refundStatus === 'manual' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-red-200 pt-3">
                    <span className="text-sm text-red-900">تحويل بنكي / يدوي:</span>
                    <Input
                      value={manualAmount}
                      onChange={(event) => setManualAmount(event.target.value)}
                      placeholder={refundAmount ? refundAmount.toFixed(2) : 'المبلغ'}
                      inputMode="decimal"
                      className="h-8 w-28 bg-white"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        call(
                          'manual-refund',
                          '/api/returns/refund-manual',
                          { returnRequestId: request.id, mode: 'manual', amount: manualAmount || refundAmount },
                          () => 'تم تسجيل الاسترجاع اليدوي. اضغطي إعادة المحاولة لإكمال باقي الخطوات.',
                        )
                      }
                    >
                      تأكيد التحويل
                    </Button>
                  </div>
                )}
              </section>
            )}

            {/* Pieces */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">القطع ({request.items.length})</h3>
                {request.items.some((item) => !item.conditionStatus) && !closed && (
                  <Button size="sm" variant="outline" onClick={() => onEditInspectorNotes(request)}>
                    ملاحظات للمفتش
                  </Button>
                )}
              </div>
              <div className="divide-y rounded-lg border">
                {request.items.map((item) => (
                  <div key={item.id} className="flex gap-3 p-3">
                    {item.damageImageData && (
                      <a href={item.damageImageData} target="_blank" rel="noreferrer" className="shrink-0">
                        <Image
                          src={item.damageImageData}
                          alt="صورة التلف"
                          width={56}
                          height={72}
                          unoptimized
                          className="h-[72px] w-14 rounded border border-red-200 object-cover"
                        />
                      </a>
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          {item.productName}
                          {item.variantName ? <span className="text-gray-500"> · {item.variantName}</span> : null}
                          {pieceLabel(item, request.items) ? (
                            <span className="mr-1 text-xs text-gray-400">({pieceLabel(item, request.items)})</span>
                          ) : null}
                        </p>
                        <span className="text-sm text-gray-600">{formatMoney(item.price, currency)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {canEditPieces ? (
                          <NativeSelect
                            aria-label="نوع القطعة"
                            value={item.type === 'exchange' ? 'exchange' : 'return'}
                            disabled={busy !== null}
                            onChange={(event) => updatePiece(item.id, { type: event.target.value })}
                            className="h-7 w-28 text-xs"
                          >
                            <option value="return">استرجاع</option>
                            <option value="exchange">استبدال</option>
                          </NativeSelect>
                        ) : (
                          <Badge className={item.type === 'exchange' ? TYPE_COLORS.exchange : TYPE_COLORS.return}>
                            {item.type === 'exchange' ? 'استبدال' : 'استرجاع'}
                          </Badge>
                        )}
                        <Badge variant="outline">
                          {item.conditionStatus ? CONDITION_LABELS[item.conditionStatus] : 'لم تُفحص'}
                        </Badge>
                        {item.restockStatus && item.restockStatus !== 'none' && (
                          <Badge variant="outline" className={item.restockStatus === 'failed' ? 'text-red-700' : ''}>
                            {RESTOCK_LABELS[item.restockStatus] || item.restockStatus}
                          </Badge>
                        )}
                        {item.type !== 'exchange' && (
                          <label className="mr-auto flex items-center gap-1.5 text-gray-600">
                            <Switch
                              checked={item.refundIncluded !== false}
                              disabled={!canEditPieces || busy !== null}
                              onCheckedChange={(checked) => updatePiece(item.id, { refundIncluded: checked })}
                              aria-label="مشمولة في الاسترجاع المالي"
                            />
                            مشمولة في الاسترجاع
                          </label>
                        )}
                      </div>
                      {item.conditionNotes?.trim() && (
                        <p className="whitespace-pre-wrap text-xs text-gray-700">ملاحظات الفحص: {item.conditionNotes}</p>
                      )}
                      {!item.conditionStatus && item.preInspectionNotes?.trim() && (
                        <p className="whitespace-pre-wrap text-xs text-amber-800">للمفتش: {item.preInspectionNotes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Exchange order (v3) */}
            {(request.exchangeOrderId || (request.exchangeLines?.length ?? 0) > 0) && (
              <section className="space-y-2 rounded-lg border border-green-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">
                    طلب الاستبدال
                    {request.exchangeOrderNumber ? (
                      <a
                        href={`https://s.salla.sa/orders/order/${request.exchangeOrderId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mr-2 inline-flex items-center gap-1 text-indigo-600 hover:underline"
                      >
                        #{request.exchangeOrderNumber} <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </h3>
                  <div className="flex gap-1.5">
                    <Badge variant="outline">{EXCHANGE_PAYMENT_LABELS[request.exchangePaymentStatus || 'none']}</Badge>
                    {request.exchangeOrderId && request.exchangeMode === 'order' && (
                      <Badge variant="outline">
                        {request.exchangeOrderHoldActive ? 'محجوز حتى الفحص' : request.exchangeOrderReleasedAt ? 'أُطلق للتجهيز' : 'غير محجوز'}
                      </Badge>
                    )}
                  </div>
                </div>
                <ul className="space-y-1">
                  {request.exchangeLines?.map((line) => (
                    <li key={line.id} className="flex justify-between gap-2 text-gray-700">
                      <span>
                        {line.name}
                        {line.variantName ? ` · ${line.variantName}` : ''} × {line.quantity}
                      </span>
                      <span>{formatMoney(Number(line.unitPrice) * line.quantity, currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-0.5 border-t pt-2">
                  <Row label="رصيد الاستبدال" value={formatMoney(request.exchangeCreditAmount, currency)} muted />
                  {request.exchangeOrderId && (
                    <Row label="مستخدم في الطلب" value={formatMoney(request.exchangeCreditApplied, currency)} muted />
                  )}
                  {toNumber(request.exchangeAmountDue) ? (
                    <Row
                      label={`الفرق${request.exchangePaymentMethod ? ` (${request.exchangePaymentMethod})` : ''}`}
                      value={<strong>{formatMoney(request.exchangeAmountDue, currency)}</strong>}
                    />
                  ) : null}
                  {toNumber(request.leftoverCouponAmount) ? (
                    <Row
                      label="رصيد متبقي (كوبون)"
                      value={request.leftoverCouponCode ? `${request.leftoverCouponCode} · ${formatMoney(request.leftoverCouponAmount, currency)}` : `${formatMoney(request.leftoverCouponAmount, currency)} — يصدر عند المعالجة`}
                    />
                  ) : null}
                  {request.exchangePaymentStatus === 'pending' && request.exchangePaymentDueAt && (
                    <p className="text-xs text-gray-500">مهلة الدفع حتى {formatDateTime(request.exchangePaymentDueAt)}</p>
                  )}
                  {request.exchangeOrderError && <p className="text-xs text-red-700">{request.exchangeOrderError}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.exchangePaymentStatus === 'pending' && (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => exchangeAction('resend_link')}>
                      إعادة إرسال رابط الدفع
                    </Button>
                  )}
                  {request.exchangeMode === 'order' && request.exchangeOrderHoldActive && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        setConfirm({
                          title: 'إرسال طلب الاستبدال الآن',
                          message: 'سيُطلق الطلب للتجهيز والشحن حتى لو لم يكتمل فحص القطعة المرتجعة أو كانت غير سليمة.',
                          action: () => exchangeAction('release'),
                        })
                      }
                    >
                      إرسال الطلب الآن
                    </Button>
                  )}
                  {request.exchangeMode === 'order' && request.exchangeOrderId && !closed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-700"
                      disabled={busy !== null}
                      onClick={() =>
                        setConfirm({
                          title: 'إلغاء طلب الاستبدال',
                          message: 'سيُلغى الطلب في سلة ويُعاد المخزون، ويُسترجع أي فرق دفعه العميل. يتحول الرصيد إلى كوبون عند المعالجة.',
                          danger: true,
                          action: () => exchangeAction('cancel'),
                        })
                      }
                    >
                      إلغاء البديل وتحويله لكوبون
                    </Button>
                  )}
                  {!request.exchangeOrderId && (request.exchangeLines?.length ?? 0) > 0 && !request.couponCode && !closed && (
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => exchangeAction('retry')}>
                      إعادة محاولة إنشاء طلب الاستبدال
                    </Button>
                  )}
                </div>
              </section>
            )}

            {/* Money */}
            <section className="space-y-2 rounded-lg border p-3 text-sm">
              <h3 className="font-semibold">المبالغ</h3>
              {toNumber(request.shippingAmount) ? (
                <Row label="شحن الطلب الأصلي" value={formatMoney(request.shippingAmount, currency)} />
              ) : null}
              <Row label="رسوم الشحن" value={`-${formatMoney(request.returnFee, currency)}`} muted />
              {hasReturn && (
                <Row
                  label="الاسترجاع المالي"
                  value={
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className={request.refundStatus === 'refunded' ? 'text-emerald-700' : ''}>
                        {REFUND_STATUS_LABELS[request.refundStatus || 'none']}
                      </Badge>
                      <strong className="text-blue-700">
                        {formatMoney(request.refundStatus === 'refunded' ? request.refundedAmount ?? refundAmount : refundAmount, currency)}
                      </strong>
                    </span>
                  }
                />
              )}
              {request.refundError && request.refundStatus !== 'refunded' && (
                <p className="text-xs text-red-700">{request.refundError}</p>
              )}
              {hasExchange && (
                <Row
                  label="كوبون الاستبدال"
                  value={
                    <span className="flex items-center gap-2">
                      {request.couponAmountOverride != null && <Badge className="bg-amber-100 text-amber-800">معدّل يدوياً</Badge>}
                      {request.couponCode && <code className="rounded bg-green-50 px-1.5 text-green-800">{request.couponCode}</code>}
                      <strong className="text-green-700">{formatMoney(couponAmount, currency)}</strong>
                    </span>
                  }
                />
              )}
              {hasExchange && (
                <Button size="sm" variant="outline" onClick={() => onEditCoupon(request)}>
                  تعديل قيمة الكوبون
                </Button>
              )}
            </section>

            {/* Shipment */}
            <section className="space-y-2 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">شحنة المرتجع</h3>
                {request.returnLabelNotificationSentAt ? (
                  <Badge className="bg-green-100 text-green-800">أُرسلت البوليصة</Badge>
                ) : request.returnLabelUrl ? (
                  <Badge className="bg-amber-100 text-amber-800">لم تُرسل</Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-800">لا توجد بوليصة</Badge>
                )}
              </div>
              {request.needsManualShipment && (
                <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
                  لم يصل رقم تتبع أو بوليصة. أنشئي شحنة المرتجع في سلة ثم اضغطي «تحديث من سلة».
                </p>
              )}
              <p>
                رقم التتبع: <span dir="ltr">{trackingNumber || '—'}</span>
                {trackingLink && (
                  <a href={trackingLink.url} target="_blank" rel="noreferrer" className="mr-2 text-indigo-600 hover:underline">
                    تتبع {company.nameAr}
                  </a>
                )}
              </p>
              <p className="text-xs text-gray-600">
                {live
                  ? `${resolveMajorSmsaStatus(live) || live.description || live.code || ''}${live.city ? ` • ${live.city}` : ''}${live.timestamp ? ` • ${formatDateTime(live.timestamp)}` : ''}`
                  : 'لا يوجد تحديث من شركة الشحن حتى الآن'}
              </p>
              {request.receivedAt && <p className="text-xs text-emerald-700">وصلت للمستودع: {formatDateTime(request.receivedAt)}</p>}
              {request.localShipments?.map((shipment) => (
                <ShipmentTrackingSummary key={shipment.id} shipment={shipment} />
              ))}
              {request.returnLabelNotificationError && (
                <p className="text-xs text-red-600">خطأ الإرسال: {request.returnLabelNotificationError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {request.returnLabelUrl && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={request.returnLabelUrl} target="_blank" rel="noopener noreferrer">
                      فتح البوليصة
                    </a>
                  </Button>
                )}
                {(Object.keys(LABEL_ACTIONS) as Array<keyof typeof LABEL_ACTIONS>).map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || (action === 'resend' && !request.returnLabelUrl)}
                    onClick={() => {
                      const run = () =>
                        call(`label:${action}`, '/api/returns/label-actions', { returnRequestId: request.id, action }, (data) =>
                          action === 'resend'
                            ? data.notification?.status === 'sent'
                              ? 'تم إرسال البوليصة على الواتساب.'
                              : `لم يتم الإرسال: ${data.notification?.reason || data.notification?.error || 'سبب غير معروف'}`
                            : LABEL_SYNC_MESSAGES[data.sync?.status] || 'تم تنفيذ الإجراء.',
                        ).then(() => undefined);
                      if (action === 'reissue') {
                        setConfirm({ title: 'إعادة إصدار البوليصة', message: 'سيتم طلب بوليصة إرجاع جديدة لهذا الطلب. المتابعة؟', action: run });
                      } else {
                        void run();
                      }
                    }}
                  >
                    {busy === `label:${action}` ? <Loader2 className="size-4 animate-spin" /> : LABEL_ACTIONS[action]}
                  </Button>
                ))}
              </div>
            </section>

            {/* Request info */}
            <section className="space-y-1 text-sm text-gray-700">
              <p>
                <span className="text-gray-500">السبب:</span> {RETURN_REASON_LABELS[request.reason] || request.reason}
              </p>
              {request.reasonDetails && <p className="text-xs text-gray-600">{request.reasonDetails}</p>}
              {request.sallaStatus?.name && (
                <p>
                  <span className="text-gray-500">حالة سلة:</span> {request.sallaStatus.name}
                </p>
              )}
              <p>
                <span className="text-gray-500">الحالة:</span> {STATUS_LABELS[request.status] || request.status}
              </p>
              {request.adminNotes && <p className="rounded bg-blue-50 p-2 text-blue-900">{request.adminNotes}</p>}
            </section>

            {/* Timeline */}
            {audit.length > 0 && (
              <section>
                <h3 className="mb-2 font-semibold">سجل المعالجة</h3>
                <ol className="space-y-1.5 border-r-2 border-gray-100 pr-3 text-xs">
                  {audit.map((entry, index) => (
                    <li key={`${entry.at}-${index}`} className="flex flex-wrap gap-x-2">
                      <span className="text-gray-400">{formatDateTime(entry.at)}</span>
                      <span className="font-medium">{AUDIT_STEP_LABELS[entry.step] || entry.step}</span>
                      <span
                        className={
                          entry.result === 'ok'
                            ? 'text-emerald-700'
                            : entry.result === 'failed' || entry.result === 'unknown'
                              ? 'text-red-700'
                              : 'text-gray-500'
                        }
                      >
                        {{ ok: 'تم', skipped: 'تخطي', failed: 'فشل', unknown: 'غير معروف', info: '' }[entry.result]}
                      </span>
                      {typeof entry.details?.product === 'string' && <span className="text-gray-600">{entry.details.product as string}</span>}
                      {typeof entry.details?.amount === 'number' && (
                        <span className="text-gray-600">{formatMoney(entry.details.amount as number, currency)}</span>
                      )}
                      {typeof entry.details?.reason === 'string' && <span className="text-gray-500">{entry.details.reason as string}</span>}
                      {typeof entry.details?.error === 'string' && <span className="text-red-600">{entry.details.error as string}</span>}
                      {entry.by && <span className="text-gray-400">— {entry.by}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-white p-4">
            {request.stage === 'ready' && (
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onProcess(request)}>
                اعتماد ومعالجة
              </Button>
            )}
            {request.stage === 'completed' && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  setConfirm({
                    title: 'إعادة للمراجعة',
                    message: 'سيُعاد فتح الطلب. لن يتم التراجع عن أي استرجاع أو كوبون تم.',
                    action: async () => {
                      await call('reopen', '/api/returns/update', { id: request.id, status: 'pending_review' }, () => 'تمت إعادة الطلب للمراجعة.');
                    },
                  })
                }
              >
                إعادة للمراجعة
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} className="mr-auto">
              إغلاق
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmationDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        message={confirm?.message}
        confirmVariant={confirm?.danger ? 'danger' : 'primary'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          void action?.();
        }}
      />
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${muted ? 'text-gray-500' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

