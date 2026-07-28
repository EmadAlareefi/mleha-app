import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * Aggregates behind the reports tab on /salla/notify. Everything is computed in
 * the database rather than by pulling rows into the app, so the numbers stay
 * correct as the table grows.
 */

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const TOP_PRODUCTS_LIMIT = 20;

type CountRow = { key: string | null; count: number };
type DailyRow = { day: string; total: number; storefront: number; staff: number };
type TopProductRow = {
  productId: number;
  productName: string | null;
  productSku: string | null;
  productImageUrl: string | null;
  total: number;
  pending: number;
  notified: number;
  failed: number;
};
type TimingRow = {
  notifiedCount: number;
  avgSeconds: number | null;
  medianSeconds: number | null;
};

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const daysParam = Number.parseInt(
    new URL(request.url).searchParams.get('days') || '',
    10
  );
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(daysParam, MAX_WINDOW_DAYS)
      : DEFAULT_WINDOW_DAYS;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const [byStatus, bySource, byAudience, daily, topProducts, timing, allTimeTotal] =
      await Promise.all([
        prisma.$queryRaw<CountRow[]>`
          SELECT "status" AS key, COUNT(*)::int AS count
          FROM "SallaProductAvailabilityRequest"
          WHERE "createdAt" >= ${since}
          GROUP BY "status"
        `,
        prisma.$queryRaw<CountRow[]>`
          SELECT "source" AS key, COUNT(*)::int AS count
          FROM "SallaProductAvailabilityRequest"
          WHERE "createdAt" >= ${since}
          GROUP BY "source"
        `,
        prisma.$queryRaw<CountRow[]>`
          SELECT CASE WHEN "isGuest" THEN 'guest' ELSE 'identified' END AS key,
                 COUNT(*)::int AS count
          FROM "SallaProductAvailabilityRequest"
          WHERE "createdAt" >= ${since}
          GROUP BY 1
        `,
        prisma.$queryRaw<DailyRow[]>`
          SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE "source" = 'storefront')::int AS storefront,
                 COUNT(*) FILTER (WHERE "source" <> 'storefront')::int AS staff
          FROM "SallaProductAvailabilityRequest"
          WHERE "createdAt" >= ${since}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
        prisma.$queryRaw<TopProductRow[]>`
          SELECT "productId",
                 MAX("productName") AS "productName",
                 MAX("productSku") AS "productSku",
                 MAX("productImageUrl") AS "productImageUrl",
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE "status" IN ('pending', 'notifying'))::int AS pending,
                 COUNT(*) FILTER (WHERE "status" = 'notified')::int AS notified,
                 COUNT(*) FILTER (WHERE "status" = 'failed')::int AS failed
          FROM "SallaProductAvailabilityRequest"
          WHERE "createdAt" >= ${since}
          GROUP BY "productId"
          ORDER BY total DESC, "productId" DESC
          LIMIT ${TOP_PRODUCTS_LIMIT}
        `,
        prisma.$queryRaw<TimingRow[]>`
          SELECT COUNT(*)::int AS "notifiedCount",
                 AVG(EXTRACT(EPOCH FROM ("notifiedAt" - "createdAt")))::float AS "avgSeconds",
                 PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY EXTRACT(EPOCH FROM ("notifiedAt" - "createdAt"))
                 )::float AS "medianSeconds"
          FROM "SallaProductAvailabilityRequest"
          WHERE "notifiedAt" IS NOT NULL AND "createdAt" >= ${since}
        `,
        prisma.sallaProductAvailabilityRequest.count(),
      ]);

    const toMap = (rows: CountRow[]) =>
      rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.key ?? 'unknown'] = Number(row.count) || 0;
        return acc;
      }, {});

    const statusCounts = toMap(byStatus);
    const windowTotal = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);

    return NextResponse.json({
      success: true,
      windowDays: days,
      since: since.toISOString(),
      totals: {
        allTime: allTimeTotal,
        window: windowTotal,
        pending: (statusCounts.pending ?? 0) + (statusCounts.notifying ?? 0),
        notified: statusCounts.notified ?? 0,
        failed: statusCounts.failed ?? 0,
        cancelled: statusCounts.cancelled ?? 0,
      },
      byStatus: statusCounts,
      bySource: toMap(bySource),
      byAudience: toMap(byAudience),
      daily: daily.map((row) => ({
        day: row.day,
        total: Number(row.total) || 0,
        storefront: Number(row.storefront) || 0,
        staff: Number(row.staff) || 0,
      })),
      topProducts: topProducts.map((row) => ({
        productId: Number(row.productId),
        productName: row.productName,
        productSku: row.productSku,
        productImageUrl: row.productImageUrl,
        total: Number(row.total) || 0,
        pending: Number(row.pending) || 0,
        notified: Number(row.notified) || 0,
        failed: Number(row.failed) || 0,
      })),
      timing: {
        notifiedCount: Number(timing[0]?.notifiedCount ?? 0),
        avgSeconds: timing[0]?.avgSeconds ?? null,
        medianSeconds: timing[0]?.medianSeconds ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    log.error('Failed to build availability request stats', { error: message });
    return NextResponse.json(
      { success: false, error: 'تعذر تحميل التقارير' },
      { status: 500 }
    );
  }
}
