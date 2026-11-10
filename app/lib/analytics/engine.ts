import { bucketOf, DURATION_BUCKETS, summarize } from './stats';
import type {
  AnalyticsBucket,
  AnalyticsPerson,
  DrillFilter,
  DrillResponse,
  DrillRow,
  TimelineStep,
} from './types';

/**
 * The shared part of the board analytics: one row per order with every
 * duration already computed, then the same filtering / grouping for any
 * number a supervisor clicks. Pure, so it's unit tested.
 */

export type FactRow = {
  orderId: string;
  orderNumber: string;
  person: string | null;
  at: Date | null;
  metrics: Record<string, number | null>;
  scanMethod?: string | null;
  tags: string[];
  note?: string | null;
  timeline: TimelineStep[];
};

export type MetricDef = { key: string; label: string; breakSec: number; slowSec?: number };

export type Facts = {
  /** One row per packed / printed order. */
  rows: FactRow[];
  /** Plain lists behind counts (problems, failures). */
  lists: Record<string, { label: string; rows: FactRow[] }>;
};

const PAGE = 100;

function matches(row: FactRow, filter: DrillFilter, def: MetricDef | undefined): boolean {
  if (filter.person && (row.person ?? '—') !== filter.person) return false;
  const value = def ? row.metrics[def.key] : null;
  switch (filter.subset) {
    case 'scanned':
      return row.scanMethod === 'scan';
    case 'manual':
      return row.scanMethod !== 'scan';
    case 'breaks':
      return def ? typeof value === 'number' && value > def.breakSec : false;
    case 'slow':
      return def ? typeof value === 'number' && value > (def.slowSec ?? def.breakSec) && value <= def.breakSec : false;
    case 'bucket':
      return def && filter.bucket ? typeof value === 'number' && bucketOf(value, def.breakSec) === filter.bucket : false;
    case 'measured':
      return def ? typeof value === 'number' : true;
    default:
      return true;
  }
}

export function drill(
  facts: Facts,
  defs: MetricDef[],
  filter: DrillFilter,
  options: { sort?: 'duration' | 'time'; offset?: number; title?: string } = {},
): DrillResponse {
  const list = facts.lists[filter.metric];
  const def = defs.find((entry) => entry.key === filter.metric);
  const source = list ? list.rows : facts.rows;
  const filtered = source.filter((row) => matches(row, filter, list ? undefined : def));
  const valueOf = (row: FactRow) => (def ? row.metrics[def.key] ?? null : null);
  const sorted = [...filtered].sort((a, b) => {
    if (options.sort !== 'time' && def) {
      const left = valueOf(a);
      const right = valueOf(b);
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      if (left !== null && right !== null && left !== right) return right - left;
    }
    return (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0);
  });
  const offset = Math.max(0, options.offset ?? 0);
  const page = sorted.slice(offset, offset + PAGE);
  const stats = def ? summarize(filtered.map(valueOf), def.breakSec) : null;
  const rows: DrillRow[] = page.map((row) => {
    const value = valueOf(row);
    return {
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      person: row.person,
      valueSec: value,
      isBreak: Boolean(def && typeof value === 'number' && value > def.breakSec),
      at: row.at ? row.at.toISOString() : null,
      tags: row.tags,
      note: row.note ?? null,
      timeline: row.timeline,
    };
  });
  return {
    title: options.title ?? list?.label ?? def?.label ?? '',
    metricLabel: def?.label ?? list?.label ?? '',
    count: filtered.length,
    avgSec: stats?.avg ?? null,
    medianSec: stats?.median ?? null,
    rows,
    nextOffset: offset + PAGE < sorted.length ? offset + PAGE : null,
  };
}

export function bucketsFor(rows: FactRow[], def: MetricDef): AnalyticsBucket[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row.metrics[def.key];
    if (typeof value !== 'number') continue;
    const key = bucketOf(value, def.breakSec);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return DURATION_BUCKETS.filter((bucket) => bucket.key === 'break' || (bucket.maxSec !== null && bucket.maxSec <= def.breakSec)).map(
    (bucket) => ({
      key: bucket.key,
      label: bucket.key === 'break' ? `توقف (أكثر من ${Math.round(def.breakSec / 60)} دقيقة)` : bucket.label,
      count: counts.get(bucket.key) ?? 0,
      filter: { metric: def.key, subset: 'bucket', bucket: bucket.key },
    }),
  );
}

export function peopleFor(rows: FactRow[], def: MetricDef, options: { withScan?: boolean } = {}): AnalyticsPerson[] {
  const groups = new Map<string, FactRow[]>();
  for (const row of rows) {
    const name = row.person ?? '—';
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([name, group]) => {
      const stats = summarize(group.map((row) => row.metrics[def.key]), def.breakSec);
      const working = stats.count - stats.breaks;
      return {
        name,
        count: group.length,
        avgSec: stats.avg,
        medianSec: stats.median,
        p90Sec: stats.p90,
        // Orders per hour of actual work (breaks left out).
        perHour: stats.totalWorkingSec > 0 ? Math.round((working / (stats.totalWorkingSec / 3600)) * 10) / 10 : null,
        scanPct: options.withScan ? Math.round((group.filter((row) => row.scanMethod === 'scan').length / group.length) * 100) : null,
        maxSec: stats.max,
        breaks: stats.breaks,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Short-lived cache so clicking around the board doesn't re-query. */
const cache = new Map<string, { at: number; value: Facts }>();
export async function cachedFacts(key: string, load: () => Promise<Facts>, ttlMs = 30_000): Promise<Facts> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 30) cache.delete(cache.keys().next().value as string);
  return value;
}

export const secondsBetween = (start: Date | null | undefined, end: Date | null | undefined): number | null =>
  start && end ? Math.max(0, (end.getTime() - start.getTime()) / 1000) : null;
