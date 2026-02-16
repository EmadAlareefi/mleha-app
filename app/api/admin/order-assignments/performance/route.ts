import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const UNDER_REVIEW_STATUS_IDS = new Set(['1065456688', '1882207425', '2046404155']);
const RESERVATION_STATUS_IDS = new Set(['1576217163']);

/**
 * GET /api/admin/order-assignments/performance?from=...&to=...
 * Get performance metrics for order assignments within a date range
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    if (!fromParam || !toParam) {
      return NextResponse.json(
        { error: 'يجب تحديد نطاق التاريخ (from و to)' },
        { status: 400 },
      );
    }

    const from = new Date(fromParam);
    const to = new Date(toParam);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { error: 'تنسيق التاريخ غير صالح' },
        { status: 400 },
      );
    }

    const hoursInRange = Math.max((to.getTime() - from.getTime()) / (1000 * 60 * 60), 1);

    const assignments = await prisma.orderAssignment.findMany({
      where: {
        assignedAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        status: true,
        sallaStatus: true,
        assignedAt: true,
        completedAt: true,
        userId: true,
        user: { select: { id: true, name: true, username: true } },
      },
    });

    // Per-user aggregation
    const userMap = new Map<string, {
      userId: string;
      userName: string;
      totalAssigned: number;
      totalCompleted: number;
      totalCompletionMs: number;
      underReview: number;
      reservation: number;
      active: number;
    }>();

    for (const a of assignments) {
      const userId = a.userId;
      const userName = (a.user as { name?: string; username?: string })?.name
        || (a.user as { name?: string; username?: string })?.username
        || 'Unknown';

      if (!userMap.has(userId)) {
        userMap.set(userId, {
          userId,
          userName,
          totalAssigned: 0,
          totalCompleted: 0,
          totalCompletionMs: 0,
          underReview: 0,
          reservation: 0,
          active: 0,
        });
      }

      const u = userMap.get(userId)!;
      u.totalAssigned++;

      if (a.completedAt) {
        u.totalCompleted++;
        u.totalCompletionMs += new Date(a.completedAt).getTime() - new Date(a.assignedAt).getTime();
      }

      if (a.sallaStatus && UNDER_REVIEW_STATUS_IDS.has(a.sallaStatus)) {
        u.underReview++;
      }
      if (a.sallaStatus && RESERVATION_STATUS_IDS.has(a.sallaStatus)) {
        u.reservation++;
      }
      if (!a.completedAt) {
        u.active++;
      }
    }

    // Build per-user metrics
    const byUser = Array.from(userMap.values())
      .map((u) => ({
        userId: u.userId,
        userName: u.userName,
        totalAssigned: u.totalAssigned,
        totalCompleted: u.totalCompleted,
        completionRate: u.totalAssigned > 0
          ? Math.round((u.totalCompleted / u.totalAssigned) * 100)
          : 0,
        avgCompletionMs: u.totalCompleted > 0
          ? Math.round(u.totalCompletionMs / u.totalCompleted)
          : null,
        ordersPerHour: u.totalCompleted > 0
          ? Math.round((u.totalCompleted / hoursInRange) * 100) / 100
          : 0,
        underReview: u.underReview,
        reservation: u.reservation,
        active: u.active,
      }))
      .sort((a, b) => b.totalAssigned - a.totalAssigned);

    // Aggregate across all users
    const totals = Array.from(userMap.values()).reduce(
      (acc, u) => {
        acc.totalAssigned += u.totalAssigned;
        acc.totalCompleted += u.totalCompleted;
        acc.totalCompletionMs += u.totalCompletionMs;
        acc.underReview += u.underReview;
        acc.reservation += u.reservation;
        acc.active += u.active;
        return acc;
      },
      { totalAssigned: 0, totalCompleted: 0, totalCompletionMs: 0, underReview: 0, reservation: 0, active: 0 },
    );

    const aggregate = {
      totalAssigned: totals.totalAssigned,
      totalCompleted: totals.totalCompleted,
      completionRate: totals.totalAssigned > 0
        ? Math.round((totals.totalCompleted / totals.totalAssigned) * 100)
        : 0,
      avgCompletionMs: totals.totalCompleted > 0
        ? Math.round(totals.totalCompletionMs / totals.totalCompleted)
        : null,
      ordersPerHour: totals.totalCompleted > 0
        ? Math.round((totals.totalCompleted / hoursInRange) * 100) / 100
        : 0,
      underReview: totals.underReview,
      reservation: totals.reservation,
      active: totals.active,
    };

    return NextResponse.json({
      success: true,
      range: { from: from.toISOString(), to: to.toISOString(), hoursInRange },
      aggregate,
      byUser,
    });
  } catch (error) {
    log.error('Error getting performance metrics', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب بيانات الأداء' },
      { status: 500 },
    );
  }
}
