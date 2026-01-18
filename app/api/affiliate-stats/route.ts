import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

/**
 * GET /api/affiliate-stats
 * Get statistics for the logged-in affiliate
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const affiliateName = (session.user as any)?.affiliateName;
    if (!affiliateName) {
      return NextResponse.json(
        { error: 'No affiliate linked to this account' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: Prisma.SallaOrderWhereInput = {
      campaignName: affiliateName,
    };

    if (startDate || endDate) {
      where.placedAt = {
        gte: startDate ? new Date(`${startDate}T00:00:00.000Z`) : undefined,
        lte: endDate ? new Date(`${endDate}T23:59:59.999Z`) : undefined,
      };
    }

    const [ordersForStats, recentOrdersRaw] = await Promise.all([
      prisma.sallaOrder.findMany({
        where,
        select: {
          id: true,
          totalAmount: true,
          affiliateCommission: true,
          statusSlug: true,
          statusName: true,
        },
      }),
      prisma.sallaOrder.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderId: true,
          orderNumber: true,
          statusSlug: true,
          statusName: true,
          totalAmount: true,
          currency: true,
          placedAt: true,
          campaignName: true,
          affiliateCommission: true,
        }
      }),
    ]);

    const totalCount = ordersForStats.length;

    type StatusAccumulator = {
      slug: string | null;
      name: string | null;
      count: number;
      totalAmount: number;
      commissionEarned: number;
    };

    const statusAccumulator = new Map<string, StatusAccumulator>();
    let totalSales = 0;
    let totalCommissionEarned = 0;

    for (const order of ordersForStats) {
      const amount = Number(order.totalAmount ?? 0);
      const commissionRate =
        order.affiliateCommission === null || order.affiliateCommission === undefined
          ? 10
          : Number(order.affiliateCommission);
      const commissionEarned = amount * (commissionRate / 100);

      totalSales += amount;
      totalCommissionEarned += commissionEarned;

      const key = order.statusSlug ?? 'unknown';
      const current = statusAccumulator.get(key) ?? {
        slug: order.statusSlug,
        name: order.statusName || order.statusSlug || 'Unknown',
        count: 0,
        totalAmount: 0,
        commissionEarned: 0,
      };

      current.count += 1;
      current.totalAmount += amount;
      current.commissionEarned += commissionEarned;
      statusAccumulator.set(key, current);
    }

    const statusStats = Array.from(statusAccumulator.values())
      .map((stat) => ({
        ...stat,
        percentage: totalCount > 0 ? (stat.count / totalCount) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Get recent orders (last 10)
    const recentOrders = recentOrdersRaw.map(order => ({
      ...order,
      placedAt: order.placedAt?.toISOString(),
      totalAmount: Number(order.totalAmount ?? 0),
      affiliateCommission:
        order.affiliateCommission === null || order.affiliateCommission === undefined
          ? null
          : Number(order.affiliateCommission),
    }));

    return NextResponse.json({
      success: true,
      stats: {
        totalOrders: totalCount,
        totalSales: totalSales,
        averageOrderValue: totalCount > 0 ? totalSales / totalCount : 0,
        totalCommissionEarned: totalCommissionEarned,
        averageCommissionPerOrder: totalCount > 0 ? totalCommissionEarned / totalCount : 0,
      },
      statusStats,
      recentOrders,
      affiliateName,
    });

  } catch (error) {
    log.error('Error fetching affiliate stats', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
