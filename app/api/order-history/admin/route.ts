import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import type { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { normalizers } from '@/app/lib/salla-orders';

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

interface SerializedOrderShipment {
  id: string | null;
  company: string | null;
  trackingNumber: string | null;
  statusSlug: string | null;
  statusLabel: string | null;
  shippingType: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

function toIsoString(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function serializeOrderShipments(rawOrder: any): SerializedOrderShipment[] {
  if (!rawOrder || typeof rawOrder !== 'object') return [];
  const shipments = Array.isArray((rawOrder as any).shipments)
    ? (rawOrder as any).shipments
    : [];

  return shipments.map((shipment: any) => {
    const shippedAt = normalizers.date(
      shipment?.shipped_at ??
        shipment?.shippedAt ??
        shipment?.created_at ??
        shipment?.createdAt
    );
    const deliveredAt = normalizers.date(
      shipment?.delivered_at ??
        shipment?.deliveredAt ??
        shipment?.delivered_date ??
        shipment?.deliveredDate
    );

    return {
      id: normalizers.id(shipment?.id ?? shipment?.shipment_id),
      company: normalizers.string(
        shipment?.company ??
          shipment?.shipping_company ??
          shipment?.carrier ??
          shipment?.provider
      ),
      trackingNumber: normalizers.string(
        shipment?.tracking_number ??
          shipment?.tracking ??
          shipment?.trackingNumber
      ),
      statusSlug: normalizers.status(
        shipment?.status?.slug ??
          shipment?.status ??
          shipment?.status_code
      ),
      statusLabel: normalizers.string(
        shipment?.status_label ??
          shipment?.status?.name ??
          shipment?.status_name
      ),
      shippingType: normalizers.string(
        shipment?.type ??
          shipment?.shipment_type ??
          shipment?.delivery_type
      ),
      shippedAt: toIsoString(shippedAt),
      deliveredAt: toIsoString(deliveredAt),
    };
  });
}

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
    // Check user session and role
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userRole = (session.user as any)?.role;
    const userRoles = (session.user as any)?.roles || [];
    const isAccountant = userRole === 'accountant' || userRoles.includes('accountant');
    const isAdmin = userRole === 'admin';

    // Only admin and accountant can access this endpoint
    if (!isAdmin && !isAccountant) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const status = searchParams.get('status');
    const campaignSource = searchParams.get('campaignSource');
    const campaignName = searchParams.get('campaignName');
    const paymentMethod = searchParams.get('paymentMethod');
    const erpSyncedParam = searchParams.get('erpSynced');
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

    if (campaignSource) {
      where.campaignSource = campaignSource;
    }

    if (campaignName) {
      where.campaignName = campaignName;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    if (erpSyncedParam === 'true') {
      where.erpSyncedAt = { not: null };
    } else if (erpSyncedParam === 'false') {
      where.erpSyncedAt = null;
    }

    const [orders, totalCount, amountStats, statusBreakdown, paymentMethodBreakdown] = await Promise.all([
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
      prisma.sallaOrder.groupBy({
        where: merchantId ? { merchantId } : {},
        by: ['paymentMethod'],
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

    const serializedOrders = orders.map((order) => {
      const shipments = serializeOrderShipments(order.rawOrder);
      const baseOrder = {
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
        fulfillmentCompany: order.fulfillmentCompany,
        trackingNumber: order.trackingNumber,
        placedAt: order.placedAt?.toISOString() ?? null,
        updatedAtRemote: order.updatedAtRemote?.toISOString() ?? null,
        campaignSource: order.campaignSource,
        campaignMedium: order.campaignMedium,
        campaignName: order.campaignName,
        shipments,
      };

      // Hide customer information for accountants
      if (isAccountant) {
        return {
          ...baseOrder,
          customerId: null,
          customerName: null,
          customerMobile: null,
          customerEmail: null,
          customerCity: null,
          customerCountry: null,
          rawOrder: {}, // Hide raw order data which may contain customer info
        };
      }

      // Return full data for admins
      return {
        ...baseOrder,
        customerId: order.customerId,
        customerName: order.customerName,
        customerMobile: order.customerMobile,
        customerEmail: order.customerEmail,
        customerCity: order.customerCity,
        customerCountry: order.customerCountry,
        rawOrder: order.rawOrder,
      };
    });

    const availableStatuses = statusStats.map((status) => ({
      slug: status.slug,
      name: status.name,
    }));

    const availablePaymentMethods = paymentMethodBreakdown
      .filter((pm) => pm.paymentMethod)
      .map((pm) => ({
        value: pm.paymentMethod,
        label: pm.paymentMethod,
        count: pm._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      success: true,
      orders: serializedOrders,
      stats,
      statusStats,
      filters: {
        statuses: availableStatuses,
        paymentMethods: availablePaymentMethods,
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
