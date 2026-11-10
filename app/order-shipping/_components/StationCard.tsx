'use client';

import Image from 'next/image';
import { AlertOctagon, Gift, Globe, Loader2, Package, Truck, Zap } from 'lucide-react';
import type { StationView } from '@/app/lib/shipping/types';
import { cn } from '@/lib/utils';

const WAITING_STATES = new Set(['queued', 'creating', 'awaiting_label']);

/** Banner colour and text for the order's shipping state. */
function stateTone(view: StationView): { tone: string; title: string; detail: string | null } {
  if (view.flags.doNotShip) {
    return {
      tone: 'border-red-600 bg-red-600 text-white',
      title: '🚫 لا تشحن هذا الطلب',
      detail: view.flags.doNotShip.notes || 'الطلب موقوف عن الشحن — سلّمه للمشرف',
    };
  }
  switch (view.state) {
    case 'label_ready':
      return { tone: 'border-emerald-600 bg-emerald-50 text-emerald-900', title: '✅ البوليصة جاهزة', detail: view.shipment?.courier ?? null };
    case 'printed':
      return {
        tone: 'border-slate-400 bg-slate-100 text-slate-800',
        title: '🖨 طُبعت البوليصة',
        detail: view.task?.printedByName ? `بواسطة ${view.task.printedByName}` : null,
      };
    case 'queued':
    case 'creating':
    case 'awaiting_label':
      return { tone: 'border-amber-500 bg-amber-50 text-amber-900', title: '⏳ جاري إنشاء الشحنة في سلة…', detail: 'تُطبع البوليصة فور وصولها' };
    case 'failed':
      return { tone: 'border-red-500 bg-red-50 text-red-900', title: '❌ تعذر إنشاء الشحنة', detail: view.task?.lastError ?? null };
    case 'blocked':
      return { tone: 'border-red-500 bg-red-50 text-red-900', title: '⛔ الطلب موقوف', detail: view.task?.blockReason ?? null };
    case 'needs_agent':
      return { tone: 'border-blue-500 bg-blue-50 text-blue-900', title: '🛵 توصيل محلي', detail: 'اختر المندوب لطباعة الملصق' };
    case 'manual_international':
      return {
        tone: 'border-violet-500 bg-violet-50 text-violet-900',
        title: '🌍 طلب دولي — DHL',
        detail: 'اطبع الفاتورة التجارية، وأنشئ شحنة DHL في سلة؛ تُطبع البوليصة هنا عند وصولها',
      };
    case 'cancelled':
      return { tone: 'border-slate-400 bg-slate-100 text-slate-800', title: 'أُغلقت مهمة الشحن', detail: null };
    default:
      return {
        tone: 'border-amber-500 bg-amber-50 text-amber-900',
        title: view.prep.packed ? 'جاري تجهيز مهمة الشحن' : '⚠ لم يُجهَّز عبر صفحة التجهيز',
        detail: view.prep.packed ? null : 'تأكد من القطع قبل إنشاء الشحنة',
      };
  }
}

export function StationCard({ view }: { view: StationView }) {
  const banner = stateTone(view);
  const order = view.order;
  const short = new Set(view.prep.shortIndexes);
  const waiting = view.state ? WAITING_STATES.has(view.state) : false;

  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-3">
      <div className={cn('rounded-2xl border-2 px-4 py-3', banner.tone)}>
        <div className="flex items-center gap-2 text-lg font-extrabold">
          {waiting && <Loader2 className="h-5 w-5 animate-spin" />}
          <span>{banner.title}</span>
        </div>
        {banner.detail && <p className="mt-1 text-sm font-semibold opacity-90">{banner.detail}</p>}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-3xl font-black tracking-tight">#{view.orderNumber}</p>
          <p className="truncate text-sm text-muted-foreground">
            {[view.customerName, view.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          {(view.shipment?.courier || order.shippingCompany) && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-bold">
              <Truck className="h-3.5 w-3.5" /> {view.shipment?.courier || order.shippingCompany}
            </span>
          )}
          {view.shipment?.trackingNumber && <span className="font-mono text-muted-foreground">{view.shipment.trackingNumber}</span>}
          {view.local && (
            <span className="font-mono text-muted-foreground">
              {view.local.trackingNumber}
              {view.local.agentName ? ` · ${view.local.agentName}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm font-bold">
        {view.flags.highPriority && (
          <span className="flex items-center gap-1 rounded-full bg-red-600 px-3 py-1 text-white">
            <Zap className="h-4 w-4" /> عاجل{view.flags.highPriority.reason ? ` — ${view.flags.highPriority.reason}` : ''}
          </span>
        )}
        {(view.flags.gift || order.gift) && (
          <span className="flex items-center gap-1 rounded-full bg-pink-600 px-3 py-1 text-white">
            <Gift className="h-4 w-4" /> تغليف هدية
          </span>
        )}
        {order.isInternational && (
          <span className="flex items-center gap-1 rounded-full bg-violet-600 px-3 py-1 text-white">
            <Globe className="h-4 w-4" /> دولي{order.country ? ` — ${order.country}` : ''}
          </span>
        )}
        {view.prep.packed ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1">
            <Package className="h-4 w-4" /> جهّزه {view.prep.packedBy ?? '—'}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-white">
            <AlertOctagon className="h-4 w-4" /> بدون تجهيز
          </span>
        )}
      </div>

      {(view.flags.gift?.notes || order.gift?.message || view.flags.highPriority?.notes) && (
        <div className="rounded-xl border border-pink-300 bg-pink-50 px-3 py-2 text-sm text-pink-900">
          {order.gift?.message && <p>🎁 رسالة الهدية: {order.gift.message}</p>}
          {view.flags.gift?.notes && <p>ملاحظة الهدية: {view.flags.gift.notes}</p>}
          {view.flags.highPriority?.notes && <p>ملاحظة: {view.flags.highPriority.notes}</p>}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {order.items.map((item) => {
          const isShort = short.has(item.index);
          return (
            <li
              key={item.key}
              className={cn('flex gap-3 rounded-2xl border bg-card p-2', isShort && 'border-red-400 bg-red-50 opacity-80')}
            >
              <div className="relative h-36 w-28 shrink-0 overflow-hidden rounded-xl bg-muted">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.name} fill unoptimized priority sizes="112px" className="object-cover" />
                ) : (
                  <Package className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="line-clamp-2 text-sm font-semibold">{item.name}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {item.size && (
                    <span className="rounded-lg bg-foreground px-3 py-1 text-2xl font-black text-background">{item.size}</span>
                  )}
                  <span
                    className={cn(
                      'rounded-lg px-3 py-1 text-2xl font-black',
                      item.quantity > 1 ? 'bg-orange-500 text-white' : 'bg-muted text-foreground',
                    )}
                  >
                    ×{item.quantity}
                  </span>
                  {item.color && <span className="text-sm text-muted-foreground">{item.color}</span>}
                </div>
                {item.sku && <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>}
                {isShort && <p className="text-sm font-bold text-red-700">ناقص عند التجهيز — لا يُشحن</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
