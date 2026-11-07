'use client';

import { AlertTriangle, ChevronLeft, Loader2, PackageCheck, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CONDITION_LABELS } from '@/app/lib/returns/inspection';
import { TYPE_COLORS, typeLabel } from '@/app/lib/returns/status';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import { STAGE_LABELS, type ReturnStage } from '@/lib/returns/workflow';
import { daysSince, EXCHANGE_PAYMENT_LABELS, formatDate, formatMoney, toNumber, type ReturnRequest } from './types';

export const STAGE_BADGE: Record<ReturnStage, string> = {
  awaiting_pickup: 'bg-slate-100 text-slate-700 border-slate-200',
  in_transit: 'bg-sky-100 text-sky-800 border-sky-200',
  received: 'bg-amber-100 text-amber-800 border-amber-200',
  ready: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  processing: 'bg-violet-100 text-violet-800 border-violet-200',
  needs_attention: 'bg-red-100 text-red-800 border-red-200',
  completed: 'bg-gray-100 text-gray-700 border-gray-200',
  closed: 'bg-gray-100 text-gray-500 border-gray-200',
};

const CONDITION_CHIP: Record<string, string> = {
  good: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  worn: 'border-amber-300 bg-amber-50 text-amber-800',
  missing_parts: 'border-amber-300 bg-amber-50 text-amber-800',
  damaged: 'border-red-300 bg-red-50 text-red-800',
};

interface RequestRowProps {
  request: ReturnRequest;
  selected: boolean;
  selectable: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onProcess: () => void;
}

export function RequestRow({ request, selected, selectable, busy, onToggleSelect, onOpen, onProcess }: RequestRowProps) {
  const refund = request.type === 'exchange' ? null : toNumber(request.totalRefundAmount);
  const coupon =
    request.type === 'exchange' ? toNumber(request.couponAmount ?? request.totalRefundAmount) : toNumber(request.couponAmount);
  const carrierLabel = resolveMajorSmsaStatus(request.smsaLiveStatus) || request.smsaLiveStatus?.description;
  const age = daysSince(request.receivedAt || request.createdAt);
  const inspected = request.items.filter((item) => item.conditionStatus).length;

  return (
    <div
      className={`group flex flex-col gap-3 rounded-xl border bg-white p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center ${
        request.stage === 'needs_attention' ? 'border-red-200' : request.needsManualShipment ? 'border-amber-300' : ''
      } ${selected ? 'ring-2 ring-emerald-400' : ''}`}
    >
      <div className="flex items-start gap-3 sm:w-64 sm:shrink-0">
        {selectable ? (
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`تحديد طلب ${request.orderNumber}`} className="mt-1" />
        ) : (
          <span className="w-4" />
        )}
        <button type="button" onClick={onOpen} className="min-w-0 text-right">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900 group-hover:text-blue-700">#{request.orderNumber}</span>
            <Badge className={TYPE_COLORS[request.type] || TYPE_COLORS.return}>{typeLabel(request.type)}</Badge>
          </div>
          <p className="truncate text-sm text-gray-600">{request.customerName}</p>
          <p className="text-xs text-gray-400">
            {formatDate(request.createdAt)}
            {age !== null && age > 0 ? ` • منذ ${age} يوم` : ''}
          </p>
        </button>
      </div>

      {/* Pieces */}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-wrap gap-1.5 text-right">
        {request.items.slice(0, 6).map((item) => (
          <span
            key={item.id}
            title={item.conditionStatus ? CONDITION_LABELS[item.conditionStatus] : 'لم تُفحص'}
            className={`inline-flex max-w-[14rem] items-center gap-1 truncate rounded-md border px-2 py-0.5 text-xs ${
              item.conditionStatus ? CONDITION_CHIP[item.conditionStatus] : 'border-dashed border-gray-300 text-gray-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.type === 'exchange' ? 'bg-green-500' : 'bg-blue-500'}`}
              aria-label={item.type === 'exchange' ? 'استبدال' : 'إرجاع'}
            />
            <span className="truncate">
              {item.productName}
              {item.variantName ? ` · ${item.variantName}` : ''}
              {item.quantity > 1 ? ` ×${item.quantity}` : ''}
            </span>
          </span>
        ))}
        {request.items.length > 6 && <span className="text-xs text-gray-500">+{request.items.length - 6}</span>}
      </button>

      {/* Money + status */}
      <div className="flex flex-wrap items-center gap-2 sm:w-56 sm:shrink-0 sm:flex-col sm:items-end">
        <div className="flex flex-wrap gap-1.5 text-xs font-medium">
          {refund ? <span className="rounded-md bg-blue-50 px-2 py-0.5 text-blue-800">استرجاع {formatMoney(refund, request.currency)}</span> : null}
          {request.exchangeMode === 'order' && request.exchangeOrderNumber ? (
            <span
              className={`rounded-md px-2 py-0.5 ${
                request.exchangePaymentStatus === 'pending' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'
              }`}
            >
              طلب بديل #{request.exchangeOrderNumber} · {EXCHANGE_PAYMENT_LABELS[request.exchangePaymentStatus || 'none']}
            </span>
          ) : coupon ? (
            <span className="rounded-md bg-green-50 px-2 py-0.5 text-green-800">كوبون {formatMoney(coupon, request.currency)}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          {request.stage === 'in_transit' || request.stage === 'awaiting_pickup' ? (
            <>
              <Truck className="size-3.5" />
              {carrierLabel || 'لا يوجد تحديث من شركة الشحن'}
            </>
          ) : request.stage === 'received' ? (
            <>
              <PackageCheck className="size-3.5" />
              تم فحص {inspected} من {request.items.length}
            </>
          ) : request.stage === 'needs_attention' ? (
            <span className="flex items-center gap-1 text-red-700">
              <AlertTriangle className="size-3.5" />
              <span className="line-clamp-1 max-w-[13rem]">{request.processingError || 'يحتاج تدخل'}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Action */}
      <div className="flex items-center justify-between gap-2 sm:w-44 sm:shrink-0 sm:justify-end">
        <Badge className={STAGE_BADGE[request.stage]}>{STAGE_LABELS[request.stage]}</Badge>
        {request.stage === 'ready' || request.stage === 'needs_attention' ? (
          <Button size="sm" onClick={onProcess} disabled={busy} className={request.stage === 'ready' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : request.stage === 'ready' ? 'معالجة' : 'مراجعة'}
          </Button>
        ) : (
          <Button size="icon" variant="ghost" onClick={onOpen} aria-label="فتح التفاصيل">
            <ChevronLeft className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
