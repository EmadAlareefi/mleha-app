import { RIYADH_OFFSET_MS } from '@/app/lib/order-prep/riyadh-time';
import type { Facts, FactRow } from './engine';
import { periodDays, type Period } from './period';
import { formatDuration, median, percentile, summarize } from './stats';
import type { AnalyticsKind, DrillFilter } from './types';

/**
 * The warehouse report behind «التحليلات»: is the promise kept (shipped within
 * 24h), is the warehouse keeping up with demand, where an order's time goes,
 * who and when, and what goes wrong. Pure: built from the prep / shipping
 * facts plus a few counts, so every number is unit tested and every number
 * drills into the same rows the orders drawer lists.
 */

export const SLA_SEC = 24 * 3600;
const SLA2_SEC = 48 * 3600;
const PACK_BREAK_SEC = 1800;
const SHIP_BREAK_SEC = 600;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type DrillRef = { kind: AnalyticsKind; title: string; filter: DrillFilter };

export type KpiFormat = 'pct' | 'duration' | 'count' | 'rate' | 'signed';

export type ReportKpi = {
  key: string;
  label: string;
  value: number | null;
  previous: number | null;
  format: KpiFormat;
  /** Which direction is good news; 'none' shows the change without colour. */
  better: 'up' | 'down' | 'none';
  sub?: string;
  hint: string;
  series: number[];
  drill?: DrillRef;
};

export type ReportStage = { key: string; label: string; hint: string; medianSec: number | null; p90Sec: number | null; count: number; drill: DrillRef };

export type ReportBucket = { key: string; label: string; count: number; late: boolean; drill: DrillRef };

export type TeamRow = {
  name: string;
  count: number;
  workingHours: number;
  perHour: number | null;
  medianSec: number | null;
  p90Sec: number | null;
  breaks: number;
  scanPct: number | null;
  shortages: number | null;
  wrongItems: number | null;
  daily: number[];
};

export type Insight = {
  key: string;
  tone: 'danger' | 'warn' | 'info' | 'good';
  title: string;
  detail: string;
  drill?: DrillRef;
  /** Section id on the page to scroll to. */
  target?: string;
};

export type WarehouseReport = {
  period: { from: string; to: string; label: string; key: string; days: number };
  previous: { from: string; to: string; label: string };
  generatedAt: string;
  granularity: 'hour' | 'day';
  kpis: ReportKpi[];
  /** Shipped per day, for "days to clear the backlog" (the backlog itself is live data on the page). */
  printedPerDay: number;
  flow: { labels: string[]; placed: number[]; packed: number[]; printed: number[]; backlog: number[] };
  stages: ReportStage[];
  lifeMedianSec: number | null;
  lifeP90Sec: number | null;
  ageBuckets: ReportBucket[];
  /** [weekday 0 = Sunday][Riyadh hour] */
  heatmap: { placed: number[][]; packed: number[][]; printed: number[][] };
  team: { packers: TeamRow[]; shippers: TeamRow[] };
  quality: {
    packed: number;
    returns: number;
    returnPct: number | null;
    wrongItem: number;
    defective: number;
    wrongPer1000: number | null;
    defectivePer1000: number | null;
    byPacker: Array<{ name: string; packed: number; wrong: number; defective: number; per1000: number | null }>;
  };
  shortages: {
    count: number;
    orders: number;
    per100: number | null;
    open: number;
    byReason: Array<{ key: string; label: string; count: number }>;
    topSkus: Array<{ sku: string; name: string | null; count: number; share: number }>;
  };
  exceptions: { count: number; byReason: Array<{ key: string; label: string; count: number }> };
  /** False when scanning is switched off: the page hides the scan column. */
  scanEnabled: boolean;
  failures: { shipping: number; syncFailed: number; syncConflict: number; labelWaitMedianSec: number | null; labelWaitP90Sec: number | null };
  carriers: Array<{ name: string; count: number; share: number; onTimePct: number | null; medianPlacedToPrintedSec: number | null; medianPackedToPrintedSec: number | null }>;
  insights: Insight[];
};

export type ReportInputs = {
  period: Period;
  prep: Facts;
  shipping: Facts;
  /** Orders placed per UTC hour (cancelled and unpaid left out). */
  placedHours: Array<{ hour: Date; count: number }>;
  sync: { failed: number; conflict: number };
  /** The prep scan setting; with scanning switched off the scan numbers mean nothing. */
  scanMode?: 'optional' | 'required' | 'off';
};

const SHORTAGE_LABELS: Record<string, string> = { not_found: 'غير موجود', damaged: 'تالف', coming_soon: 'سيتوفر قريباً', other: 'أخرى' };
const ESCALATION_LABELS: Record<string, string> = {
  missing_items: 'نقص (X4)',
  coming_soon: 'سيتوفر قريباً',
  manual_review: 'مراجعة',
  promo_limit: 'حد عرض الريال',
};

const num = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const pct = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100) : null);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export const riyadhWeekdayHour = (ms: number) => {
  const local = new Date(ms + RIYADH_OFFSET_MS);
  return { weekday: local.getUTCDay(), hour: local.getUTCHours() };
};

export const hourLabel = (hour: number) => (hour === 0 ? '12ص' : hour < 12 ? `${hour}ص` : hour === 12 ? '12م' : `${hour - 12}م`);
export const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** Time buckets for the period: hours of one day, or Riyadh days. */
export function timeBuckets(period: { from: Date; to: Date }) {
  const days = periodDays(period);
  const granularity: 'hour' | 'day' = days === 1 ? 'hour' : 'day';
  const size = granularity === 'hour' ? HOUR_MS : DAY_MS;
  const count = granularity === 'hour' ? 24 : days;
  const start = period.from.getTime();
  const labels = Array.from({ length: count }, (_, index) => {
    if (granularity === 'hour') return hourLabel(index);
    const local = new Date(start + index * DAY_MS + RIYADH_OFFSET_MS);
    return `${local.getUTCDate()}/${local.getUTCMonth() + 1}`;
  });
  const indexOf = (ms: number) => {
    const index = Math.floor((ms - start) / size);
    return index >= 0 && index < count ? index : -1;
  };
  return { granularity, count, labels, indexOf };
}

function countInto(times: Array<number | null | undefined>, buckets: ReturnType<typeof timeBuckets>): number[] {
  const out = Array<number>(buckets.count).fill(0);
  for (const ms of times) {
    if (!num(ms)) continue;
    const index = buckets.indexOf(ms);
    if (index >= 0) out[index] += 1;
  }
  return out;
}

function heat(times: Array<{ ms: number; count: number }>): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const { ms, count } of times) {
    const { weekday, hour } = riyadhWeekdayHour(ms);
    grid[weekday][hour] += count;
  }
  return grid;
}

function team(rows: FactRow[], metric: string, breakSec: number, buckets: ReturnType<typeof timeBuckets>, extra?: (name: string, group: FactRow[]) => Partial<TeamRow>): TeamRow[] {
  const groups = new Map<string, FactRow[]>();
  for (const row of rows) {
    const name = row.person ?? '—';
    const group = groups.get(name);
    if (group) group.push(row);
    else groups.set(name, [row]);
  }
  return [...groups.entries()]
    .map(([name, group]) => {
      const stats = summarize(group.map((row) => row.metrics[metric]), breakSec);
      const working = stats.count - stats.breaks;
      return {
        name,
        count: group.length,
        workingHours: round(stats.totalWorkingSec / 3600),
        perHour: stats.totalWorkingSec > 0 ? round(working / (stats.totalWorkingSec / 3600)) : null,
        medianSec: stats.median,
        p90Sec: stats.p90,
        breaks: stats.breaks,
        scanPct: null,
        shortages: null,
        wrongItems: null,
        daily: countInto(group.map((row) => row.at?.getTime()), buckets),
        ...extra?.(name, group),
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** The numbers both periods need, so the current one can compare with the previous. */
export function coreNumbers(inputs: ReportInputs) {
  const { prep, shipping } = inputs;
  const printedRows = shipping.rows;
  const lead = printedRows.map((row) => row.metrics.placedToPrinted).filter(num);
  const onTime = lead.filter((value) => value <= SLA_SEC).length;
  const onTime48 = lead.filter((value) => value <= SLA2_SEC).length;
  const pack = summarize(prep.rows.map((row) => row.metrics.pack), PACK_BREAK_SEC);
  const gap = summarize(printedRows.map((row) => row.metrics.gap), SHIP_BREAK_SEC);
  const placed = sum(inputs.placedHours.map((entry) => Number(entry.count)));
  const scanned = prep.rows.filter((row) => row.scanMethod === 'scan').length;
  return {
    placed,
    packed: prep.rows.length,
    printed: printedRows.length,
    leadMeasured: lead.length,
    onTimePct: pct(onTime, lead.length),
    onTime48Pct: pct(onTime48, lead.length),
    late: lead.length - onTime,
    leadMedian: median(lead),
    leadP90: percentile(lead, 0.9),
    packPerHour: pack.totalWorkingSec > 0 ? round((pack.count - pack.breaks) / (pack.totalWorkingSec / 3600)) : null,
    packMedian: pack.median,
    shipPerHour: gap.totalWorkingSec > 0 ? round((gap.count - gap.breaks) / (gap.totalWorkingSec / 3600)) : null,
    scanPct: pct(scanned, prep.rows.length),
    net: placed - printedRows.length,
  };
}

export type CoreNumbers = ReturnType<typeof coreNumbers>;

export function buildReport(inputs: ReportInputs, previousInputs: ReportInputs | null, nowMs: number = Date.now()): WarehouseReport {
  const { period, prep, shipping } = inputs;
  const core = coreNumbers(inputs);
  const prev = previousInputs ? coreNumbers(previousInputs) : null;
  const days = periodDays(period);
  const buckets = timeBuckets(period);

  // Flow: in vs out per bucket, and the running backlog change.
  const placedSeries = Array<number>(buckets.count).fill(0);
  for (const entry of inputs.placedHours) {
    const index = buckets.indexOf(entry.hour.getTime());
    if (index >= 0) placedSeries[index] += Number(entry.count);
  }
  const packedSeries = countInto(prep.rows.map((row) => row.at?.getTime()), buckets);
  const printedSeries = countInto(shipping.rows.map((row) => row.at?.getTime()), buckets);
  let running = 0;
  const backlogSeries = placedSeries.map((value, index) => (running += value - printedSeries[index]));

  // Daily on-time % and lead time, for the hero sparklines.
  const leadByBucket = Array.from({ length: buckets.count }, () => [] as number[]);
  for (const row of shipping.rows) {
    const value = row.metrics.placedToPrinted;
    const index = row.at ? buckets.indexOf(row.at.getTime()) : -1;
    if (num(value) && index >= 0) leadByBucket[index].push(value);
  }
  const onTimeSeries = leadByBucket.map((values) => (values.length ? (values.filter((value) => value <= SLA_SEC).length / values.length) * 100 : 0));
  const leadSeries = leadByBucket.map((values) => (median(values) ?? 0) / 3600);

  const ship = (title: string, filter: DrillFilter): DrillRef => ({ kind: 'shipping', title, filter });
  const prepDrill = (title: string, filter: DrillFilter): DrillRef => ({ kind: 'prep', title, filter });

  const kpis: ReportKpi[] = [
    {
      key: 'onTime',
      label: 'شُحنت خلال 24 ساعة',
      value: core.onTimePct,
      previous: prev?.onTimePct ?? null,
      format: 'pct',
      better: 'up',
      sub: core.leadMeasured ? `خلال 48 ساعة: ${core.onTime48Pct}% · ${core.late} متأخرة` : undefined,
      hint: 'من البوالص المطبوعة في الفترة: كم طلباً طُبعت بوليصته خلال 24 ساعة من وصوله. هذا وعدنا للعميل.',
      series: onTimeSeries,
      drill: ship('متأخرة أكثر من 24 ساعة', { metric: 'placedToPrinted', subset: 'slow' }),
    },
    {
      key: 'lead',
      label: 'عمر الطلب حتى الشحن',
      value: core.leadMedian,
      previous: prev?.leadMedian ?? null,
      format: 'duration',
      better: 'down',
      sub: `الوسيط · 90% خلال ${formatDuration(core.leadP90)}`,
      hint: 'من وصول الطلب حتى طباعة البوليصة. الوسيط: نصف الطلبات أسرع منه. و90%: حد أبطأ الطلبات تقريباً.',
      series: leadSeries,
      drill: ship('عمر الطلب حتى الشحن', { metric: 'placedToPrinted', subset: 'measured' }),
    },
    {
      key: 'printed',
      label: 'طلبات شُحنت',
      value: core.printed,
      previous: prev?.printed ?? null,
      format: 'count',
      better: 'up',
      sub: `${round(core.printed / days)} يومياً · ${core.packed} مجهّزة`,
      hint: 'البوالص المطبوعة في الفترة (كل الصفحات).',
      series: printedSeries,
      drill: ship('البوالص المطبوعة', { metric: 'gap', subset: 'all' }),
    },
    {
      key: 'placed',
      label: 'طلبات واردة',
      value: core.placed,
      previous: prev?.placed ?? null,
      format: 'count',
      better: 'none',
      sub: `${round(core.placed / days)} يومياً`,
      hint: 'الطلبات التي وصلت في الفترة، دون الملغاة وغير المدفوعة. هذا حجم العمل القادم.',
      series: placedSeries,
    },
    {
      key: 'net',
      label: 'صافي المتراكم',
      value: core.net,
      previous: prev?.net ?? null,
      format: 'signed',
      better: 'down',
      sub: core.net > 0 ? 'الوارد أكثر من المشحون — المتراكم يكبر' : core.net < 0 ? 'شحنّا أكثر من الوارد — المتراكم يصغر' : 'متوازن',
      hint: 'الواردة ناقص المشحونة. موجب يعني أن الطلبات تتكدس؛ سالب يعني أننا نلحق بالمتأخر.',
      series: backlogSeries,
    },
    {
      key: 'packRate',
      label: 'إنتاجية المجهِّز',
      value: core.packPerHour,
      previous: prev?.packPerHour ?? null,
      format: 'rate',
      better: 'up',
      sub: `طلب/ساعة عمل · وسيط الطلب ${formatDuration(core.packMedian)}`,
      hint: 'طلبات لكل ساعة تجهيز فعلية (فترات التوقف فوق 30 دقيقة مستبعدة).',
      series: packedSeries,
      drill: prepDrill('وقت التجهيز للطلب', { metric: 'pack', subset: 'measured' }),
    },
    {
      key: 'shipRate',
      label: 'إنتاجية الشاحن',
      value: core.shipPerHour,
      previous: prev?.shipPerHour ?? null,
      format: 'rate',
      better: 'up',
      sub: 'بوليصة/ساعة عمل',
      hint: 'بوالص لكل ساعة شحن فعلية (فترات التوقف فوق 10 دقائق مستبعدة).',
      series: printedSeries,
      drill: ship('وقت الشاحن للطلب', { metric: 'gap', subset: 'measured' }),
    },
  ];

  // Where the time goes: each stage's median over the packed orders.
  const stageDefs: Array<{ key: string; label: string; hint: string; kind: AnalyticsKind; metric: string }> = [
    { key: 'queue', label: 'انتظار التجهيز', hint: 'من وصول الطلب حتى فتحه على شاشة المجهِّز (يشمل المراجعة والدفع والطابور)', kind: 'prep', metric: 'queue' },
    { key: 'pack', label: 'التجهيز', hint: 'من ظهور الطلب على الشاشة حتى «تم»', kind: 'prep', metric: 'pack' },
    { key: 'toLabel', label: 'إصدار البوليصة', hint: 'من «تم» حتى جاهزية البوليصة من شركة الشحن', kind: 'prep', metric: 'toLabel' },
    { key: 'labelToPrint', label: 'الطباعة', hint: 'من جاهزية البوليصة حتى طباعتها في محطة الشحن', kind: 'prep', metric: 'labelToPrint' },
  ];
  const stages: ReportStage[] = stageDefs.map((stage) => {
    const values = prep.rows.map((row) => row.metrics[stage.metric]).filter(num);
    const working = stage.metric === 'pack' ? values.filter((value) => value <= PACK_BREAK_SEC) : values;
    return {
      key: stage.key,
      label: stage.label,
      hint: stage.hint,
      medianSec: median(working),
      p90Sec: percentile(working, 0.9),
      count: working.length,
      drill: { kind: stage.kind, title: `${stage.label} — الأبطأ أولاً`, filter: { metric: stage.metric, subset: 'measured' } },
    };
  });

  // Age at shipping, around the 24h promise.
  const AGE: Array<{ key: string; label: string; min: number; max: number | null }> = [
    { key: 'lt6', label: 'أقل من 6 س', min: 0, max: 6 * 3600 },
    { key: '6to12', label: '6 – 12 س', min: 6 * 3600, max: 12 * 3600 },
    { key: '12to24', label: '12 – 24 س', min: 12 * 3600, max: SLA_SEC },
    { key: '24to48', label: 'يوم – يومان', min: SLA_SEC, max: SLA2_SEC },
    { key: '48to72', label: 'يومان – 3', min: SLA2_SEC, max: 72 * 3600 },
    { key: 'gt72', label: 'أكثر من 3 أيام', min: 72 * 3600, max: null },
  ];
  const lead = shipping.rows.map((row) => row.metrics.placedToPrinted).filter(num);
  const ageBuckets: ReportBucket[] = AGE.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: lead.filter((value) => value >= bucket.min && (bucket.max === null || value < bucket.max)).length,
    late: bucket.min >= SLA_SEC,
    drill: ship(`عمر الطلب عند الشحن: ${bucket.label}`, {
      metric: 'placedToPrinted',
      subset: 'range',
      minSec: bucket.min,
      maxSec: bucket.max ?? undefined,
    }),
  }));

  // Packing errors traced from returns.
  const wrongRows = prep.lists.returns_wrong_item?.rows ?? [];
  const defectiveRows = prep.lists.returns_defective?.rows ?? [];
  const returnsRows = prep.lists.returns?.rows ?? [];
  const countBy = (rows: FactRow[]) => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.person ?? '—', (map.get(row.person ?? '—') ?? 0) + 1);
    return map;
  };
  const wrongBy = countBy(wrongRows);
  const defectiveBy = countBy(defectiveRows);

  // Shortages.
  const shortageRows = prep.lists.shortages?.rows ?? [];
  const shortageBy = countBy(shortageRows);
  const skuMap = new Map<string, { sku: string; name: string | null; count: number }>();
  const reasonMap = new Map<string, number>();
  for (const row of shortageRows) {
    const sku = row.sku ?? '—';
    const entry = skuMap.get(sku) ?? { sku, name: row.itemName ?? null, count: 0 };
    entry.count += 1;
    entry.name = entry.name ?? row.itemName ?? null;
    skuMap.set(sku, entry);
    const reason = row.reason ?? 'not_found';
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
  }
  const shortageOrders = new Set(shortageRows.map((row) => row.orderId)).size;
  const topSkus = [...skuMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((entry) => ({ ...entry, share: round((entry.count / Math.max(1, shortageRows.length)) * 100) }));

  const packers = team(prep.rows, 'pack', PACK_BREAK_SEC, buckets, (name, group) => ({
    scanPct: pct(group.filter((row) => row.scanMethod === 'scan').length, group.length),
    shortages: shortageBy.get(name) ?? 0,
    wrongItems: wrongBy.get(name) ?? 0,
  }));
  const shippers = team(shipping.rows, 'gap', SHIP_BREAK_SEC, buckets);

  // Exceptions.
  const problems = prep.lists.problems?.rows ?? [];
  const escalationReasons = new Map<string, number>();
  for (const row of problems) escalationReasons.set(row.reason ?? 'other', (escalationReasons.get(row.reason ?? 'other') ?? 0) + 1);

  // Carriers.
  const carrierMap = new Map<string, FactRow[]>();
  for (const row of shipping.rows) {
    const name = row.courier || '—';
    const group = carrierMap.get(name);
    if (group) group.push(row);
    else carrierMap.set(name, [row]);
  }
  const carriers = [...carrierMap.entries()]
    .map(([name, group]) => {
      const leadTimes = group.map((row) => row.metrics.placedToPrinted).filter(num);
      return {
        name,
        count: group.length,
        share: round((group.length / Math.max(1, shipping.rows.length)) * 100),
        onTimePct: pct(leadTimes.filter((value) => value <= SLA_SEC).length, leadTimes.length),
        medianPlacedToPrintedSec: median(leadTimes),
        medianPackedToPrintedSec: median(group.map((row) => row.metrics.packedToPrinted).filter(num)),
      };
    })
    .sort((a, b) => b.count - a.count);

  const labelWait = shipping.rows.map((row) => row.metrics.labelWait).filter(num);

  const report: WarehouseReport = {
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label, key: period.key, days },
    previous: previousInputs
      ? { from: previousInputs.period.from.toISOString(), to: previousInputs.period.to.toISOString(), label: previousInputs.period.label }
      : { from: '', to: '', label: '' },
    generatedAt: new Date(nowMs).toISOString(),
    granularity: buckets.granularity,
    kpis,
    printedPerDay: round(core.printed / days),
    flow: { labels: buckets.labels, placed: placedSeries, packed: packedSeries, printed: printedSeries, backlog: backlogSeries },
    stages,
    lifeMedianSec: core.leadMedian,
    lifeP90Sec: core.leadP90,
    ageBuckets,
    heatmap: {
      placed: heat(inputs.placedHours.map((entry) => ({ ms: entry.hour.getTime(), count: Number(entry.count) }))),
      packed: heat(prep.rows.filter((row) => row.at).map((row) => ({ ms: row.at!.getTime(), count: 1 }))),
      printed: heat(shipping.rows.filter((row) => row.at).map((row) => ({ ms: row.at!.getTime(), count: 1 }))),
    },
    team: { packers, shippers },
    quality: {
      packed: core.packed,
      returns: returnsRows.length,
      returnPct: pct(returnsRows.length, core.packed),
      wrongItem: wrongRows.length,
      defective: defectiveRows.length,
      wrongPer1000: core.packed ? round((wrongRows.length / core.packed) * 1000) : null,
      defectivePer1000: core.packed ? round((defectiveRows.length / core.packed) * 1000) : null,
      byPacker: packers
        .map((row) => {
          const wrong = wrongBy.get(row.name) ?? 0;
          const defective = defectiveBy.get(row.name) ?? 0;
          return { name: row.name, packed: row.count, wrong, defective, per1000: row.count ? round(((wrong + defective) / row.count) * 1000) : null };
        })
        .filter((row) => row.wrong + row.defective > 0)
        .sort((a, b) => b.wrong + b.defective - (a.wrong + a.defective)),
    },
    shortages: {
      count: shortageRows.length,
      orders: shortageOrders,
      per100: core.packed ? round((shortageOrders / core.packed) * 100) : null,
      open: shortageRows.filter((row) => !row.resolvedAt).length,
      byReason: [...reasonMap.entries()]
        .map(([key, count]) => ({ key, label: SHORTAGE_LABELS[key] ?? key, count }))
        .sort((a, b) => b.count - a.count),
      topSkus,
    },
    exceptions: {
      count: problems.length,
      byReason: [...escalationReasons.entries()]
        .map(([key, count]) => ({ key, label: ESCALATION_LABELS[key] ?? key, count }))
        .sort((a, b) => b.count - a.count),
    },
    failures: {
      shipping: shipping.lists.failed?.rows.length ?? 0,
      syncFailed: inputs.sync.failed,
      syncConflict: inputs.sync.conflict,
      labelWaitMedianSec: median(labelWait),
      labelWaitP90Sec: percentile(labelWait, 0.9),
    },
    carriers,
    scanEnabled: inputs.scanMode !== 'off',
    insights: [],
  };
  report.insights = buildInsights(report, core, prev);
  return report;
}

const TONE_ORDER: Record<Insight['tone'], number> = { danger: 0, warn: 1, info: 2, good: 3 };

/** «ماذا نفعل الآن؟»: the few things in this report worth acting on, worst first. */
export function buildInsights(report: WarehouseReport, core: CoreNumbers, prev: CoreNumbers | null): Insight[] {
  const out: Insight[] = [];
  const days = report.period.days;

  // 1. The promise.
  if (core.onTimePct !== null && core.leadMeasured >= 10) {
    if (core.onTimePct < 80) {
      out.push({
        key: 'sla',
        tone: core.onTimePct < 60 ? 'danger' : 'warn',
        title: `${core.onTimePct}% فقط شُحنت خلال 24 ساعة`,
        detail: `${core.late} طلباً تجاوزت الوعد. افتحها لترى أين تأخرت.`,
        drill: report.kpis.find((kpi) => kpi.key === 'onTime')?.drill,
      });
    } else if (core.onTimePct >= 95) {
      out.push({ key: 'sla', tone: 'good', title: `${core.onTimePct}% شُحنت خلال 24 ساعة`, detail: 'الوعد محفوظ. حافظوا على الإيقاع.' });
    }
  }

  // 2. Keeping up with demand.
  const netPerDay = core.net / days;
  if (core.placed >= 20 && netPerDay > Math.max(5, (core.placed / days) * 0.05)) {
    out.push({
      key: 'net',
      tone: 'warn',
      title: `الوارد يتجاوز الشحن بـ ${Math.round(netPerDay)} طلباً يومياً`,
      detail: 'المتراكم يكبر. زيدوا ساعات التجهيز أو الطاقم في أوقات الذروة.',
      target: 'flow',
    });
  } else if (core.placed >= 20 && netPerDay < -Math.max(5, (core.placed / days) * 0.05)) {
    out.push({ key: 'net', tone: 'good', title: `نلحق بالمتراكم: شحنّا ${Math.round(-netPerDay)} طلباً يومياً أكثر من الوارد`, detail: 'المتراكم يصغر.', target: 'flow' });
  }

  // 3. The bottleneck stage.
  const stageTotal = sum(report.stages.map((stage) => stage.medianSec ?? 0));
  const slowest = [...report.stages].sort((a, b) => (b.medianSec ?? 0) - (a.medianSec ?? 0))[0];
  if (slowest && slowest.medianSec !== null && stageTotal > 0 && slowest.count >= 10) {
    const share = Math.round((slowest.medianSec / stageTotal) * 100);
    if (share >= 40) {
      out.push({
        key: 'bottleneck',
        tone: share >= 60 ? 'warn' : 'info',
        title: `أبطأ مرحلة: ${slowest.label} (الوسيط ${formatDuration(slowest.medianSec)})`,
        detail: `${share}% من زمن الطلب يذهب هنا. تحسين هذه المرحلة يختصر أكثر من أي شيء آخر.`,
        drill: slowest.drill,
        target: 'stages',
      });
    }
  }

  // 4. Packing errors seen in returns.
  const { quality } = report;
  if (quality.wrongPer1000 !== null && quality.wrongItem >= 2 && quality.wrongPer1000 >= 2) {
    const top = quality.byPacker.find((row) => row.wrong > 0);
    out.push({
      key: 'wrong',
      tone: quality.wrongPer1000 >= 5 ? 'danger' : 'warn',
      title: `${quality.wrongItem} مرتجعات «منتج خاطئ» (${quality.wrongPer1000} لكل 1000 طلب)`,
      detail: top ? `أكثرها من طلبات ${top.name}. المسح عند التجهيز يمنع هذا الخطأ.` : 'المسح عند التجهيز يمنع هذا الخطأ.',
      drill: { kind: 'prep', title: 'مرتجع: منتج خاطئ', filter: { metric: 'returns_wrong_item' } },
      target: 'quality',
    });
  }

  // 5. Shortages concentrated on a few SKUs.
  const { shortages } = report;
  if (shortages.count >= 5 && shortages.topSkus.length > 0) {
    const top3 = shortages.topSkus.slice(0, 3);
    const share = Math.round(sum(top3.map((entry) => entry.share)));
    if (share >= 30) {
      out.push({
        key: 'shortSku',
        tone: 'warn',
        title: `${top3.length === 1 ? 'صنف واحد' : `${top3.length} أصناف`} = ${share}% من النقص`,
        detail: `${top3.map((entry) => entry.name || entry.sku).join('، ')}: راجعوا مواقعها في المستودع ومخزونها في سلة.`,
        drill: { kind: 'prep', title: 'النقص المُبلغ عنه', filter: { metric: 'shortages' } },
        target: 'quality',
      });
    }
  }

  // 6. Scanning discipline.
  if (report.scanEnabled && core.scanPct !== null && core.packed >= 20) {
    const drop = prev?.scanPct !== null && prev?.scanPct !== undefined ? prev.scanPct - core.scanPct : 0;
    if (core.scanPct < 70 || drop >= 10) {
      out.push({
        key: 'scan',
        tone: 'warn',
        title: `نسبة المسح ${core.scanPct}%${drop >= 10 ? ` (↓ ${Math.round(drop)} نقطة)` : ''}`,
        detail: 'الطلبات المؤكدة يدوياً أكثر عرضة لإرسال منتج خاطئ.',
        drill: { kind: 'prep', title: 'طلبات بدون مسح', filter: { metric: 'pack', subset: 'manual' } },
        target: 'team',
      });
    }
  }

  // 7. Productivity change.
  if (core.packPerHour !== null && prev?.packPerHour) {
    const change = ((core.packPerHour - prev.packPerHour) / prev.packPerHour) * 100;
    if (change <= -15 && core.packed >= 20) {
      out.push({
        key: 'packRate',
        tone: 'warn',
        title: `إنتاجية التجهيز انخفضت ${Math.round(-change)}%`,
        detail: `${core.packPerHour} طلب/ساعة مقابل ${prev.packPerHour} في ${report.previous.label}.`,
        target: 'team',
      });
    } else if (change >= 15 && core.packed >= 20) {
      out.push({ key: 'packRate', tone: 'good', title: `إنتاجية التجهيز ارتفعت ${Math.round(change)}%`, detail: `${core.packPerHour} طلب/ساعة.`, target: 'team' });
    }
  }

  // 8. When demand comes vs when we work (needs a full week to mean anything).
  if (days >= 7) {
    const byHour = (grid: number[][]) => Array.from({ length: 24 }, (_, hour) => sum(grid.map((row) => row[hour])));
    const peak = (values: number[]) => values.indexOf(Math.max(...values));
    const placedPeak = peak(byHour(report.heatmap.placed));
    const packedPeak = peak(byHour(report.heatmap.packed));
    const gap = Math.min(Math.abs(placedPeak - packedPeak), 24 - Math.abs(placedPeak - packedPeak));
    if (gap >= 4 && core.placed > 0 && core.packed > 0) {
      out.push({
        key: 'peaks',
        tone: 'info',
        title: `ذروة الطلبات ${hourLabel(placedPeak)} وذروة التجهيز ${hourLabel(packedPeak)}`,
        detail: 'رتّبوا المناوبات حسب خريطة الأوقات لتقصير انتظار الطلبات.',
        target: 'heatmap',
      });
    }
  }

  // 9. Integration failures that need a person.
  if (report.failures.syncFailed + report.failures.syncConflict + report.failures.shipping > 0) {
    out.push({
      key: 'failures',
      tone: 'warn',
      title: `${report.failures.shipping + report.failures.syncFailed + report.failures.syncConflict} أعطال تحتاج متابعة`,
      detail: [
        report.failures.shipping ? `${report.failures.shipping} شحن فاشل أو موقوف` : null,
        report.failures.syncFailed ? `${report.failures.syncFailed} تحديث سلة فاشل` : null,
        report.failures.syncConflict ? `${report.failures.syncConflict} تعارض حالة مع سلة` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      drill: report.failures.shipping ? { kind: 'shipping', title: 'فشل أو موقوف', filter: { metric: 'failed' } } : undefined,
      target: 'quality',
    });
  }

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]).slice(0, 5);
}
