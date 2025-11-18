import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/order-history/admin
 * Get order history for admin - can filter by user and date
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const status = searchParams.get('status');

    // Build filter
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (startDate && endDate) {
      where.finishedAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + 'T23:59:59.999Z'), // Include entire end date
      };
    }

    if (status) {
      where.status = status;
    }

    const history = await prisma.orderHistory.findMany({
      where,
      orderBy: {
        finishedAt: 'desc',
      },
    });

    // Calculate statistics
    const stats = {
      total: history.length,
      completed: history.filter(h => h.status === 'completed').length,
      cancelled: history.filter(h => h.status === 'cancelled').length,
      removed: history.filter(h => h.status === 'removed').length,
      totalDuration: history.reduce((sum, h) => sum + (h.durationMinutes || 0), 0),
      averageDuration: history.length > 0
        ? Math.round(history.reduce((sum, h) => sum + (h.durationMinutes || 0), 0) / history.length)
        : 0,
    };

    // Group by user
    const byUser = history.reduce((acc: any, h) => {
      if (!acc[h.userId]) {
        acc[h.userId] = {
          userId: h.userId,
          userName: h.userName,
          total: 0,
          completed: 0,
          cancelled: 0,
          removed: 0,
          totalDuration: 0,
        };
      }
      acc[h.userId].total++;
      if (h.status === 'completed') acc[h.userId].completed++;
      if (h.status === 'cancelled') acc[h.userId].cancelled++;
      if (h.status === 'removed') acc[h.userId].removed++;
      acc[h.userId].totalDuration += h.durationMinutes || 0;
      return acc;
    }, {});

    const userStats = Object.values(byUser).map((u: any) => ({
      ...u,
      averageDuration: u.total > 0 ? Math.round(u.totalDuration / u.total) : 0,
    }));

    return NextResponse.json({
      success: true,
      history,
      stats,
      userStats,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching admin order history', { error: errorMessage });

    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب سجل الطلبات' },
      { status: 500 }
    );
  }
}
