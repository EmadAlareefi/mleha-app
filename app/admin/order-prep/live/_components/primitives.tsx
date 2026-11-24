'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2, Minimize2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from '../live.module.css';
import { useLiveMode } from './LiveMode';
import { useExpandable } from './useExpandable';

export { since, staleNote } from '../_lib/metrics';

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

/**
 * TV mode: a list taller than its panel scrolls itself slowly to the end,
 * rests, then jumps back to the top, so a screen nobody touches still shows
 * every row. Pauses while the pointer is over it.
 */
function useAutoScroll(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const SPEED = 18; // px per second
    const REST_MS = 4000;
    let frame = 0;
    let last = performance.now();
    let restUntil = last + REST_MS;
    let hovering = false;
    let position = el.scrollTop;
    const onEnter = () => (hovering = true);
    const onLeave = () => {
      hovering = false;
      position = el.scrollTop;
    };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const room = el.scrollHeight - el.clientHeight;
      if (!hovering && room > 8 && now >= restUntil) {
        if (el.scrollTop >= room - 1) {
          el.scrollTo({ top: 0, behavior: 'smooth' });
          position = 0;
          restUntil = now + REST_MS;
        } else {
          position = Math.min(room, position + (SPEED * dt) / 1000);
          el.scrollTop = position;
          if (position >= room) restUntil = now + REST_MS;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [enabled]);
  return ref;
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
  const { kiosk } = useLiveMode();
  const bodyRef = useAutoScroll(kiosk);
  const expand = useExpandable();
  return (
    <>
    <ExpandStage expand={expand} />
    <section
      ref={expand.sectionRef}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
      aria-label={expand.expanded ? title : undefined}
      className={cn(
        styles.enter,
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--lv-line)] shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_8px_24px_-12px_rgba(59,47,34,0.25)] backdrop-blur',
        expand.expanded
          ? 'fixed inset-2 z-50 rounded-3xl bg-[var(--lv-panel-solid)] shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_40px_120px_-30px_rgba(31,25,18,0.75)] sm:inset-4 xl:inset-8'
          : 'h-full bg-[var(--lv-panel)]',
        tone === 'danger' && 'border-rose-200',
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--lv-line2)] px-4 py-2.5">
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--lv-chip)] text-[#8b6f47]">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <h2 className="text-sm font-extrabold text-[var(--lv-ink)]">{title}</h2>
        {count !== undefined && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
              count > 0 && tone === 'danger' ? 'bg-rose-600 text-white' : 'bg-[var(--lv-chip)] text-[var(--lv-muted)]',
            )}
          >
            {count}
          </span>
        )}
        <div className="mr-auto flex items-center gap-1.5">
          {actions}
          <ExpandButton expand={expand} title={title} className={actions ? 'mr-0.5' : undefined} />
        </div>
      </header>
      {stale && (
        <p role="status" className="flex shrink-0 items-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] font-semibold text-amber-900">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
          {stale}
        </p>
      )}
      <div ref={bodyRef} data-panel-body className={cn('min-h-0 flex-1 overflow-y-auto', styles.scroll, stale && 'opacity-60 saturate-50', bodyClassName)}>{children}</div>
    </section>
    </>
  );
}

type Expand = ReturnType<typeof useExpandable>;

/** While a card floats full screen: a placeholder holding its slot, and the dimmed backdrop behind it. */
export function ExpandStage({ expand }: { expand: Expand }) {
  if (!expand.expanded) return null;
  return (
    <>
      <div ref={expand.placeholderRef} aria-hidden className="shrink-0" style={{ height: expand.size?.height, width: '100%' }} />
      <div ref={expand.backdropRef} aria-hidden onClick={expand.close} className="fixed inset-0 z-50 bg-[#1f1912]/45 backdrop-blur-[6px]" />
    </>
  );
}

/** The ⤢ / ⤡ toggle at the end of a card's header. `dark` is for the dark hero band. */
export function ExpandButton({ expand, title, dark, className }: { expand: Expand; title: string; dark?: boolean; className?: string }) {
  const Icon = expand.expanded ? Minimize2 : Maximize2;
  return (
    <button
      ref={expand.buttonRef}
      type="button"
      onClick={expand.toggle}
      aria-expanded={expand.expanded}
      aria-label={expand.expanded ? `تصغير «${title}» (Esc)` : `عرض «${title}» بملء الشاشة`}
      title={expand.expanded ? 'تصغير (Esc)' : 'ملء الشاشة'}
      className={cn(
        'group/expand relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition duration-200 hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-[#e8c896] focus-visible:outline-none',
        dark
          ? cn('text-white/45 hover:bg-white/10 hover:text-white', expand.expanded && 'bg-white/10 text-white')
          : cn('text-[var(--lv-faint)] hover:bg-[var(--lv-chip)] hover:text-[#8b6f47]', expand.expanded && 'bg-[var(--lv-chip)] text-[#8b6f47]'),
        className,
      )}
    >
      <Icon key={expand.expanded ? 'min' : 'max'} className={cn('h-4 w-4 transition-transform duration-300 group-hover/expand:rotate-90', styles.iconSwap)} />
    </button>
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
  showValues,
}: {
  segments: Array<{ key: string; value: number; color: string; label: string }>;
  className?: string;
  /** Print each segment's count inside it when the segment is wide enough to hold it. */
  showValues?: boolean;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return (
    <div className={cn('flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--lv-track)]', className)}>
      {total > 0 &&
        segments.map((segment) =>
          segment.value > 0 ? (
            <span
              key={segment.key}
              title={`${segment.label}: ${segment.value}`}
              className={cn(
                'h-full first:rounded-r-full last:rounded-l-full',
                showValues && 'flex items-center justify-center overflow-hidden text-[10px] leading-none font-black text-white tabular-nums',
                segment.color,
              )}
              style={{ width: `${(segment.value / total) * 100}%`, transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)' }}
            >
              {showValues && segment.value / total >= 0.12 ? segment.value : null}
            </span>
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
      <p className="mt-2 text-sm font-bold text-[var(--lv-ink)]">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--lv-muted)]">{hint}</p>}
    </div>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-xl bg-[var(--lv-track)]" style={{ animationDelay: `${index * 120}ms` }} />
      ))}
    </div>
  );
}
