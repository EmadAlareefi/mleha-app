import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/order-history/user
 * Get order history for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const status = searchParams.get('status');

    if (!userId) {
      return NextResponse.json(
        { error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    // Build filter
    const where: any = {
      userId,
    };

    if (startDate && endDate) {
      where.finishedAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
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

    return NextResponse.json({
      success: true,
      history,
      stats,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error fetching user order history', { error: errorMessage });

    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب سجل الطلبات' },
      { status: 500 }
    );
  }
}
