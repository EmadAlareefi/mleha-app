import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { normalizeAffiliateName, sanitizeAffiliateName } from '@/lib/affiliate';
import { calculateNetAmount, getMonthKey, getMonthLabel, isDelivered } from '@/app/lib/affiliate-metrics';
import { Prisma } from '@prisma/client';
import { requireAffiliateManagementSession } from './authorization';

export const runtime = 'nodejs';

interface AffiliateManagementSummary {
  totalAffiliates: number;
  activeAffiliates: number;
  totalOrders: number;
  lifetimeNetSales: number;
  lifetimeCommission: number;
  deliveredCommission: number;
  pendingCommission: number;
  averageCommissionRate: number;
}

interface AffiliateMonthlyReport {
  period: string;
  label: string;
  totalOrders: number;
  deliveredOrders: number;
  netSales: number;
  commissionEarned: number;
  commissionPending: number;
  periodDate: string | null;
}

interface AffiliateWalletTransaction {
  id: string;
  type: 'commission' | 'payout';
  label: string;
  amount: number;
  currency: string;
  date: string;
  status: 'pending' | 'ready' | 'paid';
  orders: number;
}

interface AffiliatePayoutEntry {
  id: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED';
  reference: string | null;
  memo: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  recordedBy: {
    id: string | null;
    name: string | null;
    username: string | null;
  } | null;
}

interface AffiliateRecord {
  id: string;
  userName: string;
  ownerName: string;
  email: string | null;
  phone: string | null;
  affiliateName: string;
  normalizedAffiliateName: string;
  commissionRate: number;
  joinedAt: string;
  stats: {
    totalOrders: number;
    deliveredOrders: number;
    pendingOrders: number;
    netSales: number;
    averageOrderValue: number;
    commissionEarned: number;
    commissionPending: number;
    projectedCommission: number;
    conversionRate: number;
    lastOrderDate: string | null;
  };
  statusBreakdown: {
    key: string;
    label: string;
    count: number;
    netAmount: number;
    commissionEarned: number;
    commissionPotential: number;
  }[];
  wallet: {
    availableBalance: number;
    pendingBalance: number;
    lifetimeCommission: number;
    totalPaid: number;
    transactions: AffiliateWalletTransaction[];
  };
  payouts: AffiliatePayoutEntry[];
  monthlyReports: AffiliateMonthlyReport[];
  latestOrders: {
    id: string;
    orderId: string;
    orderNumber: string | null;
    placedAt: string | null;
    statusSlug: string | null;
    statusName: string | null;
    netAmount: number;
    currency: string | null;
    commissionAmount: number;
    isDelivered: boolean;
  }[];
}

interface AffiliateManagementResponse {
  success: true;
  summary: AffiliateManagementSummary;
  affiliates: AffiliateRecord[];
  reports: AffiliateMonthlyReport[];
  generatedAt: string;
}

const CURRENCY = 'SAR';

export async function GET(request: NextRequest) {
  try {
    const authCheck = await requireAffiliateManagementSession();
    if (!authCheck.allowed || !authCheck.session) {
      return authCheck.response!;
    }

    const { searchParams } = new URL(request.url);
    const affiliateFilterRaw = searchParams.get('affiliate');
    const sanitizedAffiliateFilter = affiliateFilterRaw
      ? sanitizeAffiliateName(affiliateFilterRaw)
      : null;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const affiliateWhere: Prisma.OrderUserWhereInput = {
      affiliateName: { not: null },
    };

    if (sanitizedAffiliateFilter) {
      affiliateWhere.affiliateName = {
        equals: sanitizedAffiliateFilter,
        mode: 'insensitive',
      };
    }

    const affiliates = await prisma.orderUser.findMany({
      where: affiliateWhere,
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        affiliateName: true,
        affiliateCommission: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    const affiliateMetas = affiliates
      .map((affiliate) => {
        const normalizedAffiliateName = normalizeAffiliateName(affiliate.affiliateName);
        if (!normalizedAffiliateName || !affiliate.affiliateName) {
          return null;
        }
        return {
          id: affiliate.id,
          userName: affiliate.username,
          ownerName: affiliate.name,
          email: affiliate.email ?? null,
          phone: affiliate.phone ?? null,
          affiliateName: affiliate.affiliateName,
          normalizedAffiliateName,
          commissionRate:
            affiliate.affiliateCommission === null || affiliate.affiliateCommission === undefined
              ? 10
              : Number(affiliate.affiliateCommission),
          joinedAt: affiliate.createdAt.toISOString(),
        };
      })
      .filter(Boolean) as {
        id: string;
        userName: string;
        ownerName: string;
        email: string | null;
        phone: string | null;
        affiliateName: string;
        normalizedAffiliateName: string;
        commissionRate: number;
        joinedAt: string;
      }[];

    if (!affiliateMetas.length) {
      return NextResponse.json({
        success: true,
        summary: {
          totalAffiliates: 0,
          activeAffiliates: 0,
          totalOrders: 0,
          lifetimeNetSales: 0,
          lifetimeCommission: 0,
          deliveredCommission: 0,
          pendingCommission: 0,
          averageCommissionRate: 0,
        },
        affiliates: [],
        reports: [],
        generatedAt: new Date().toISOString(),
      } satisfies AffiliateManagementResponse);
    }

    const affiliateConditions = affiliateMetas.map((meta) => ({
      campaignName: {
        equals: meta.affiliateName,
        mode: 'insensitive' as const,
      },
    }));

    const where: Prisma.SallaOrderWhereInput = {
      OR: affiliateConditions,
    };

    if (startDate || endDate) {
      where.placedAt = {
        gte: startDate ? new Date(`${startDate}T00:00:00.000Z`) : undefined,
        lte: endDate ? new Date(`${endDate}T23:59:59.999Z`) : undefined,
      };
    }

    const affiliateIds = affiliateMetas.map((meta) => meta.id);

    let orders: Array<{
      id: string;
      orderId: string;
      orderNumber: string | null;
      statusSlug: string | null;
      statusName: string | null;
      totalAmount: Prisma.Decimal | number | null;
      shippingAmount: Prisma.Decimal | number | null;
      placedAt: Date | null;
      campaignName: string | null;
      currency: string | null;
      affiliateCommission: Prisma.Decimal | number | null;
    }> = [];

    if (affiliateConditions.length) {
      orders = await prisma.sallaOrder.findMany({
        where,
        select: {
          id: true,
          orderId: true,
          orderNumber: true,
          statusSlug: true,
          statusName: true,
          totalAmount: true,
          shippingAmount: true,
          placedAt: true,
          campaignName: true,
          currency: true,
          affiliateCommission: true,
        },
        orderBy: { placedAt: 'desc' },
      });
    }

    let payouts: Array<
      Prisma.AffiliatePayoutGetPayload<{
        include: {
          recordedBy: {
            select: {
              id: true;
              name: true;
              username: true;
            };
          };
        };
      }>
    > = [];

    if (affiliateIds.length) {
      payouts = await prisma.affiliatePayout.findMany({
        where: {
          affiliateId: { in: affiliateIds },
        },
        include: {
          recordedBy: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    const payoutMap = new Map<
      string,
      Prisma.AffiliatePayoutGetPayload<{
        include: {
          recordedBy: {
            select: {
              id: true;
              name: true;
              username: true;
            };
          };
        };
      }>[]
    >();
    for (const payout of payouts) {
      const existing = payoutMap.get(payout.affiliateId) ?? [];
      existing.push(payout);
      payoutMap.set(payout.affiliateId, existing);
    }

    type AggregateBucket = {
      meta: (typeof affiliateMetas)[number];
      totalOrders: number;
      deliveredOrders: number;
      pendingOrders: number;
      netSales: number;
      commissionEarned: number;
      commissionPotential: number;
      statusMap: Map<
        string,
        {
          key: string;
          label: string;
          count: number;
          netAmount: number;
          commissionEarned: number;
          commissionPotential: number;
        }
      >;
      monthlyMap: Map<string, AffiliateMonthlyReport & { periodDate: string | null }>;
      latestOrders: AffiliateRecord['latestOrders'];
      lastOrderDate: Date | null;
    };

    const bucketMap = new Map<string, AggregateBucket>();
    const globalMonthly = new Map<string, AffiliateMonthlyReport & { periodDate: string | null }>();

    for (const meta of affiliateMetas) {
      bucketMap.set(meta.normalizedAffiliateName, {
        meta,
        totalOrders: 0,
        deliveredOrders: 0,
        pendingOrders: 0,
        netSales: 0,
        commissionEarned: 0,
        commissionPotential: 0,
        statusMap: new Map(),
        monthlyMap: new Map(),
        latestOrders: [],
        lastOrderDate: null,
      });
    }

    for (const order of orders) {
      const normalizedAffiliateName = normalizeAffiliateName(order.campaignName);
      if (!normalizedAffiliateName) {
        continue;
      }
      const bucket = bucketMap.get(normalizedAffiliateName);
      if (!bucket) {
        continue;
      }

      const netAmount = calculateNetAmount(order.totalAmount, order.shippingAmount);
      const commissionRate =
        order.affiliateCommission === null || order.affiliateCommission === undefined
          ? bucket.meta.commissionRate
          : Number(order.affiliateCommission);
      const potentialCommission = netAmount * (commissionRate / 100);
      const delivered = isDelivered(order.statusSlug, order.statusName);
      const realizedCommission = delivered ? potentialCommission : 0;

      bucket.totalOrders += 1;
      bucket.netSales += netAmount;
      bucket.commissionPotential += potentialCommission;
      bucket.latestOrders.push({
        id: order.id,
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        placedAt: order.placedAt ? order.placedAt.toISOString() : null,
        statusSlug: order.statusSlug,
        statusName: order.statusName,
        netAmount,
        currency: order.currency,
        commissionAmount: realizedCommission,
        isDelivered: delivered,
      });

      if (delivered) {
        bucket.deliveredOrders += 1;
        bucket.commissionEarned += realizedCommission;
      } else {
        bucket.pendingOrders += 1;
      }

      if (!bucket.lastOrderDate || (order.placedAt && order.placedAt > bucket.lastOrderDate)) {
        bucket.lastOrderDate = order.placedAt ?? bucket.lastOrderDate;
      }

      const statusKey = order.statusSlug ?? order.statusName ?? 'unknown';
      const statusLabel = order.statusName ?? order.statusSlug ?? 'غير معروف';
      const statusEntry = bucket.statusMap.get(statusKey) ?? {
        key: statusKey,
        label: statusLabel,
        count: 0,
        netAmount: 0,
        commissionEarned: 0,
        commissionPotential: 0,
      };
      statusEntry.count += 1;
      statusEntry.netAmount += netAmount;
      statusEntry.commissionEarned += realizedCommission;
      statusEntry.commissionPotential += potentialCommission;
      bucket.statusMap.set(statusKey, statusEntry);

      const monthKey = getMonthKey(order.placedAt);
      if (monthKey) {
        const periodDate = `${monthKey}-01T00:00:00.000Z`;
        const bucketMonthly = bucket.monthlyMap.get(monthKey) ?? {
          period: monthKey,
          label: getMonthLabel(order.placedAt),
          totalOrders: 0,
          deliveredOrders: 0,
          netSales: 0,
          commissionEarned: 0,
          commissionPending: 0,
          periodDate,
        };
        bucketMonthly.totalOrders += 1;
        bucketMonthly.deliveredOrders += delivered ? 1 : 0;
        bucketMonthly.netSales += netAmount;
        bucketMonthly.commissionEarned += realizedCommission;
        bucketMonthly.commissionPending += potentialCommission - realizedCommission;
        bucket.monthlyMap.set(monthKey, bucketMonthly);

        const globalMonth = globalMonthly.get(monthKey) ?? {
          period: monthKey,
          label: getMonthLabel(order.placedAt),
          totalOrders: 0,
          deliveredOrders: 0,
          netSales: 0,
          commissionEarned: 0,
          commissionPending: 0,
          periodDate,
        };
        globalMonth.totalOrders += 1;
        globalMonth.deliveredOrders += delivered ? 1 : 0;
        globalMonth.netSales += netAmount;
        globalMonth.commissionEarned += realizedCommission;
        globalMonth.commissionPending += potentialCommission - realizedCommission;
        globalMonthly.set(monthKey, globalMonth);
      }
    }

    const generatedAt = new Date();
    const responseAffiliates: AffiliateRecord[] = [];

    for (const bucket of bucketMap.values()) {
      const averageOrderValue = bucket.totalOrders > 0 ? bucket.netSales / bucket.totalOrders : 0;
      const conversionRate = bucket.totalOrders > 0 ? (bucket.deliveredOrders / bucket.totalOrders) * 100 : 0;
      const monthlyReports = Array.from(bucket.monthlyMap.values()).sort((a, b) => {
        if (!a.periodDate || !b.periodDate) {
          return 0;
        }
        return new Date(b.periodDate).getTime() - new Date(a.periodDate).getTime();
      });

      const affiliatePayouts = payoutMap.get(bucket.meta.id) ?? [];
      const totalPaid = affiliatePayouts.reduce((sum, payout) => {
        if (payout.status === 'PAID') {
          return sum + Number(payout.amount);
        }
        return sum;
      }, 0);
      const reservedAmount = affiliatePayouts.reduce((sum, payout) => {
        if (payout.status === 'CANCELLED') {
          return sum;
        }
        return sum + Number(payout.amount);
      }, 0);

      const commissionTransactions: AffiliateWalletTransaction[] = monthlyReports.map((report) => ({
        id: `${bucket.meta.id}-${report.period}`,
        type: 'commission',
        label: `عمولة ${report.label}`,
        amount: report.commissionEarned,
        currency: CURRENCY,
        date: report.periodDate ?? generatedAt.toISOString(),
        status: report.commissionEarned > 0 ? 'ready' : 'pending',
        orders: report.deliveredOrders,
      }));

      const payoutTransactions: AffiliateWalletTransaction[] = affiliatePayouts.map((payout) => ({
        id: payout.id,
        type: 'payout',
        label: payout.reference || payout.memo || 'دفعة مسجلة',
        amount: Number(payout.amount),
        currency: payout.currency || CURRENCY,
        date: (payout.paidAt ?? payout.createdAt).toISOString(),
        status:
          payout.status === 'PAID'
            ? 'paid'
            : payout.status === 'APPROVED'
            ? 'ready'
            : 'pending',
        orders: 0,
      }));

      const transactions = [...commissionTransactions, ...payoutTransactions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      const payoutEntries: AffiliatePayoutEntry[] = affiliatePayouts.map((payout) => ({
        id: payout.id,
        amount: Number(payout.amount),
        currency: payout.currency || CURRENCY,
        status: payout.status,
        reference: payout.reference,
        memo: payout.memo,
        periodStart: payout.periodStart ? payout.periodStart.toISOString() : null,
        periodEnd: payout.periodEnd ? payout.periodEnd.toISOString() : null,
        paidAt: payout.paidAt ? payout.paidAt.toISOString() : null,
        createdAt: payout.createdAt.toISOString(),
        recordedBy: payout.recordedBy
          ? {
              id: payout.recordedBy.id,
              name: payout.recordedBy.name,
              username: payout.recordedBy.username,
            }
          : null,
      }));

      const record: AffiliateRecord = {
        id: bucket.meta.id,
        userName: bucket.meta.userName,
        ownerName: bucket.meta.ownerName,
        email: bucket.meta.email,
        phone: bucket.meta.phone,
        affiliateName: bucket.meta.affiliateName,
        normalizedAffiliateName: bucket.meta.normalizedAffiliateName,
        commissionRate: bucket.meta.commissionRate,
        joinedAt: bucket.meta.joinedAt,
        stats: {
          totalOrders: bucket.totalOrders,
          deliveredOrders: bucket.deliveredOrders,
          pendingOrders: bucket.pendingOrders,
          netSales: bucket.netSales,
          averageOrderValue,
          commissionEarned: bucket.commissionEarned,
          commissionPending: bucket.commissionPotential - bucket.commissionEarned,
          projectedCommission: bucket.commissionPotential,
          conversionRate,
          lastOrderDate: bucket.lastOrderDate ? bucket.lastOrderDate.toISOString() : null,
        },
        statusBreakdown: Array.from(bucket.statusMap.values()).sort((a, b) => b.count - a.count),
        wallet: {
          availableBalance: Math.max(bucket.commissionEarned - reservedAmount, 0),
          pendingBalance: Math.max(bucket.commissionPotential - bucket.commissionEarned, 0),
          lifetimeCommission: bucket.commissionPotential,
          totalPaid,
          transactions,
        },
        payouts: payoutEntries,
        monthlyReports,
        latestOrders: bucket.latestOrders.slice(0, 8),
      };

      responseAffiliates.push(record);
    }

    const summary = responseAffiliates.reduce<AffiliateManagementSummary>(
      (acc, affiliate) => {
        acc.totalOrders += affiliate.stats.totalOrders;
        acc.lifetimeNetSales += affiliate.stats.netSales;
        acc.lifetimeCommission += affiliate.stats.projectedCommission;
        acc.deliveredCommission += affiliate.stats.commissionEarned;
        acc.pendingCommission += affiliate.stats.commissionPending;
        if (affiliate.stats.totalOrders > 0) {
          acc.activeAffiliates += 1;
        }
        return acc;
      },
      {
        totalAffiliates: affiliateMetas.length,
        activeAffiliates: 0,
        totalOrders: 0,
        lifetimeNetSales: 0,
        lifetimeCommission: 0,
        deliveredCommission: 0,
        pendingCommission: 0,
        averageCommissionRate:
          affiliateMetas.reduce((sum, meta) => sum + meta.commissionRate, 0) /
          (affiliateMetas.length || 1),
      }
    );

    const reports = Array.from(globalMonthly.values()).sort((a, b) => {
      if (!a.periodDate || !b.periodDate) {
        return 0;
      }
      return new Date(b.periodDate).getTime() - new Date(a.periodDate).getTime();
    });

    const response: AffiliateManagementResponse = {
      success: true,
      summary,
      affiliates: responseAffiliates,
      reports,
      generatedAt: generatedAt.toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    log.error('Error building affiliate management data', { error });
    return NextResponse.json({ error: 'تعذر تحميل بيانات المسوقين' }, { status: 500 });
  }
}
