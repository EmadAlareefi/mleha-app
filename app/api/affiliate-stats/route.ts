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

    // Get basic stats
    const [totalCount, amountStats, statusBreakdown] = await Promise.all([
      prisma.sallaOrder.count({ where }),
      prisma.sallaOrder.aggregate({
        where,
        _sum: {
          totalAmount: true,
        },
      }),
      prisma.sallaOrder.groupBy({
        where,
        by: ['statusSlug', 'statusName'],
        _count: {
          _all: true,
        },
        _sum: {
          totalAmount: true,
          affiliateCommission: true,
        },
      }),
    ]);

    const totalAmount = Number(amountStats._sum.totalAmount ?? 0);

    // Group statuses and calculate commission per status
    const statusStats = statusBreakdown.map((entry) => {
      const totalOrderValue = Number(entry._sum.totalAmount ?? 0);
      // If affiliateCommission is null for an order, it defaults to 10.
      // entry._sum.affiliateCommission here is the sum of commission rates for all orders in this group.
      // We need the *effective* commission for this group, which is the sum of (totalAmount * rate/100).
      // Since we don't have individual order amounts here, we'll calculate an average rate for the group.
      const commissionEarnedForGroup = totalOrderValue * (Number(entry._sum.affiliateCommission ?? 0) / entry._count._all / 100);

      return {
        slug: entry.statusSlug,
        name: entry.statusName || entry.statusSlug,
        count: entry._count._all,
        totalAmount: totalOrderValue,
        commissionEarned: isNaN(commissionEarnedForGroup) ? 0 : commissionEarnedForGroup,
        percentage: totalCount > 0 ? (entry._count._all / totalCount) * 100 : 0,
      };
    }).sort((a, b) => b.count - a.count);

    // Recalculate totalCommissionEarned by summing up from statusStats
    const totalCommissionEarned = statusStats.reduce((acc, stat) => acc + stat.commissionEarned, 0);

    // Get recent orders (last 10)
    const recentOrders = await prisma.sallaOrder.findMany({
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
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalOrders: totalCount,
        totalSales: totalAmount,
        averageOrderValue: totalCount > 0 ? totalAmount / totalCount : 0,
        totalCommissionEarned: totalCommissionEarned,
        averageCommissionPerOrder: totalCount > 0 ? totalCommissionEarned / totalCount : 0,
      },
      statusStats,
      recentOrders: recentOrders.map(order => ({
        ...order,
        placedAt: order.placedAt?.toISOString(),
        totalAmount: Number(order.totalAmount),
      })),
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
