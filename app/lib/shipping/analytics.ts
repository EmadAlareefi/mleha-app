import { prisma } from '@/lib/prisma';
import { bucketsFor, cachedFacts, peopleFor, secondsBetween, type Facts, type FactRow, type MetricDef } from '@/app/lib/analytics/engine';
import type { Period } from '@/app/lib/analytics/period';
import { formatDuration, summarize } from '@/app/lib/analytics/stats';
import type { AnalyticsSummary, AnalyticsTile } from '@/app/lib/analytics/types';
import { RIYADH_OFFSET_MS } from '@/app/lib/order-prep/riyadh-time';
import { STATE_LABELS, type ShippingState } from './rules';
import { MERCHANT_ID } from './tasks';

/**
 * Shipping analytics for the shipping board: the shipper's time per order and
 * how long each order waited between packing, its label and printing. Built
 * from every printed courier label (old page and new station alike).
 */

export const SHIPPING_METRICS: MetricDef[] = [
  // Time since the shipper's previous label. Over 10 min is a break.
  { key: 'gap', label: 'وقت الشاحن للطلب', breakSec: 600, slowSec: 240 },
  { key: 'labelWait', label: 'من طلب الشحنة حتى وصول البوليصة', breakSec: Number.MAX_SAFE_INTEGER },
  { key: 'readyToPrint', label: 'من جاهزية البوليصة حتى طباعتها', breakSec: Number.MAX_SAFE_INTEGER },
  { key: 'packedToPrinted', label: 'من التجهيز حتى طباعة البوليصة', breakSec: Number.MAX_SAFE_INTEGER },
];

type ShipFactRow = {
  orderId: string;
  orderNumber: string;
  printedBy: string | null;
  printedAt: Date;
  gap: number | null;
  courierName: string | null;
  labelStoredAt: Date;
  taskCreatedAt: Date | null;
  creatingAt: Date | null;
  labelReadyAt: Date | null;
  packedAt: Date | null;
  packer: string | null;
  placedAt: Date | null;
};

const LOOKBACK_MS = 12 * 3_600_000;

async function loadShippingFacts(period: Period): Promise<Facts> {
  const lookback = new Date(period.from.getTime() - LOOKBACK_MS);
  const [rows, failed] = await Promise.all([
    prisma.$queryRaw<ShipFactRow[]>`
      WITH printed AS (
        SELECT s."merchantId", s."orderId", s."orderNumber", s."labelPrintedByName" AS "printedBy", s."labelPrintedAt" AS "printedAt",
          s."courierName", s."createdAt" AS "labelStoredAt",
          extract(epoch from s."labelPrintedAt" - lag(s."labelPrintedAt") OVER (
            PARTITION BY coalesce(s."labelPrintedBy", s."labelPrintedByName") ORDER BY s."labelPrintedAt"
          ))::float AS "gap"
        FROM "SallaShipment" s
        WHERE s."merchantId" = ${MERCHANT_ID}
          AND s."labelPrintedAt" >= ${lookback} AND s."labelPrintedAt" < ${period.to}
      )
      SELECT p."orderId", p."orderNumber", p."printedBy", p."printedAt", p."gap", p."courierName", p."labelStoredAt",
        t."createdAt" AS "taskCreatedAt", t."creatingAt", t."labelReadyAt",
        a."completedAt" AS "packedAt", a."userName" AS "packer", o."placedAt"
      FROM printed p
      LEFT JOIN "ShippingTask" t ON t."merchantId" = p."merchantId" AND t."orderId" = p."orderId"
      LEFT JOIN "OrderPrepAssignment" a ON a."merchantId" = p."merchantId" AND a."orderId" = p."orderId" AND a.status = 'completed'
      LEFT JOIN "SallaOrder" o ON o."merchantId" = p."merchantId" AND o."orderId" = p."orderId"
      WHERE p."printedAt" >= ${period.from}
    `,
    prisma.shippingTask.findMany({
      where: { merchantId: MERCHANT_ID, state: { in: ['failed', 'blocked'] }, updatedAt: { gte: period.from, lt: period.to } },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const facts: FactRow[] = rows.map((row) => {
    // When Salla's label was stored (webhook or adoption) — accurate for both pages.
    const labelAt = row.labelStoredAt;
    const placed = row.placedAt ? new Date(row.placedAt.getTime() - RIYADH_OFFSET_MS) : null;
    const tags = [row.courierName || '—'];
    if (row.creatingAt) tags.push('أُنشئت تلقائياً');
    if (!row.packedAt) tags.push('بدون تجهيز');
    return {
      orderId: row.orderId,
      orderNumber: row.orderNumber || row.orderId,
      person: row.printedBy?.trim() || null,
      at: row.printedAt,
      metrics: {
        gap: typeof row.gap === 'number' ? row.gap : null,
        labelWait: secondsBetween(row.creatingAt, row.creatingAt ? labelAt : null),
        readyToPrint: secondsBetween(labelAt, row.printedAt),
        packedToPrinted: secondsBetween(row.packedAt, row.printedAt),
      },
      tags,
      timeline: [
        { label: 'وصل الطلب', at: placed?.toISOString() ?? null },
        { label: 'تم التجهيز', at: row.packedAt?.toISOString() ?? null, by: row.packer },
        { label: 'طُلبت الشحنة من سلة', at: row.creatingAt?.toISOString() ?? null },
        { label: 'البوليصة جاهزة', at: labelAt.toISOString() },
        { label: 'طُبعت البوليصة', at: row.printedAt.toISOString(), by: row.printedBy },
      ],
    };
  });

  const failedRows: FactRow[] = failed.map((task) => ({
    orderId: task.orderId,
    orderNumber: task.orderNumber || task.orderId,
    person: task.printedByName,
    at: task.updatedAt,
    metrics: {},
    tags: [STATE_LABELS[task.state as ShippingState] ?? task.state],
    note: task.blockReason || task.lastError,
    timeline: [
      { label: 'بدأت مهمة الشحن', at: task.createdAt.toISOString() },
      { label: 'طُلبت الشحنة من سلة', at: task.creatingAt?.toISOString() ?? null },
      { label: 'آخر تحديث', at: task.updatedAt.toISOString() },
    ],
  }));

  return { rows: facts, lists: { failed: { label: 'فشل أو موقوف', rows: failedRows } } };
}

export function getShippingFacts(period: Period) {
  return cachedFacts(`ship:${period.key}:${period.from.getTime()}:${Math.floor(period.to.getTime() / 30_000)}`, () =>
    loadShippingFacts(period),
  );
}

export async function getShippingAnalytics(period: Period): Promise<AnalyticsSummary> {
  const facts = await getShippingFacts(period);
  const [gapDef, waitDef, readyDef, packedDef] = SHIPPING_METRICS;
  const gap = summarize(facts.rows.map((row) => row.metrics.gap), gapDef.breakSec);
  const wait = summarize(facts.rows.map((row) => row.metrics.labelWait), waitDef.breakSec);
  const ready = summarize(facts.rows.map((row) => row.metrics.readyToPrint), readyDef.breakSec);
  const packed = summarize(facts.rows.map((row) => row.metrics.packedToPrinted), packedDef.breakSec);
  const perHour = gap.totalWorkingSec > 0 ? (gap.count - gap.breaks) / (gap.totalWorkingSec / 3600) : null;
  const failed = facts.lists.failed.rows.length;

  const tiles: AnalyticsTile[] = [
    { key: 'printed', label: 'بوالص مطبوعة', value: String(facts.rows.length), filter: { metric: 'gap', subset: 'all' } },
    {
      key: 'avg',
      label: 'متوسط وقت الشاحن للطلب',
      value: formatDuration(gap.avg),
      sub: `الوسيط ${formatDuration(gap.median)} · 90% ${formatDuration(gap.p90)}`,
      filter: { metric: 'gap', subset: 'measured' },
    },
    {
      key: 'perHour',
      label: 'طلب/ساعة للشاحن',
      value: perHour ? perHour.toFixed(1) : '—',
      sub: gap.breaks ? `${gap.breaks} توقف مستبعد` : undefined,
      filter: { metric: 'gap', subset: 'breaks' },
    },
    {
      key: 'labelWait',
      label: 'انتظار البوليصة من سلة',
      value: formatDuration(wait.median),
      sub: wait.count ? `${wait.count} تلقائية · 90% ${formatDuration(wait.p90)}` : 'لا توجد شحنات تلقائية',
      filter: { metric: 'labelWait', subset: 'measured' },
    },
    {
      key: 'readyToPrint',
      label: 'من الجاهزية للطباعة',
      value: formatDuration(ready.median),
      sub: `90% ${formatDuration(ready.p90)}`,
      filter: { metric: 'readyToPrint', subset: 'measured' },
    },
    {
      key: 'packedToPrinted',
      label: 'من التجهيز للطباعة',
      value: formatDuration(packed.median),
      sub: `90% ${formatDuration(packed.p90)}`,
      filter: { metric: 'packedToPrinted', subset: 'measured' },
    },
    {
      key: 'failed',
      label: 'فشل أو موقوف',
      value: String(failed),
      tone: failed > 0 ? 'danger' : 'default',
      filter: { metric: 'failed' },
    },
  ];

  return {
    kind: 'shipping',
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label, key: period.key },
    generatedAt: new Date().toISOString(),
    mainMetric: 'gap',
    mainMetricLabel: gapDef.label,
    tiles,
    buckets: bucketsFor(facts.rows, gapDef),
    people: peopleFor(facts.rows, gapDef),
  };
}
