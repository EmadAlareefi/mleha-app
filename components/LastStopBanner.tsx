'use client';

import { AlertOctagon } from 'lucide-react';
import type { StopReason } from '@/app/lib/order-prep/stop-reason';

/** The order was stopped (X4) before and sent back: show why. */
export function LastStopBanner({ stop }: { stop: StopReason }) {
  const when = new Date(stop.at).toLocaleString('ar-SA-u-nu-latn', {
    timeZone: 'Asia/Riyadh',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div className="flex items-start gap-3 rounded-xl border-2 border-rose-400 bg-rose-50 p-3 text-rose-900">
      <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-extrabold">
          أُوقف هذا الطلب سابقاً (X4) {stop.source === 'shipping' ? 'عند الشحن' : 'عند التجهيز'}
        </p>
        <p className="whitespace-pre-line break-words text-sm font-semibold">{stop.note}</p>
        <p className="text-xs opacity-80">
          {[stop.byName, when].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}
