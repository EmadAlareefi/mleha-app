import { prisma } from '@/lib/prisma';
import { bucketsFor, cachedFacts, peopleFor, secondsBetween, type Facts, type FactRow, type MetricDef } from '@/app/lib/analytics/engine';
import type { Period } from '@/app/lib/analytics/period';
import { formatDuration, summarize } from '@/app/lib/analytics/stats';
import type { AnalyticsSummary, AnalyticsTile } from '@/app/lib/analytics/types';
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
  // Customer's view: order placed → waybill printed. Over 24h misses the promise («slow» = late).
  { key: 'placedToPrinted', label: 'من وصول الطلب حتى طباعة البوليصة', breakSec: Number.MAX_SAFE_INTEGER, slowSec: 86_400 },
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

/** An order that left the warehouse without a station print of a Salla label. */
type OutsideRow = {
  orderId: string;
  orderNumber: string | null;
  at: Date;
  person: string | null;
  courierName: string | null;
  kind: 'local' | 'outside';
  packedAt: Date | null;
  packer: string | null;
  placedAt: Date | null;
};

// Order statuses that prove the parcel left the warehouse.
const LEFT_SLUGS = ['shipped', 'delivering', 'delivered', 'restoring', 'restored'];

async function loadShippingFacts(period: Period): Promise<Facts> {
  const lookback = new Date(period.from.getTime() - LOOKBACK_MS);
  const [rows, failed, outside] = await Promise.all([
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
    // Orders that ship without a station print of a Salla label, so they still
    // count as shipped: our own agents (printed at the station, no Salla label),
    // DHL labels made and printed by hand in Salla, and Salla labels printed
    // elsewhere for orders that have since left (status shipped and beyond).
    prisma.$queryRaw<OutsideRow[]>`
      SELECT t."orderId", t."orderNumber", t."printedAt" AS "at", t."printedByName" AS "person", 'مندوب' AS "courierName", 'local' AS "kind",
        a."completedAt" AS "packedAt", a."userName" AS "packer", o."placedAt"
      FROM "ShippingTask" t
      LEFT JOIN "OrderPrepAssignment" a ON a."merchantId" = t."merchantId" AND a."orderId" = t."orderId" AND a.status = 'completed'
      LEFT JOIN "SallaOrder" o ON o."merchantId" = t."merchantId" AND o."orderId" = t."orderId"
      WHERE t."merchantId" = ${MERCHANT_ID} AND t.method = 'local'
        AND t."printedAt" >= ${period.from} AND t."printedAt" < ${period.to}
        AND NOT EXISTS (
          SELECT 1 FROM "SallaShipment" sp WHERE sp."merchantId" = t."merchantId" AND sp."orderId" = t."orderId" AND sp."labelPrintedAt" IS NOT NULL
        )
      UNION ALL
      SELECT s."orderId", s."orderNumber", coalesce(t."labelReadyAt", s."createdAt") AS "at", NULL AS "person", s."courierName", 'outside' AS "kind",
        a."completedAt" AS "packedAt", a."userName" AS "packer", o."placedAt"
      FROM "SallaShipment" s
      JOIN "SallaOrder" o ON o."merchantId" = s."merchantId" AND o."orderId" = s."orderId"
      LEFT JOIN "ShippingTask" t ON t."merchantId" = s."merchantId" AND t."orderId" = s."orderId"
      LEFT JOIN "OrderPrepAssignment" a ON a."merchantId" = s."merchantId" AND a."orderId" = s."orderId" AND a.status = 'completed'
      WHERE s."merchantId" = ${MERCHANT_ID}
        AND s."labelPrintedAt" IS NULL
        AND coalesce(t."labelReadyAt", s."createdAt") >= ${period.from} AND coalesce(t."labelReadyAt", s."createdAt") < ${period.to}
        AND coalesce(o."statusSlug", '') <> 'canceled'
        AND (s."courierName" ILIKE '%DHL%' OR t.method = 'international' OR o."statusSlug" = ANY(${LEFT_SLUGS}))
    `,
  ]);

  const facts: FactRow[] = rows.map((row) => {
    // When Salla's label was stored (webhook or adoption) — accurate for both pages.
    const labelAt = row.labelStoredAt;
    const placed = row.placedAt;
    const tags = [row.courierName || '—'];
    if (row.creatingAt) tags.push('أُنشئت تلقائياً');
    if (!row.packedAt) tags.push('بدون تجهيز');
    return {
      orderId: row.orderId,
      orderNumber: row.orderNumber || row.orderId,
      person: row.printedBy?.trim() || null,
      at: row.printedAt,
      courier: row.courierName?.trim() || null,
      metrics: {
        gap: typeof row.gap === 'number' ? row.gap : null,
        labelWait: secondsBetween(row.creatingAt, row.creatingAt ? labelAt : null),
        readyToPrint: secondsBetween(labelAt, row.printedAt),
        packedToPrinted: secondsBetween(row.packedAt, row.printedAt),
        placedToPrinted: secondsBetween(placed, row.printedAt),
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

  for (const row of outside) {
    const placed = row.placedAt;
    facts.push({
      orderId: row.orderId,
      orderNumber: row.orderNumber || row.orderId,
      person: row.person?.trim() || null,
      at: row.at,
      courier: row.courierName?.trim() || null,
      outside: row.kind === 'outside',
      metrics: {
        gap: null,
        labelWait: null,
        readyToPrint: null,
        packedToPrinted: secondsBetween(row.packedAt, row.at),
        placedToPrinted: secondsBetween(placed, row.at),
      },
      tags: [row.courierName || '—', row.kind === 'local' ? 'مندوب' : 'بوليصة خارج المحطة'],
      timeline: [
        { label: 'وصل الطلب', at: placed?.toISOString() ?? null },
        { label: 'تم التجهيز', at: row.packedAt?.toISOString() ?? null, by: row.packer },
        { label: row.kind === 'local' ? 'طُبعت ورقة المندوب' : 'صدرت البوليصة (خارج المحطة)', at: row.at.toISOString(), by: row.person },
      ],
    });
  }

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
  // Labels issued outside the station have no shipper; keep them out of the people table.
  const stationRows = facts.rows.filter((row) => !row.outside);
  const gap = summarize(facts.rows.map((row) => row.metrics.gap), gapDef.breakSec);
  const wait = summarize(facts.rows.map((row) => row.metrics.labelWait), waitDef.breakSec);
  const ready = summarize(facts.rows.map((row) => row.metrics.readyToPrint), readyDef.breakSec);
  const packed = summarize(facts.rows.map((row) => row.metrics.packedToPrinted), packedDef.breakSec);
  const perHour = gap.totalWorkingSec > 0 ? (gap.count - gap.breaks) / (gap.totalWorkingSec / 3600) : null;
  const failed = facts.lists.failed.rows.length;

  const tiles: AnalyticsTile[] = [
    {
      key: 'printed',
      label: 'طلبات شُحنت',
      value: String(facts.rows.length),
      sub: facts.rows.length > stationRows.length ? `${facts.rows.length - stationRows.length} ببوليصة خارج المحطة` : undefined,
      filter: { metric: 'gap', subset: 'all' },
    },
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
    people: peopleFor(stationRows, gapDef),
  };
}
