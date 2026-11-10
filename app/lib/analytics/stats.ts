/** Small, pure statistics helpers for the board analytics (unit tested). */

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Linear-interpolated percentile (0–1) of the values. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export const median = (values: number[]) => percentile(values, 0.5);

export type DurationBucket = { key: string; label: string; maxSec: number | null };

/** Buckets for "time per order"; the last one holds breaks. */
export const DURATION_BUCKETS: DurationBucket[] = [
  // Words, not "1–2": a digit range inside Arabic text gets reordered by the browser.
  { key: 'lt1', label: 'أقل من دقيقة', maxSec: 60 },
  { key: '1to2', label: 'من 1 إلى 2 دقيقة', maxSec: 120 },
  { key: '2to3', label: 'من 2 إلى 3 دقائق', maxSec: 180 },
  { key: '3to5', label: 'من 3 إلى 5 دقائق', maxSec: 300 },
  { key: '5to10', label: 'من 5 إلى 10 دقائق', maxSec: 600 },
  { key: '10to30', label: 'من 10 إلى 30 دقيقة', maxSec: 1800 },
  { key: 'break', label: 'توقف', maxSec: null },
];

/** Bucket key for a duration; `breakSec` decides where breaks start. */
export function bucketOf(seconds: number, breakSec: number): string {
  if (seconds > breakSec) return 'break';
  for (const bucket of DURATION_BUCKETS) {
    if (bucket.maxSec !== null && seconds < bucket.maxSec) return bucket.key;
  }
  return '10to30';
}

/** Mean / median / p90 of the durations that aren't breaks. */
export function summarize(durations: Array<number | null | undefined>, breakSec: number) {
  const valid = durations.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const working = valid.filter((value) => value <= breakSec);
  return {
    count: valid.length,
    breaks: valid.length - working.length,
    avg: mean(working),
    median: median(working),
    p90: percentile(working, 0.9),
    max: working.length ? Math.max(...working) : null,
    totalWorkingSec: working.reduce((sum, value) => sum + value, 0),
  };
}

/** "2:35 د", "45 ث", "3.2 س", "2.1 يوم". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} ث`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} د`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)} س`;
  return `${(s / 86_400).toFixed(1)} يوم`;
}
