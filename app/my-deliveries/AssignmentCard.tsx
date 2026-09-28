'use client';

import { CheckCircle2, MapPin, MessageCircle, Navigation, Phone, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  type Assignment,
  type LocalShipment,
  formatCurrency,
  formatDate,
  formatDistance,
  getAddressDetails,
  getAddressNote,
  getAreaLabel,
  getCallLink,
  getCollectAmount,
  getExchangeCouponCode,
  getMapTarget,
  getWhatsAppLink,
} from './delivery-helpers';

interface AssignmentCardProps {
  assignment: Assignment;
  /** km from the agent; null when the shipment has no pin, undefined while GPS is unknown. */
  distance?: number | null;
  isReturn: boolean;
  onDeliver: (assignment: Assignment) => void;
  onFail: (assignment: Assignment) => void;
  admin?: {
    selected: boolean;
    onToggle: () => void;
    onRefreshLocation: () => void;
    refreshing: boolean;
    disabled: boolean;
  };
}

const actionLinkClass =
  'flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border text-xs font-semibold transition-colors';

/** Large distance readout so the agent can pick the next stop at a glance. */
export function DistanceBadge({ distance }: { distance?: number | null }) {
  if (distance === undefined) return null;
  if (distance === null) {
    return <p className="text-xs font-medium text-gray-400">بدون موقع</p>;
  }
  return (
    <p className="text-3xl font-extrabold leading-none text-blue-700" aria-label="المسافة التقريبية">
      {formatDistance(distance)}
    </p>
  );
}

/** The three one-tap buttons every stop needs: navigate, call, WhatsApp. */
export function ContactActions({
  shipment,
  purpose,
}: {
  shipment: LocalShipment;
  purpose: 'delivery' | 'pickup';
}) {
  const mapTarget = getMapTarget(shipment);
  const callLink = getCallLink(shipment);
  const whatsappLink = getWhatsAppLink(shipment, Boolean(mapTarget?.precise), purpose);

  return (
    <div className="mt-4 flex gap-2">
      {mapTarget ? (
        <a
          href={mapTarget.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${actionLinkClass} ${
            mapTarget.precise
              ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Navigation className="h-5 w-5" aria-hidden />
          {mapTarget.precise ? 'الخريطة' : 'خريطة تقريبية'}
        </a>
      ) : (
        <span className={`${actionLinkClass} cursor-not-allowed border-dashed text-gray-400`}>
          <Navigation className="h-5 w-5" aria-hidden />
          لا يوجد موقع
        </span>
      )}
      {callLink && (
        <a href={callLink} className={`${actionLinkClass} border-gray-200 text-gray-700 hover:bg-gray-50`}>
          <Phone className="h-5 w-5" aria-hidden />
          اتصال
        </a>
      )}
      {whatsappLink && (
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className={`${actionLinkClass} border-emerald-200 text-emerald-700 hover:bg-emerald-50`}
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          واتساب
        </a>
      )}
    </div>
  );
}

export function AssignmentCard({ assignment, distance, isReturn, onDeliver, onFail, admin }: AssignmentCardProps) {
  const { shipment } = assignment;
  const meta = shipment.orderItems?.meta;
  const mapTarget = getMapTarget(shipment);
  const collectAmount = getCollectAmount(assignment);
  const couponCode = getExchangeCouponCode(shipment);
  const addressNote = getAddressNote(shipment);
  const recipientName = meta?.shipToName || shipment.customerName;

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        admin?.selected ? 'border-emerald-500 ring-1 ring-emerald-500' : ''
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm text-gray-500">#{shipment.orderNumber}</p>
          <p className="truncate text-lg font-bold text-gray-900">{recipientName}</p>
          <p className="flex items-center gap-1 text-sm text-gray-600">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            {getAreaLabel(shipment)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 text-left">
          <DistanceBadge distance={distance} />
          {collectAmount > 0 ? (
            <div className="rounded-lg bg-orange-50 px-3 py-1.5 text-center">
              <p className="text-[11px] font-medium text-orange-700">حصّل</p>
              <p className="text-base font-bold text-orange-700">{formatCurrency(collectAmount)}</p>
            </div>
          ) : (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              مدفوع
            </span>
          )}
          {admin && (
            <label className="flex items-center justify-end gap-1.5 text-xs text-emerald-700">
              <Checkbox checked={admin.selected} onCheckedChange={admin.onToggle} disabled={admin.disabled} />
              تحديد
            </label>
          )}
        </div>
      </header>

      {isReturn && (
        <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">استبدال:</span> استلم القطعة الأصلية من العميل عند التسليم
            {assignment.exchangeRequest ? ' — خذ البديل من المستودع قبل الخروج' : ''}.
            {couponCode && couponCode !== 'EXCHANGE' && (
              <span className="mr-1 font-mono text-xs">({couponCode})</span>
            )}
          </p>
        </div>
      )}

      {addressNote && (
        <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
          <span className="font-semibold">ملاحظة العنوان:</span> {addressNote}
        </p>
      )}

      {assignment.notes && (
        <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
          <span className="font-semibold">ملاحظة:</span> {assignment.notes}
        </p>
      )}

      <ContactActions shipment={shipment} purpose="delivery" />

      <div className="mt-2 flex gap-2">
        <Button
          className="h-12 flex-[2] bg-emerald-600 text-base font-bold hover:bg-emerald-700"
          onClick={() => onDeliver(assignment)}
        >
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          تم التسليم
        </Button>
        <Button
          variant="outline"
          className="h-12 flex-1 border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => onFail(assignment)}
        >
          <XCircle className="h-5 w-5" aria-hidden />
          تعذّر
        </Button>
      </div>

      <details className="group mt-3 text-sm text-gray-600">
        <summary className="cursor-pointer select-none text-xs font-medium text-gray-500">
          التفاصيل
        </summary>
        <ul className="mt-2 space-y-1.5">
          {getAddressDetails(shipment).map((line) => (
            <li key={line} className="whitespace-pre-line">{line}</li>
          ))}
          {!mapTarget?.precise && (
            <li className="text-amber-700">
              لا يوجد موقع دقيق من العميل — اطلب الموقع عبر واتساب.
            </li>
          )}
          <li>
            الهاتف: <span dir="ltr">{meta?.shipToPhone || shipment.customerPhone}</span>
          </li>
          <li>
            رقم التتبع: <span className="font-mono">{shipment.trackingNumber}</span>
          </li>
          <li>قيمة الطلب: {formatCurrency(Number(shipment.orderTotal) || 0)}</li>
          <li>تاريخ التعيين: {formatDate(assignment.assignedAt)}</li>
          {admin && (
            <li>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={admin.onRefreshLocation}
                disabled={admin.refreshing}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {admin.refreshing ? 'جاري التحديث...' : 'تحديث الموقع من سلة'}
              </Button>
            </li>
          )}
        </ul>
      </details>
    </article>
  );
}
