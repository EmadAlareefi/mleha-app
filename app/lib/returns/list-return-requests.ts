import { isQueueTab, QUEUE_TABS, queueWhere } from '@/app/lib/returns/stage-filters';
import { deriveStage } from '@/lib/returns/workflow';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { missingReturnShipmentWhere, needsManualReturnShipment } from '@/lib/returns/missing-shipment';
import { localTrackingSelect } from '@/app/lib/local-shipping/tracking-query';

/**
 * Lists return requests with filtering, search and pagination for
 * GET /api/returns/list. Callers must authorize first — the route does; tests
 * call this directly because a session can't be read outside a Next request.
 */
export async function listReturnRequests(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const missingShipmentOnly = searchParams.get('shipment') === 'missing';

    // Filters
    const typeParams = searchParams.getAll('type').filter(Boolean); // 'return' | 'exchange'
    const statusParams = missingShipmentOnly ? [] : searchParams.getAll('status').filter(Boolean);
    const search = searchParams.get('search'); // search by order number, customer name, tracking number
    const excludeStatusParams = missingShipmentOnly ? [] : searchParams.getAll('excludeStatus');
    const inspectionParams = missingShipmentOnly ? [] : searchParams.getAll('inspection');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    // Build where clause
    const missingShipmentWhere = missingReturnShipmentWhere(now);
    const where: Prisma.ReturnRequestWhereInput = missingShipmentOnly ? { ...missingShipmentWhere } : {};

    // A mixed request has both return and exchange pieces, so it matches both filters.
    const validTypes = Array.from(
      new Set(
        typeParams
          .filter((value) => value === 'return' || value === 'exchange' || value === 'mixed')
          .flatMap((value) => (value === 'mixed' ? ['mixed'] : [value, 'mixed'])),
      ),
    );
    if (validTypes.length > 0) {
      where.type = { in: validTypes };
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

    // Queue tabs: counts use every other filter, the list adds the chosen tab.
    const queue = searchParams.get('queue');
    const baseWhere: Prisma.ReturnRequestWhereInput = { ...where };
    if (isQueueTab(queue) && queue !== 'all') {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), queueWhere(queue)];
    }
    const withCounts = searchParams.get('counts') === '1';

    // Get total count
    const [total, missingShipmentCount, queueCounts] = await Promise.all([
      prisma.returnRequest.count({ where }),
      prisma.returnRequest.count({ where: missingShipmentWhere }),
      withCounts
        ? Promise.all(
            QUEUE_TABS.map(async (tab) => [
              tab,
              await prisma.returnRequest.count({ where: { AND: [baseWhere, queueWhere(tab)] } }),
            ] as const),
          ).then((entries) => Object.fromEntries(entries))
        : Promise.resolve(null),
    ]);

    // Get paginated results
    const returnRequests = await prisma.returnRequest.findMany({
      where,
      include: {
        items: {
          select: {
            id: true,
            returnRequestId: true,
            productId: true,
            productName: true,
            productSku: true,
            variantId: true,
            variantName: true,
            quantity: true,
            price: true,
            conditionStatus: true,
            conditionNotes: true,
            damageImageData: true,
            preInspectionNotes: true,
            inspectedBy: true,
            inspectedAt: true,
            createdAt: true,
            orderItemId: true,
            unitIndex: true,
            type: true,
            ribbonRemoved: true,
            refundIncluded: true,
            restockStatus: true,
            restockedAt: true,
          },
          orderBy: [{ orderItemId: 'asc' }, { unitIndex: 'asc' }, { createdAt: 'asc' }],
        },
        exchangeLines: true,
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

    const localShipments = uniqueOrders.length ? await prisma.localShipment.findMany({
      where: { OR: uniqueOrders },
      select: localTrackingSelect,
      orderBy: { createdAt: 'desc' },
    }) : [];
    const localShipmentsByOrder = new Map<string, typeof localShipments>();
    for (const shipment of localShipments) {
      const key = `${shipment.merchantId}:${shipment.orderId}`;
      const shipments = localShipmentsByOrder.get(key) || [];
      shipments.push(shipment);
      localShipmentsByOrder.set(key, shipments);
    }

    const enrichedRequests = returnRequests.map(request => {
      const statusKey = `${request.merchantId}:${request.orderId}`;
      return {
        ...request,
        needsManualShipment: needsManualReturnShipment(request, now),
        stage: deriveStage(request),
        sallaStatus: sallaStatuses[statusKey] || null,
        localShipments: localShipmentsByOrder.get(statusKey) || [],
      };
    });

    return NextResponse.json({
      success: true,
      data: enrichedRequests,
      missingShipmentCount,
      queueCounts,
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
