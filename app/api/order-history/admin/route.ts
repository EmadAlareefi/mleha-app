import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

const STATUS_FILTERS: Record<string, string[]> = {
  completed: ['completed', 'delivered', 'ready_for_pickup', 'ready', 'fulfilled'],
  cancelled: ['canceled', 'cancelled', 'restored'],
  removed: ['removed'],
};

const STATUS_CATEGORY = {
  completed: new Set(['completed', 'delivered', 'ready_for_pickup', 'ready', 'fulfilled']),
  cancelled: new Set(['cancelled', 'canceled', 'restored']),
};

function normalizeStatusSlug(slug: string | null): string {
  if (!slug) return 'unknown';
  return slug.toLowerCase();
}

function getStatusCategory(slug: string | null): 'completed' | 'cancelled' | 'inProgress' {
  const normalized = normalizeStatusSlug(slug);
  if (STATUS_CATEGORY.completed.has(normalized)) return 'completed';
  if (STATUS_CATEGORY.cancelled.has(normalized)) return 'cancelled';
  return 'inProgress';
}

/**
 * GET /api/order-history/admin
 * Get order history for admin - can filter by user and date
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const status = searchParams.get('status');
    const sortDirectionParam = searchParams.get('sortDirection');
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');

    const limit = Math.min(
      Math.max(Number.parseInt(limitParam ?? '50', 10) || 50, 1),
      200
    );
    const page = Math.max(Number.parseInt(pageParam ?? '1', 10) || 1, 1);
    const skip = (page - 1) * limit;
    const sortDirection = sortDirectionParam === 'asc' ? 'asc' : 'desc';

    const where: Prisma.SallaOrderWhereInput = {};

    if (merchantId) {
      where.merchantId = merchantId;
    }

    if (startDate || endDate) {
      where.placedAt = {
        gte: startDate ? new Date(`${startDate}T00:00:00.000Z`) : undefined,
        lte: endDate ? new Date(`${endDate}T23:59:59.999Z`) : undefined,
      };
    }

    if (status) {
      const normalized = status.toLowerCase();
      const mapped = STATUS_FILTERS[normalized];
      if (mapped?.length) {
        where.statusSlug = { in: mapped };
      } else {
        where.statusSlug = normalized;
      }
    }

    const [orders, totalCount, amountStats, statusBreakdown] = await Promise.all([
      prisma.sallaOrder.findMany({
        where,
        orderBy: {
          placedAt: sortDirection,
        },
        skip,
        take: limit,
      }),
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
      }),
    ]);

    // Calculate statistics
    const categoryCounts = statusBreakdown.reduce(
      (acc, entry) => {
        const category = getStatusCategory(entry.statusSlug);
        acc[category] += entry._count._all ?? 0;
        return acc;
      },
      { completed: 0, cancelled: 0, inProgress: 0 }
    );

    const totalAmount = Number(amountStats._sum.totalAmount ?? 0);

    const stats = {
      total: totalCount,
      completed: categoryCounts.completed,
      cancelled: categoryCounts.cancelled,
      inProgress: categoryCounts.inProgress,
      totalAmount,
      averageAmount: totalCount > 0 ? totalAmount / totalCount : 0,
    };

    const statusStats = statusBreakdown
      .map((entry) => {
        const slug = normalizeStatusSlug(entry.statusSlug);
        const count = entry._count._all ?? 0;
        const percentage = totalCount > 0 ? (count / totalCount) * 100 : 0;
        return {
          slug,
          name: entry.statusName ?? entry.statusSlug ?? 'غير معروف',
          count,
          percentage,
        };
      })
      .sort((a, b) => b.count - a.count);

    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

    const serializedOrders = orders.map((order) => ({
      id: order.id,
      merchantId: order.merchantId,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      statusSlug: order.statusSlug,
      statusName: order.statusName,
      fulfillmentStatus: order.fulfillmentStatus,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      currency: order.currency,
      subtotalAmount: order.subtotalAmount ? Number(order.subtotalAmount) : null,
      taxAmount: order.taxAmount ? Number(order.taxAmount) : null,
      erpSyncedAt: order.erpSyncedAt ? order.erpSyncedAt.toISOString() : null,
      erpInvoiceId: order.erpInvoiceId,
      erpSyncError: order.erpSyncError,
      shippingAmount: order.shippingAmount ? Number(order.shippingAmount) : null,
      discountAmount: order.discountAmount ? Number(order.discountAmount) : null,
      totalAmount: order.totalAmount ? Number(order.totalAmount) : null,
      customerId: order.customerId,
      customerName: order.customerName,
      customerMobile: order.customerMobile,
      customerEmail: order.customerEmail,
      customerCity: order.customerCity,
      customerCountry: order.customerCountry,
      fulfillmentCompany: order.fulfillmentCompany,
      trackingNumber: order.trackingNumber,
      placedAt: order.placedAt?.toISOString() ?? null,
      updatedAtRemote: order.updatedAtRemote?.toISOString() ?? null,
      rawOrder: order.rawOrder,
    }));

    const availableStatuses = statusStats.map((status) => ({
      slug: status.slug,
      name: status.name,
    }));

    return NextResponse.json({
      success: true,
      orders: serializedOrders,
      stats,
      statusStats,
      filters: {
        statuses: availableStatuses,
      },
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasMore: totalPages > 0 ? page < totalPages : false,
      },
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
