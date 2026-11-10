'use client';

import Link from 'next/link';
import { CloudOff, Home, Loader2, Pause, Printer, RotateCcw, Timer } from 'lucide-react';
import type { PrepAssignmentView, QueueStats } from '@/app/lib/order-prep/types';
import { formatAgeAr, orderAgeMs } from '@/app/lib/order-prep/riyadh-time';
import { cn } from '@/lib/utils';
import type { PrepUiState } from './prep-store';

const HOUR = 3_600_000;

export function AgeChip({ placedAt, className }: { placedAt: string | null; className?: string }) {
  const age = orderAgeMs(placedAt);
  if (age === null) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold',
        age > 48 * HOUR ? 'bg-red-600 text-white' : age > 24 * HOUR ? 'bg-amber-400 text-amber-950' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      <Timer className="h-3.5 w-3.5" />
      {formatAgeAr(age)}
    </span>
  );
}

export function TopBar({
  current,
  stats,
  myCompletedToday,
  lastDone,
  pending,
  online,
  onPause,
  onReprint,
}: {
  current: PrepAssignmentView | null;
  stats: QueueStats | null;
  myCompletedToday: number;
  lastDone: PrepUiState['lastDone'];
  pending: number;
  online: boolean;
  onPause: (() => void) | null;
  onReprint: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 px-3 pb-2 pt-[max(env(safe-area-inset-top),8px)] backdrop-blur">
      <div className="flex items-center gap-2">
        {onPause ? (
          <button
            type="button"
            onClick={onPause}
            aria-label="إيقاف مؤقت"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background"
          >
            <Pause className="h-5 w-5" />
          </button>
        ) : (
          <Link
            href="/"
            aria-label="الرئيسية"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background"
          >
            <Home className="h-5 w-5" />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          {current ? (
            <div className="flex items-center gap-2">
              <span dir="ltr" className="truncate font-mono text-xl font-extrabold tracking-wide text-foreground">
                #{current.order.orderNumber}
              </span>
              <AgeChip placedAt={current.order.placedAt} />
            </div>
          ) : (
            <span className="text-base font-bold text-foreground">تجهيز الطلبات</span>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {stats ? `${stats.waiting.toLocaleString('ar-SA')} بالانتظار` : '…'} · أنجزت {myCompletedToday.toLocaleString('ar-SA')} اليوم
          </p>
        </div>
        {!online && (
          <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">
            <CloudOff className="h-4 w-4" /> بدون شبكة
          </span>
        )}
        {pending > 0 && (
          <span
            className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800"
            title="عمليات بانتظار الإرسال"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {pending}
          </span>
        )}
      </div>
      {lastDone && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-muted px-2 py-1 text-xs">
          <span className="text-muted-foreground">آخر طلب:</span>
          <span dir="ltr" className="font-mono font-bold text-foreground">
            #{lastDone.orderNumber}
          </span>
          <span className="mr-auto flex items-center gap-1">
            {lastDone.print === 'sending' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {lastDone.print === 'ok' && (
              <span className="flex items-center gap-1 font-semibold text-emerald-700">
                <Printer className="h-3.5 w-3.5" /> طُبعت التذكرة
              </span>
            )}
            {(lastDone.print === 'failed' || lastDone.print === 'idle' || lastDone.print === 'ok') && (
              <button
                type="button"
                onClick={onReprint}
                className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold',
                  lastDone.print === 'failed' ? 'bg-red-600 text-white' : 'border bg-background text-foreground',
                )}
              >
                {lastDone.print === 'failed' ? <RotateCcw className="h-3.5 w-3.5" /> : <Printer className="h-3.5 w-3.5" />}
                {lastDone.print === 'failed' ? 'فشلت الطباعة — أعد' : 'إعادة طباعة'}
              </button>
            )}
          </span>
        </div>
      )}
    </header>
  );
}
