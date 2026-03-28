import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/returns/list
 * Get all return requests with filtering and search
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Filters
    const typeParams = searchParams.getAll('type').filter(Boolean); // 'return' | 'exchange'
    const statusParams = searchParams.getAll('status').filter(Boolean); // allow multiple statuses
    const search = searchParams.get('search'); // search by order number, customer name, tracking number
    const excludeStatusParams = searchParams.getAll('excludeStatus'); // statuses to exclude
    const inspectionParams = searchParams.getAll('inspection'); // inspection filters
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.ReturnRequestWhereInput = {};

    if (typeParams.length === 1) {
      const [singleType] = typeParams;
      if (singleType === 'return' || singleType === 'exchange') {
        where.type = singleType;
      }
    } else if (typeParams.length > 1) {
      const validTypes = typeParams.filter((value) => value === 'return' || value === 'exchange');
      if (validTypes.length > 0) {
        where.type = { in: validTypes };
      }
    }

    if (statusParams.length === 1) {
      where.status = statusParams[0];
    } else if (statusParams.length > 1) {
      where.status = { in: statusParams };
    }
    if (excludeStatusParams.length > 0) {
      where.status = {
        ...(typeof where.status === 'string' ? { in: [where.status] } : where.status),
        notIn: excludeStatusParams,
      };
    }

    if (search && search.trim()) {
      where.OR = [
        { orderNumber: { contains: search.trim(), mode: 'insensitive' } },
        { customerName: { contains: search.trim(), mode: 'insensitive' } },
        { customerEmail: { contains: search.trim(), mode: 'insensitive' } },
        { customerPhone: { contains: search.trim(), mode: 'insensitive' } },
        { smsaTrackingNumber: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const inspectionFilters: Prisma.ReturnRequestWhereInput[] = [];
    const includeInspected = inspectionParams.includes('inspected');
    const includeReview = inspectionParams.includes('review');

    if (includeInspected) {
      inspectionFilters.push({
        items: {
          some: {
            conditionStatus: { not: null },
          },
        },
      });
    }

    if (includeReview) {
      inspectionFilters.push({
        OR: [
          { status: 'pending_review' },
          {
            items: {
              none: {
                conditionStatus: { not: null },
              },
            },
          },
        ],
      });
    }

    if (inspectionFilters.length > 0) {
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];

      if (inspectionFilters.length === 1) {
        existingAnd.push(inspectionFilters[0]);
      } else {
        existingAnd.push({ OR: inspectionFilters });
      }

      where.AND = existingAnd;
    }

    // Get total count
    const total = await prisma.returnRequest.count({ where });

    // Get paginated results
    const returnRequests = await prisma.returnRequest.findMany({
      where,
      include: {
        items: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    });

    // Fetch corresponding Salla order statuses
    const uniqueOrders = Array.from(
      new Map(
        returnRequests
          .filter(req => req.merchantId && req.orderId)
          .map(req => [
            `${req.merchantId}:${req.orderId}`,
            { merchantId: req.merchantId, orderId: req.orderId },
          ])
      ).values()
    );

    let sallaStatuses: Record<string, { name?: string; slug?: string }> = {};

    if (uniqueOrders.length > 0) {
      const sallaOrders = await prisma.sallaOrder.findMany({
        where: {
          OR: uniqueOrders.map(order => ({
            merchantId: order.merchantId,
            orderId: order.orderId,
          })),
        },
        select: {
          merchantId: true,
          orderId: true,
          statusName: true,
          statusSlug: true,
        },
      });

      sallaStatuses = sallaOrders.reduce((acc, order) => {
        const key = `${order.merchantId}:${order.orderId}`;
        acc[key] = {
          name: order.statusName || undefined,
          slug: order.statusSlug || undefined,
        };
        return acc;
      }, {} as Record<string, { name?: string; slug?: string }>);
    }

    const enrichedRequests = returnRequests.map(request => {
      const statusKey = `${request.merchantId}:${request.orderId}`;
      return {
        ...request,
        sallaStatus: sallaStatuses[statusKey] || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: enrichedRequests,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });

  } catch (error) {
    log.error('Error fetching return requests', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب طلبات الإرجاع' },
      { status: 500 }
    );
  }
}
