'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';

const numberFormat = new Intl.NumberFormat('en-US');

/** Tweens to each new value and glows once when it changes. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [bumpKey, setBumpKey] = useState(0);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    setBumpKey((key) => key + 1);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    const duration = 700;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(start + (value - start) * eased);
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span key={bumpKey} className={cn('inline-block tabular-nums', bumpKey > 0 && styles.bump, className)}>
      {numberFormat.format(shown)}
    </span>
  );
}

export function Panel({
  title,
  Icon,
  count,
  actions,
  children,
  className,
  bodyClassName,
  delay = 0,
  tone,
  stale,
}: {
  title: string;
  Icon?: LucideIcon;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
  tone?: 'danger';
  /** Set when this panel's feed failed to refresh: what went wrong and how old the shown data is. */
  stale?: string | null;
}) {
  return (
    <section
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
      className={cn(
        styles.enter,
        'flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[#e3d5c3] bg-white/85 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_8px_24px_-12px_rgba(59,47,34,0.25)] backdrop-blur',
        tone === 'danger' && 'border-rose-200',
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[#efe4d6] px-4 py-2.5">
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f5ebe0] text-[#8b6f47]">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <h2 className="text-sm font-extrabold text-[#2c2416]">{title}</h2>
        {count !== undefined && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
              count > 0 && tone === 'danger' ? 'bg-rose-600 text-white' : 'bg-[#f5ebe0] text-[#6b5d4f]',
            )}
          >
            {count}
          </span>
        )}
        <div className="mr-auto flex items-center gap-1.5">{actions}</div>
      </header>
      {stale && (
        <p role="status" className="flex shrink-0 items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] font-semibold text-amber-900">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          {stale}
        </p>
      )}
      <div className={cn('min-h-0 flex-1 overflow-y-auto', styles.scroll, stale && 'opacity-60 saturate-50', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Circular gauge, 0–100. */
export function Ring({ percent, size = 64, stroke = 7, color, track = 'rgba(255,255,255,0.12)', children }: {
  percent: number;
  size?: number;
  stroke?: number;
  color: string;
  track?: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1), stroke 400ms' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Tiny trend line of the values seen since the page opened. */
export function Sparkline({ values, color = '#e8c896', width = 88, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <span style={{ width, height }} className="inline-block" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];
  return (
    // Drawn mirrored so time flows right → left like the rest of the page.
    <svg width={width} height={height} className="-scale-x-100 overflow-visible">
      <path d={area} fill={color} opacity={0.15} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.4} fill={color} />
    </svg>
  );
}

/** Segmented horizontal bar, each segment sized by its share. */
export function StackBar({
  segments,
  className,
}: {
  segments: Array<{ key: string; value: number; color: string; label: string }>;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className={cn('flex h-2.5 w-full overflow-hidden rounded-full bg-[#f1e7da]', className)}>
      {total > 0 &&
        segments.map((segment) =>
          segment.value > 0 ? (
            <span
              key={segment.key}
              title={`${segment.label}: ${segment.value}`}
              className={cn('h-full first:rounded-r-full last:rounded-l-full', segment.color)}
              style={{ width: `${(segment.value / total) * 100}%`, transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          ) : null,
        )}
    </div>
  );
}

export function LiveDot({ ok = true }: { ok?: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {ok && <span className={cn('absolute inline-flex h-full w-full rounded-full bg-emerald-400', styles.ping)} />}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', ok ? 'bg-emerald-400' : 'bg-rose-500')} />
    </span>
  );
}

export function EmptyNote({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center px-4 py-6 text-center">
      <span className="text-3xl">{icon}</span>
      <p className="mt-2 text-sm font-bold text-[#2c2416]">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-[#6b5d4f]">{hint}</p>}
    </div>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-xl bg-[#f3eadf]" style={{ animationDelay: `${index * 120}ms` }} />
      ))}
    </div>
  );
}

export const since = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} س`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'يوم' : days === 2 ? 'يومان' : `${days} أيام`;
};

/** "Couldn't refresh — showing data from 3 min ago", or null when the feed is fine. */
export function staleNote(...sources: Array<{ error: string | null; at: number | null }>): string | null {
  const failed = sources.filter((source) => source.error);
  if (failed.length === 0) return null;
  const at = Math.min(...failed.map((source) => source.at ?? Infinity));
  const age = Number.isFinite(at) ? `آخر بيانات قبل ${since(new Date(at).toISOString())}` : 'لم تُحمَّل بعد';
  return `تعذر التحديث (${failed[0].error}) · ${age} · نعيد المحاولة تلقائياً`;
}
