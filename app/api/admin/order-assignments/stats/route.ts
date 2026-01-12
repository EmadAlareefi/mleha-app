import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/admin/order-assignments/stats
 * Get statistics for order assignments
 */
export async function GET() {
  try {
    const now = new Date();

    // Calculate date ranges for completed orders
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get all assignments for different time periods
    const [activeAssignments, todayAssignments, weekAssignments, monthAssignments] = await Promise.all([
      // Active orders (not completed)
      prisma.orderAssignment.findMany({
        where: { completedAt: null },
        select: {
          id: true,
          status: true,
          sallaStatus: true,
          completedAt: true,
          userId: true,
          user: {
            select: { id: true, name: true, username: true },
          },
        },
      }),
      // Today's completed orders
      prisma.orderAssignment.findMany({
        where: { completedAt: { gte: todayStart } },
        select: {
          id: true,
          status: true,
          sallaStatus: true,
          completedAt: true,
          userId: true,
          user: {
            select: { id: true, name: true, username: true },
          },
        },
      }),
      // This week's completed orders
      prisma.orderAssignment.findMany({
        where: { completedAt: { gte: weekStart } },
        select: {
          id: true,
          status: true,
          sallaStatus: true,
          completedAt: true,
          userId: true,
          user: {
            select: { id: true, name: true, username: true },
          },
        },
      }),
      // This month's completed orders
      prisma.orderAssignment.findMany({
        where: { completedAt: { gte: monthStart } },
        select: {
          id: true,
          status: true,
          sallaStatus: true,
          completedAt: true,
          userId: true,
          user: {
            select: { id: true, name: true, username: true },
          },
        },
      }),
    ]);

    const buildStatsBucket = (assignments: typeof todayAssignments) => {
      const summary = {
        total: assignments.length,
        completed: 0,
        underReview: 0,
        reservation: 0,
        shipped: 0,
      };

      const userStatsMap = new Map<string, {
        userId: string;
        userName: string;
        total: number;
        completed: number;
        underReview: number;
        reservation: number;
      }>();

      assignments.forEach((assignment) => {
        if (assignment.completedAt) {
          summary.completed++;
        }
        if (assignment.sallaStatus === '1065456688') {
          summary.underReview++;
        }
        if (assignment.sallaStatus === '1576217163') {
          summary.reservation++;
        }
        if (assignment.sallaStatus === '165947469') {
          summary.shipped++;
        }

        const userId = assignment.userId;
        const userName =
          (assignment.user as any)?.name ||
          (assignment.user as any)?.username ||
          'Unknown';

        if (!userStatsMap.has(userId)) {
          userStatsMap.set(userId, {
            userId,
            userName,
            total: 0,
            completed: 0,
            underReview: 0,
            reservation: 0,
          });
        }

        const userStats = userStatsMap.get(userId)!;
        userStats.total++;

        if (assignment.completedAt) {
          userStats.completed++;
        }
        if (assignment.sallaStatus === '1065456688') {
          userStats.underReview++;
        }
        if (assignment.sallaStatus === '1576217163') {
          userStats.reservation++;
        }
      });

      return {
        ...summary,
        byUser: Array.from(userStatsMap.values()).sort((a, b) => b.total - a.total),
      };
    };

    const stats = {
      active: buildStatsBucket(activeAssignments),
      today: buildStatsBucket(todayAssignments),
      week: buildStatsBucket(weekAssignments),
      month: buildStatsBucket(monthAssignments),
    };

    return NextResponse.json({
      success: true,
      stats,
    });

  } catch (error) {
    log.error('Error getting order assignment stats', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
