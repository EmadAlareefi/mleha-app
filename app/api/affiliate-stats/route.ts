import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { Prisma } from '@prisma/client';
import { normalizeAffiliateName, sanitizeAffiliateName } from '@/lib/affiliate';

export const runtime = 'nodejs';
const TAX_RATE = 0.15;

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  return Number(value);
}

function calculateNetAmount(totalAmount: Prisma.Decimal | number | null, shippingAmount: Prisma.Decimal | number | null): number {
  const total = decimalToNumber(totalAmount);
  const shipping = decimalToNumber(shippingAmount);
  const taxableBase = Math.max(total - shipping, 0);
  const tax = taxableBase * TAX_RATE;
  const netAmount = Math.max(taxableBase - tax, 0);
  return netAmount;
}

function isDelivered(statusSlug: string | null | undefined, statusName: string | null | undefined): boolean {
  const normalizedSlug = statusSlug?.toLowerCase();
  if (normalizedSlug === 'delivered') {
    return true;
  }
  const normalizedName = statusName?.trim();
  return normalizedName === 'تم التوصيل';
}

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

    const affiliateNameRaw = (session.user as any)?.affiliateName;
    const affiliateName = normalizeAffiliateName(affiliateNameRaw);
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
      campaignName: {
        equals: affiliateName,
        mode: 'insensitive',
      },
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
          shippingAmount: true,
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
          shippingAmount: true,
          affiliateCommission: true,
        }
      }),
    ]);

    const totalCount = ordersForStats.length;

    type StatusAccumulator = {
      slug: string | null;
      name: string | null;
      count: number;
      netAmount: number;
      commissionEarned: number;
    };

    const statusAccumulator = new Map<string, StatusAccumulator>();
    let totalSales = 0;
    let totalCommissionEarned = 0;
    let commissionEligibleCount = 0;

    for (const order of ordersForStats) {
      const netAmount = calculateNetAmount(order.totalAmount, order.shippingAmount);
      totalSales += netAmount;

      const commissionRate =
        order.affiliateCommission === null || order.affiliateCommission === undefined
          ? 10
          : Number(order.affiliateCommission);
      const eligibleForCommission = isDelivered(order.statusSlug, order.statusName);
      const commissionEarned = eligibleForCommission ? netAmount * (commissionRate / 100) : 0;

      if (eligibleForCommission) {
        totalCommissionEarned += commissionEarned;
        commissionEligibleCount += 1;
      }

      const key = order.statusSlug ?? order.statusName ?? 'unknown';
      const current = statusAccumulator.get(key) ?? {
        slug: order.statusSlug,
        name: order.statusName || order.statusSlug || 'Unknown',
        count: 0,
        netAmount: 0,
        commissionEarned: 0,
      };

      current.count += 1;
      current.netAmount += netAmount;
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
    const recentOrders = recentOrdersRaw.map(order => {
      const totalAmount = decimalToNumber(order.totalAmount);
      const shippingAmount = decimalToNumber(order.shippingAmount);
      const netAmount = calculateNetAmount(order.totalAmount, order.shippingAmount);
      const commissionRate =
        order.affiliateCommission === null || order.affiliateCommission === undefined
          ? 10
          : Number(order.affiliateCommission);
      const eligibleForCommission = isDelivered(order.statusSlug, order.statusName);
      const commissionAmount = eligibleForCommission ? netAmount * (commissionRate / 100) : 0;
      return {
        ...order,
        placedAt: order.placedAt?.toISOString(),
        totalAmount,
        shippingAmount,
        netAmount,
        isDelivered: eligibleForCommission,
        commissionAmount,
        affiliateCommission:
          order.affiliateCommission === null || order.affiliateCommission === undefined
            ? null
            : commissionRate,
      };
    });

    return NextResponse.json({
      success: true,
      stats: {
        totalOrders: totalCount,
        totalSales: totalSales,
        averageOrderValue: totalCount > 0 ? totalSales / totalCount : 0,
        totalCommissionEarned: totalCommissionEarned,
        averageCommissionPerOrder: commissionEligibleCount > 0 ? totalCommissionEarned / commissionEligibleCount : 0,
      },
      statusStats,
      recentOrders,
      affiliateName: sanitizeAffiliateName(affiliateNameRaw),
    });

  } catch (error) {
    log.error('Error fetching affiliate stats', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الإحصائيات' },
      { status: 500 }
    );
  }
}
