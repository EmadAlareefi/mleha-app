'use client';

import { AlertTriangle, Timer, UserX, Users } from 'lucide-react';
import type { BoardData, BoardPacker } from '@/app/lib/order-prep/board';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';
import { AnimatedNumber, EmptyNote, Panel, PanelSkeleton, since } from './primitives';
import { useUrlParam } from './useUrlParam';
import { idleMinutes } from '../_lib/metrics';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

/** Packers live (who is on which order, for how long) and today's shippers. */
export function TeamPanel({
  board,
  shipping,
  busy,
  onRelease,
  delay,
  stale,
}: {
  board: BoardData | null;
  shipping: ShippingBoardData | null;
  busy: string | null;
  onRelease: (packer: BoardPacker) => void;
  delay?: number;
  stale?: string | null;
}) {
  const [rawTab, setTabParam] = useUrlParam('team', 'packers');
  const tab: 'packers' | 'shippers' = rawTab === 'shippers' ? 'shippers' : 'packers';
  const setTab = (next: 'packers' | 'shippers') => setTabParam(next);
  const packers = board?.packers ?? [];
  const shippers = shipping?.shippers ?? [];
  const maxDone = Math.max(1, ...packers.map((packer) => packer.completedToday));
  const maxPrinted = Math.max(1, ...shippers.map((shipper) => shipper.printedToday));

  // Busy first, then by output.
  const waiting = board?.stats.waiting ?? 0;
  const idleById = new Map(packers.map((packer) => [packer.userId, idleMinutes(packer, waiting)]));
  const idleCount = [...idleById.values()].filter((minutes) => minutes !== null).length;
  // Working first, then idle-while-orders-wait (needs attention), then by output.
  const rank = (packer: BoardPacker) => (packer.current ? 0 : (idleById.get(packer.userId) ?? null) !== null ? 1 : 2);
  const sorted = [...packers].sort((a, b) => rank(a) - rank(b) || b.completedToday - a.completedToday);

  return (
    <Panel
      title="الفريق"
      Icon={Users}
      delay={delay}
      stale={stale}
      actions={
        <>
          {idleCount > 0 && (
            <span
              title="مجهِّزون بلا طلب منذ 15 دقيقة أو أكثر والطابور فيه طلبات"
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"
            >
              {idleCount} متوقف
            </span>
          )}
        <div className="flex rounded-lg bg-[#f5ebe0] p-0.5 text-[11px] font-bold">
          {(
            [
              ['packers', `المجهِّزون ${packers.length}`],
              ['shippers', `الشاحنون ${shippers.length}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn('rounded-md px-2.5 py-1 transition', tab === key ? 'bg-white text-[#2c2416] shadow-sm' : 'text-[#6b5d4f] hover:text-[#2c2416]')}
            >
              {label}
            </button>
          ))}
        </div>
        </>
      }
    >
      {tab === 'packers' ? (
        !board ? (
          <PanelSkeleton />
        ) : sorted.length === 0 ? (
          <EmptyNote icon="🌙" title="لا يوجد نشاط تجهيز اليوم" />
        ) : (
          <ul className="space-y-2 p-3">
            {sorted.map((packer, index) => {
              const slow = (packer.current?.minutes ?? 0) > 10;
              const idle = idleById.get(packer.userId) ?? null;
              const scanRate = packer.completedToday > 0 ? Math.round((packer.scannedToday / packer.completedToday) * 100) : null;
              return (
                <li
                  key={packer.userId}
                  style={{ animationDelay: `${index * 45}ms` }}
                  className={cn(
                    styles.enter,
                    'group relative overflow-hidden rounded-xl border bg-white p-2.5 transition hover:shadow-md',
                    packer.current?.verifyIssue ? 'border-rose-200' : slow || idle !== null ? 'border-amber-200 bg-amber-50/40' : 'border-[#efe4d6]',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black',
                        packer.current ? 'bg-emerald-100 text-emerald-800' : 'bg-[#f5ebe0] text-[#8b6f47]',
                      )}
                    >
                      {initials(packer.name)}
                      <span
                        className={cn(
                          'absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-white',
                          packer.current ? 'bg-emerald-500' : 'bg-stone-300',
                        )}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-[#2c2416]">{packer.name}</span>
                        {packer.current?.verifyIssue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-[#6b5d4f]">
                        {packer.current ? (
                          <>
                            <span dir="ltr" className="font-mono font-bold text-[#2c2416]">#{packer.current.orderNumber}</span>
                            {packer.current.minutes !== null && (
                              <span className={cn('flex items-center gap-0.5 rounded px-1', slow ? 'bg-amber-100 font-bold text-amber-800' : '')}>
                                <Timer className="h-3 w-3" /> {packer.current.minutes} د
                              </span>
                            )}
                            {packer.next && <span dir="ltr" className="font-mono opacity-70">← #{packer.next.orderNumber}</span>}
                          </>
                        ) : (
                          idle !== null ? (
                            <span className="rounded bg-amber-100 px-1 font-bold text-amber-800">
                              متوقف منذ {since(packer.lastCompletedAt)} والطابور فيه {waiting}
                            </span>
                          ) : (
                            <span>متوقف{packer.lastCompletedAt ? ` · آخر طلب منذ ${since(packer.lastCompletedAt)}` : ''}</span>
                          )
                        )}
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-lg leading-none font-black text-[#2c2416]">
                        <AnimatedNumber value={packer.completedToday} />
                      </div>
                      <div className="text-[10px] text-[#6b5d4f]">
                        {packer.perHour ?? '—'}/س{scanRate !== null ? ` · مسح ${scanRate}%` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#f3eadf]">
                      <span
                        className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-[#8b6f47] to-[#c9a97a]"
                        style={{ width: `${(packer.completedToday / maxDone) * 100}%`, transition: 'width 900ms cubic-bezier(0.22,1,0.36,1)' }}
                      />
                      {packer.current && <span className={cn('absolute inset-0', styles.sheen)} />}
                    </div>
                    {(packer.current || packer.next) && (
                      <button
                        type="button"
                        disabled={busy === `release-${packer.userId}`}
                        onClick={() => onRelease(packer)}
                        className="flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-[#efe4d6] px-2.5 py-1 text-[11px] font-semibold text-[#6b5d4f] transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 active:scale-95 disabled:opacity-40"
                      >
                        <UserX className="h-3.5 w-3.5" /> إرجاع طلباته
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : !shipping ? (
        <PanelSkeleton />
      ) : shippers.length === 0 ? (
        <EmptyNote icon="📭" title="لا توجد بوالص مطبوعة اليوم" hint="من محطة الشحن الجديدة" />
      ) : (
        <ul className="space-y-2 p-3">
          {shippers.map((shipper, index) => (
            <li
              key={shipper.name}
              style={{ animationDelay: `${index * 45}ms` }}
              className={cn(styles.enter, 'rounded-xl border border-[#efe4d6] bg-white p-2.5')}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-800">
                  {initials(shipper.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[#2c2416]">{shipper.name}</p>
                  <p className="text-[11px] text-[#6b5d4f]">
                    آخر بوليصة منذ {since(shipper.lastPrintedAt)}
                    {shipper.medianGapSeconds !== null ? ` · وتيرة ${shipper.medianGapSeconds} ث` : ''}
                  </p>
                </div>
                <span className="text-lg font-black text-[#2c2416]">
                  <AnimatedNumber value={shipper.printedToday} />
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f3eadf]">
                <span
                  className="block h-full rounded-full bg-gradient-to-l from-sky-600 to-sky-300"
                  style={{ width: `${(shipper.printedToday / maxPrinted) * 100}%`, transition: 'width 900ms cubic-bezier(0.22,1,0.36,1)' }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
