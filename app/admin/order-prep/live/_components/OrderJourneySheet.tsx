'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Hand, Loader2, ShieldAlert, Undo2, UserRound, Zap } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { ActionTarget, JourneyStaff, OrderJourney, StuckItem } from '@/app/lib/stuck-orders/types';
import { sallaOrderUrl } from '@/lib/salla-admin-url';
import { cn } from '@/lib/utils';
import { ACTION_META, CATEGORY_META, formatAge, formatDate } from './labels';
import { StageStepper } from './StageStepper';

type Props = {
  orderId: string | null;
  threshold: number;
  /** Bumped after an action so the sheet reloads. */
  refreshKey: number;
  busy: boolean;
  onClose: () => void;
  onAction: (item: StuckItem, target: ActionTarget) => void;
  onCopy: (text: string) => void;
  /** Flag (true) or unflag (false) the order as «طلب مميز». */
  onPriority: (item: StuckItem, flag: boolean) => void;
  onViolation: (staff: JourneyStaff, orderNumber: string) => void;
};

const ROLE_LABEL: Record<JourneyStaff['role'], string> = { packer: 'جهّز الطلب', printer: 'طبع البوليصة' };
// The flag only matters while the order waits for a packer.
const PRE_PREP_STAGES = new Set(['placed']);

const TONE_DOT: Record<string, string> = {
  neutral: 'bg-stone-400',
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
};

/** Everything about one order: the diagnosis, what to do, and every event in order. */
export function OrderJourneySheet({ orderId, threshold, refreshKey, busy, onClose, onAction, onCopy, onPriority, onViolation }: Props) {
  const [journey, setJourney] = useState<OrderJourney | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setError(null);
    fetch(`/api/admin/stuck-orders/${encodeURIComponent(orderId)}?threshold=${threshold}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'تعذر تحميل مسار الطلب');
        if (!cancelled) setJourney(data.journey);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'تعذر تحميل مسار الطلب'));
    return () => {
      cancelled = true;
    };
  }, [orderId, threshold, refreshKey]);

  useEffect(() => {
    if (!orderId) setJourney(null);
  }, [orderId]);

  const item = journey?.item.orderId === orderId ? journey.item : null;
  const diagnosis = item?.diagnosis;
  const meta = diagnosis?.category ? CATEGORY_META[diagnosis.category] : null;

  return (
    <Sheet open={Boolean(orderId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="left" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b bg-card/60 p-5">
          <SheetTitle className="flex items-center gap-2 text-xl">
            <span dir="ltr" className="tabular-nums">
              #{item?.orderNumber ?? orderId}
            </span>
            {item && (
              <button
                type="button"
                aria-label="نسخ رقم الطلب"
                onClick={() => onCopy(item.orderNumber ?? item.orderId)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <Copy className="h-4 w-4" />
              </button>
            )}
          </SheetTitle>
          <SheetDescription>
            {item ? [item.customerName, item.customerCity, item.statusName && `سلة: ${item.statusName}`].filter(Boolean).join(' · ') : 'مسار الطلب داخل المستودع'}
          </SheetDescription>
        </SheetHeader>

        {!item ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            {error ? <span className="text-rose-700">{error}</span> : <Loader2 className="h-6 w-6 animate-spin" />}
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <section
              className={cn(
                'rounded-2xl border p-4',
                !diagnosis!.stuck ? 'border-emerald-200 bg-emerald-50' : diagnosis!.severity === 'critical' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold">
                  {meta ? <meta.Icon className="h-4 w-4" /> : null}
                  {diagnosis!.stuck ? meta?.label ?? 'عالق' : 'لا مشكلة'}
                </span>
                {diagnosis!.stuck && (
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold">عالق منذ {formatAge(diagnosis!.ageMs)}</span>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed">{diagnosis!.reason}</p>
              {diagnosis!.held && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-sky-800">
                  <Hand className="h-3.5 w-3.5" /> {diagnosis!.held}
                </p>
              )}
              <div className="mt-4">
                <StageStepper kind="order" reached={item.reached} current={diagnosis!.stage} stuck={diagnosis!.stuck} />
              </div>
              {diagnosis!.actions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {diagnosis!.actions.map((target) => {
                    const action = ACTION_META[target.action];
                    return (
                      <button
                        key={target.action}
                        type="button"
                        disabled={busy}
                        onClick={() => onAction(item, target)}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm font-bold shadow-sm transition disabled:opacity-50',
                          action.danger ? 'border bg-white text-rose-700 hover:bg-rose-50' : 'bg-[#8b6f47] text-white hover:bg-[#765d3a]',
                        )}
                      >
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <PrioritySection
              priority={journey!.priority}
              notYetPacked={PRE_PREP_STAGES.has(diagnosis!.stage)}
              busy={busy}
              onToggle={(flag) => onPriority(item, flag)}
            />

            <section className="grid grid-cols-2 gap-2 text-sm">
              <QuickLink href={sallaOrderUrl(item.orderId)} external Icon={ExternalLink} label="فتح في سلة" />
              {journey!.returns.length > 0 && (
                <QuickLink href={`/returns-management?open=${journey!.returns[0].returnId}`} Icon={Undo2} label="المرتجع" />
              )}
            </section>

            {item.trackingNumber && (
              <p className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">رقم التتبع</span>
                <button type="button" onClick={() => onCopy(item.trackingNumber!)} className="flex items-center gap-1 font-mono" dir="ltr">
                  {item.trackingNumber} <Copy className="h-3 w-3" />
                </button>
              </p>
            )}

            {journey!.returns.map((ret) => (
              <div key={ret.key} className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm">
                <p className="font-bold text-fuchsia-900">مرتجع</p>
                <p className="mt-1">{ret.diagnosis.reason}</p>
              </div>
            ))}

            {journey!.staff.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-bold">فريق الطلب</h3>
                <ul className="space-y-2">
                  {journey!.staff.map((person) => (
                    <li key={person.userId} className="flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-bold">{person.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABEL[person.role]}</span>
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onViolation(person, item.orderNumber ?? item.orderId)}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" /> تسجيل مخالفة
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-3 text-sm font-bold">مسار الطلب</h3>
              {journey!.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد أحداث مسجلة.</p>
              ) : (
                <ol className="relative space-y-4 border-r-2 border-stone-200 pr-5">
                  {journey!.events.map((event, index) => (
                    <li key={`${event.at}-${index}`} className="relative">
                      <span
                        className={cn('absolute top-1.5 -right-[27px] h-3 w-3 rounded-full ring-4 ring-background', TONE_DOT[event.tone])}
                      />
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className={cn('text-sm font-bold', event.tone === 'bad' && 'text-rose-700')}>{event.title}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{formatDate(event.at)}</span>
                      </div>
                      {event.actor && <p className="text-xs text-muted-foreground">بواسطة {event.actor}</p>}
                      {event.detail && (
                        <p className="mt-0.5 line-clamp-4 text-xs whitespace-pre-line text-muted-foreground">{event.detail}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PrioritySection({
  priority,
  notYetPacked,
  busy,
  onToggle,
}: {
  priority: OrderJourney['priority'];
  notYetPacked: boolean;
  busy: boolean;
  onToggle: (flag: boolean) => void;
}) {
  // Once packing has started the flag no longer changes anything; only offer to clear it.
  if (!priority && !notYetPacked) return null;
  return (
    <section
      className={cn(
        'flex items-center justify-between gap-3 rounded-2xl border p-3 text-sm',
        priority ? 'border-amber-300 bg-amber-50' : 'bg-card',
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-bold">
          <Zap className={cn('h-4 w-4', priority ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
          {priority ? 'طلب مميز' : 'طلب عادي'}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {priority
            ? `يُجهّز قبل غيره · ${[priority.createdByName, formatDate(priority.createdAt)].filter(Boolean).join(' · ')}`
            : 'التمييز يضعه أول طابور التجهيز'}
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => onToggle(!priority)}
        className={cn(
          'shrink-0 rounded-lg px-3 py-2 text-xs font-bold shadow-sm disabled:opacity-50',
          priority ? 'border bg-white text-stone-700 hover:bg-stone-50' : 'bg-amber-500 text-white hover:bg-amber-600',
        )}
      >
        {priority ? 'إلغاء التمييز' : 'تمييز كطلب مميز'}
      </button>
    </section>
  );
}

function QuickLink({ href, label, Icon, external }: { href: string; label: string; Icon: typeof ExternalLink; external?: boolean }) {
  const className = 'flex items-center justify-center gap-1.5 rounded-xl border bg-card px-3 py-2 font-medium hover:bg-muted';
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      <Icon className="h-4 w-4" /> {label}
    </a>
  ) : (
    <Link href={href} className={className}>
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}
