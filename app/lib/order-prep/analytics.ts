import { prisma } from '@/lib/prisma';
import { bucketsFor, cachedFacts, peopleFor, secondsBetween, type Facts, type FactRow, type MetricDef } from '@/app/lib/analytics/engine';
import type { Period } from '@/app/lib/analytics/period';
import { formatDuration, summarize } from '@/app/lib/analytics/stats';
import type { AnalyticsSummary, AnalyticsTile } from '@/app/lib/analytics/types';
import { MERCHANT_ID } from './queue';
import { RIYADH_OFFSET_MS } from './riyadh-time';

/**
 * Packing analytics for the prep board: time per order and the orders behind
 * every number. Read-only, from OrderPrepAssignment and what shipping did
 * with each order afterwards.
 */

export const PREP_METRICS: MetricDef[] = [
  // On screen → Done. Over 30 min is a break, not packing.
  { key: 'pack', label: 'وقت التجهيز للطلب', breakSec: 1800, slowSec: 300 },
  { key: 'age', label: 'عمر الطلب عند التجهيز', breakSec: Number.MAX_SAFE_INTEGER },
  { key: 'toPrinted', label: 'من التجهيز حتى طباعة البوليصة', breakSec: Number.MAX_SAFE_INTEGER },
];

type PrepFactRow = {
  orderId: string;
  orderNumber: string | null;
  userName: string;
  assignedAt: Date;
  startedAt: Date | null;
  completedAt: Date;
  scanMethod: string | null;
  shortages: number;
  placedAt: Date | null;
  labelReadyAt: Date | null;
  printedAt: Date | null;
  printedBy: string | null;
};

type ProblemRow = {
  orderId: string;
  orderNumber: string | null;
  reason: string;
  statusTarget: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

const REASONS: Record<string, string> = {
  missing_items: 'نقص (X4)',
  coming_soon: 'سيتوفر قريباً',
  manual_review: 'مراجعة',
  promo_limit: 'حد عرض الريال',
};

/** placedAt is Riyadh wall-clock stored as UTC; shift it back to a real instant. */
const placedInstant = (placedAt: Date | null) => (placedAt ? new Date(placedAt.getTime() - RIYADH_OFFSET_MS) : null);

async function loadPrepFacts(period: Period): Promise<Facts> {
  const [rows, problems] = await Promise.all([
    prisma.$queryRaw<PrepFactRow[]>`
      SELECT a."orderId", a."orderNumber", a."userName", a."assignedAt", a."startedAt", a."completedAt", a."scanMethod",
        (SELECT count(*)::int FROM "OrderPrepUnavailableItem" u
          WHERE u."merchantId" = a."merchantId" AND u."orderId" = a."orderId") AS "shortages",
        o."placedAt", coalesce(s."createdAt", t."labelReadyAt") AS "labelReadyAt",
        coalesce(t."printedAt", s."labelPrintedAt") AS "printedAt",
        coalesce(t."printedByName", s."labelPrintedByName") AS "printedBy"
      FROM "OrderPrepAssignment" a
      LEFT JOIN "SallaOrder" o ON o."merchantId" = a."merchantId" AND o."orderId" = a."orderId"
      LEFT JOIN "ShippingTask" t ON t."merchantId" = a."merchantId" AND t."orderId" = a."orderId"
      LEFT JOIN "SallaShipment" s ON s."merchantId" = a."merchantId" AND s."orderId" = a."orderId"
      WHERE a."merchantId" = ${MERCHANT_ID}
        AND a.status = 'completed'
        AND a."completedAt" >= ${period.from} AND a."completedAt" < ${period.to}
    `,
    prisma.orderPrepEscalation.findMany({
      where: { merchantId: MERCHANT_ID, createdAt: { gte: period.from, lt: period.to } },
      select: {
        orderId: true,
        orderNumber: true,
        reason: true,
        statusTarget: true,
        notes: true,
        createdByName: true,
        createdAt: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<ProblemRow[]>,
  ]);

  const facts: FactRow[] = rows.map((row) => {
    const placed = placedInstant(row.placedAt);
    const tags = [row.scanMethod === 'scan' ? 'مسح' : 'يدوي'];
    if (row.shortages > 0) tags.push(`نقص ${row.shortages}`);
    return {
      orderId: row.orderId,
      orderNumber: row.orderNumber || row.orderId,
      person: row.userName?.trim() || null,
      at: row.completedAt,
      scanMethod: row.scanMethod,
      metrics: {
        pack: secondsBetween(row.startedAt, row.completedAt),
        age: secondsBetween(placed, row.completedAt),
        toPrinted: secondsBetween(row.completedAt, row.printedAt),
      },
      tags,
      timeline: [
        { label: 'وصل الطلب', at: placed?.toISOString() ?? null },
        { label: 'حُجز للمجهِّز', at: row.assignedAt.toISOString(), by: row.userName },
        { label: 'ظهر على الشاشة', at: row.startedAt?.toISOString() ?? null },
        { label: 'تم التجهيز', at: row.completedAt.toISOString(), by: row.userName },
        { label: 'البوليصة جاهزة', at: row.labelReadyAt?.toISOString() ?? null },
        { label: 'طُبعت البوليصة', at: row.printedAt?.toISOString() ?? null, by: row.printedBy },
      ],
    };
  });

  const problemRows: FactRow[] = problems.map((row) => ({
    orderId: row.orderId,
    orderNumber: row.orderNumber || row.orderId,
    person: row.createdByName?.trim() || null,
    at: row.createdAt,
    metrics: {},
    tags: [REASONS[row.reason] ?? row.reason, row.resolvedAt ? 'مُعالج' : 'مفتوح'],
    note: row.notes,
    timeline: [
      { label: 'سُجّلت المشكلة', at: row.createdAt.toISOString(), by: row.createdByName },
      { label: 'عولجت', at: row.resolvedAt?.toISOString() ?? null },
    ],
  }));

  return { rows: facts, lists: { problems: { label: 'المشاكل المسجلة', rows: problemRows } } };
}

export function getPrepFacts(period: Period) {
  return cachedFacts(`prep:${period.key}:${period.from.getTime()}:${Math.floor(period.to.getTime() / 30_000)}`, () =>
    loadPrepFacts(period),
  );
}

export async function getPrepAnalytics(period: Period): Promise<AnalyticsSummary> {
  const facts = await getPrepFacts(period);
  const [packDef, ageDef, printedDef] = PREP_METRICS;
  const pack = summarize(facts.rows.map((row) => row.metrics.pack), packDef.breakSec);
  const age = summarize(facts.rows.map((row) => row.metrics.age), ageDef.breakSec);
  const toPrinted = summarize(facts.rows.map((row) => row.metrics.toPrinted), printedDef.breakSec);
  const people = peopleFor(facts.rows, packDef, { withScan: true });
  const scanned = facts.rows.filter((row) => row.scanMethod === 'scan').length;
  const slow = facts.rows.filter((row) => {
    const value = row.metrics.pack;
    return typeof value === 'number' && value > (packDef.slowSec ?? 300) && value <= packDef.breakSec;
  }).length;
  const perHour = pack.totalWorkingSec > 0 ? (pack.count - pack.breaks) / (pack.totalWorkingSec / 3600) : null;
  const problems = facts.lists.problems.rows.length;

  const tiles: AnalyticsTile[] = [
    { key: 'packed', label: 'طلبات مجهزة', value: String(facts.rows.length), filter: { metric: 'pack', subset: 'all' } },
    {
      key: 'avg',
      label: 'متوسط وقت الطلب',
      value: formatDuration(pack.avg),
      sub: `الوسيط ${formatDuration(pack.median)} · 90% ${formatDuration(pack.p90)}`,
      filter: { metric: 'pack', subset: 'measured' },
    },
    {
      key: 'perHour',
      label: 'طلب/ساعة للمجهِّز',
      value: perHour ? perHour.toFixed(1) : '—',
      sub: pack.breaks ? `${pack.breaks} توقف مستبعد` : undefined,
      filter: { metric: 'pack', subset: 'breaks' },
    },
    {
      key: 'slow',
      label: 'أبطأ من 5 دقائق',
      value: String(slow),
      tone: slow > 0 ? 'warn' : 'default',
      filter: { metric: 'pack', subset: 'slow' },
    },
    {
      key: 'age',
      label: 'عمر الطلب عند التجهيز',
      value: formatDuration(age.median),
      sub: `90% ${formatDuration(age.p90)}`,
      filter: { metric: 'age', subset: 'measured' },
    },
    {
      key: 'toPrinted',
      label: 'من التجهيز للبوليصة',
      value: formatDuration(toPrinted.median),
      sub: `${toPrinted.count} طُبعت · 90% ${formatDuration(toPrinted.p90)}`,
      filter: { metric: 'toPrinted', subset: 'measured' },
    },
    {
      key: 'scan',
      label: 'نسبة المسح',
      value: facts.rows.length ? `${Math.round((scanned / facts.rows.length) * 100)}%` : '—',
      sub: `${scanned} بالمسح`,
      filter: { metric: 'pack', subset: 'scanned' },
    },
    {
      key: 'problems',
      label: 'مشاكل مسجلة',
      value: String(problems),
      tone: problems > 0 ? 'warn' : 'default',
      filter: { metric: 'problems' },
    },
  ];

  return {
    kind: 'prep',
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label, key: period.key },
    generatedAt: new Date().toISOString(),
    mainMetric: 'pack',
    mainMetricLabel: packDef.label,
    tiles,
    buckets: bucketsFor(facts.rows, packDef),
    people,
  };
}
