/** Shapes shared by the board analytics API and the boards' client. */

export type AnalyticsKind = 'prep' | 'shipping';

/** What a clicked number stands for: a metric, and which of its orders. */
export type DrillFilter = {
  metric: string;
  /** all | slow | breaks | scanned | manual | bucket */
  subset?: string;
  bucket?: string;
  person?: string;
};

export type AnalyticsTile = {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn' | 'danger';
  filter: DrillFilter;
};

export type AnalyticsBucket = { key: string; label: string; count: number; filter: DrillFilter };

export type AnalyticsPerson = {
  name: string;
  count: number;
  avgSec: number | null;
  medianSec: number | null;
  p90Sec: number | null;
  perHour: number | null;
  scanPct: number | null;
  maxSec: number | null;
  breaks: number;
};

export type AnalyticsSummary = {
  kind: AnalyticsKind;
  period: { from: string; to: string; label: string; key: string };
  generatedAt: string;
  /** Metric the duration buckets and people table describe. */
  mainMetric: string;
  mainMetricLabel: string;
  tiles: AnalyticsTile[];
  buckets: AnalyticsBucket[];
  people: AnalyticsPerson[];
};

export type TimelineStep = { label: string; at: string | null; by?: string | null };

export type DrillRow = {
  orderId: string;
  orderNumber: string;
  person: string | null;
  valueSec: number | null;
  isBreak: boolean;
  at: string | null;
  tags: string[];
  note?: string | null;
  timeline: TimelineStep[];
};

export type DrillResponse = {
  title: string;
  metricLabel: string;
  count: number;
  avgSec: number | null;
  medianSec: number | null;
  rows: DrillRow[];
  nextOffset: number | null;
};

export type OrderItemsDetail = {
  items: Array<{ name: string; size: string | null; color: string | null; quantity: number; imageUrl: string | null; sku: string | null }>;
  sallaUrl: string | null;
};
