import { formatDuration } from '@/app/lib/analytics/stats';
import type { DrillRef, KpiFormat } from '@/app/lib/analytics/report';

/** Display helpers for the warehouse report. */

const integer = new Intl.NumberFormat('en-US');

export function formatValue(value: number | null, format: KpiFormat): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'pct':
      return `${value.toFixed(value >= 99.95 || value === 0 ? 0 : 1)}%`;
    case 'duration':
      return formatDuration(value);
    case 'rate':
      return value.toFixed(1);
    case 'signed':
      return value > 0 ? `+${integer.format(value)}` : value < 0 ? `−${integer.format(-value)}` : '0';
    default:
      return integer.format(Math.round(value));
  }
}

export const formatCount = (value: number) => integer.format(value);

export type Delta = { text: string; tone: 'good' | 'bad' | 'flat'; arrow: '↑' | '↓' | '→' };

/** Change against the previous period: points for percentages, relative % otherwise. */
export function delta(value: number | null, previous: number | null, format: KpiFormat, better: 'up' | 'down' | 'none'): Delta | null {
  if (value === null || previous === null || !Number.isFinite(value) || !Number.isFinite(previous)) return null;
  const diff = value - previous;
  let text: string;
  let flat: boolean;
  if (format === 'pct') {
    flat = Math.abs(diff) < 0.5;
    text = `${Math.abs(diff).toFixed(1)} نقطة`;
  } else if (format === 'signed') {
    flat = diff === 0;
    text = integer.format(Math.abs(Math.round(diff)));
  } else {
    if (previous === 0) return value === 0 ? { text: 'دون تغيير', tone: 'flat', arrow: '→' } : null;
    const change = (diff / Math.abs(previous)) * 100;
    flat = Math.abs(change) < 2;
    text = `${Math.abs(change).toFixed(Math.abs(change) < 10 ? 1 : 0)}%`;
  }
  if (flat) return { text: 'دون تغيير', tone: 'flat', arrow: '→' };
  const up = diff > 0;
  const tone = better === 'none' ? 'flat' : (better === 'up') === up ? 'good' : 'bad';
  return { text, tone, arrow: up ? '↑' : '↓' };
}

export type OpenDrill = (drill: DrillRef) => void;
