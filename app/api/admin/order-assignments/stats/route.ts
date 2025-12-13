import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/admin/order-assignments/stats
 * Get statistics for order assignments
 */
export async function GET(request: NextRequest) {
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

    // Helper function to calculate stats
    const calculateStats = (assignments: typeof todayAssignments) => {
      return {
        total: assignments.length,
        completed: assignments.filter(a => a.completedAt !== null).length,
        underReview: assignments.filter(a => a.sallaStatus === '1065456688').length,
        reservation: assignments.filter(a => a.sallaStatus === '1576217163').length,
        shipped: assignments.filter(a => a.sallaStatus === '165947469').length,
      };
    };

    // Calculate stats by user (for active orders)
    const userStatsMap = new Map<string, {
      userId: string;
      userName: string;
      total: number;
      completed: number;
      underReview: number;
      reservation: number;
    }>();

    activeAssignments.forEach((assignment) => {
      const userId = assignment.userId;
      const userName = (assignment.user as any)?.name || 'Unknown';

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

    const stats = {
      active: calculateStats(activeAssignments),
      today: calculateStats(todayAssignments),
      week: calculateStats(weekAssignments),
      month: calculateStats(monthAssignments),
      byUser: Array.from(userStatsMap.values()),
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
