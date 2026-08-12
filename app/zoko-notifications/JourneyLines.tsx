'use client';

import type { CSSProperties } from 'react';
import { AlertTriangle, Check, Clock3, Eye, PackageCheck, ReceiptText, Star, Truck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import styles from './journey-lines.module.css';

type MilestoneStatus =
  | 'missing'
  | 'pending'
  | 'active'
  | 'delivered'
  | 'read'
  | 'problem'
  | 'skipped';

export type CustomerJourneyLine = {
  key: string;
  customerName: string;
  orderNumber: string;
  maskedPhone: string;
  latestAt: string;
  hasProblem: boolean;
  progress: number;
  milestones: Array<{
    step: 'order_received' | 'shipped' | 'product_rating';
    label: string;
    status: MilestoneStatus;
    statusLabel: string;
    at: string | null;
    problem: string | null;
  }>;
  exceptions: Array<{
    step: 'cancelled' | 'refunded';
    label: string;
    statusLabel: string;
    isProblem: boolean;
  }>;
};

const milestoneIcons = {
  order_received: ReceiptText,
  shipped: Truck,
  product_rating: Star,
};

function statusIcon(status: MilestoneStatus) {
  if (status === 'read') return Eye;
  if (status === 'delivered') return Check;
  if (status === 'problem') return AlertTriangle;
  if (status === 'pending' || status === 'active') return Clock3;
  return null;
}

function formatJourneyTime(value: string | null): string {
  if (!value) return 'لم تُرسل بعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-SA', {
    timeZone: 'Asia/Riyadh',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function JourneyLines({ journeys }: { journeys: CustomerJourneyLine[] }) {
  if (journeys.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/20 p-12 text-center text-muted-foreground">
        لا توجد رحلات عملاء مطابقة للفلاتر الحالية.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {journeys.map((journey, rowIndex) => (
        <article
          key={journey.key}
          className={cn(styles.journeyRow, journey.hasProblem && styles.problemRow)}
          style={{ animationDelay: `${Math.min(rowIndex, 10) * 55}ms` }}
        >
          <div className={styles.customerBlock}>
            <div className={styles.avatar} aria-hidden="true">
              {journey.customerName.trim().slice(0, 1) || 'ع'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-bold text-slate-950">{journey.customerName}</h3>
                {journey.hasProblem && (
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                    تحتاج متابعة
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500" dir="ltr">
                #{journey.orderNumber} · {journey.maskedPhone}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">آخر تحديث {formatJourneyTime(journey.latestAt)}</p>
            </div>
          </div>

          <div className={styles.timeline}>
            <div className={styles.track} aria-hidden="true">
              <div className={styles.trackGlow} style={{ width: `${journey.progress}%` }} />
            </div>
            <div className={styles.milestoneGrid}>
              {journey.milestones.map((milestone, milestoneIndex) => {
                const Icon = milestoneIcons[milestone.step];
                const StateIcon = statusIcon(milestone.status);
                return (
                  <div
                    key={milestone.step}
                    className={styles.milestone}
                    style={{ '--milestone-index': milestoneIndex } as CSSProperties}
                  >
                    <div className={cn(styles.dot, styles[`dot_${milestone.status}`])}>
                      <Icon className={styles.primaryIcon} />
                      {StateIcon && <StateIcon className={styles.stateIcon} />}
                    </div>
                    <div className={styles.milestoneCopy}>
                      <p className="font-semibold text-slate-800">{milestone.label}</p>
                      <p className={cn('text-xs', milestone.status === 'problem' ? 'text-rose-600' : 'text-slate-500')}>
                        {milestone.statusLabel}
                      </p>
                      <p className="text-[11px] text-slate-400">{formatJourneyTime(milestone.at)}</p>
                      {milestone.problem && (
                        <p className="mt-1 line-clamp-2 max-w-56 text-[11px] leading-4 text-rose-600">
                          {milestone.problem}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={styles.exceptionBlock}>
            {journey.exceptions.length > 0 ? (
              journey.exceptions.map((exception) => (
                <div
                  key={exception.step}
                  className={cn(styles.exceptionPill, exception.isProblem && styles.exceptionProblem)}
                >
                  {exception.step === 'refunded' ? <PackageCheck className="size-4" /> : <AlertTriangle className="size-4" />}
                  <span>
                    <strong>{exception.label}</strong>
                    <small>{exception.statusLabel}</small>
                  </span>
                </div>
              ))
            ) : (
              <div className={styles.cleanPill}>
                <Check className="size-4" />
                مسار طبيعي
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
