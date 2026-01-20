import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { ACTIVE_ASSIGNMENT_STATUS_VALUES } from '@/lib/order-assignment-statuses';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * POST /api/order-assignments/auto-assign
 * Auto-assign new orders to a user based on their settings
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    // Get user
    const user = await prisma.orderUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'المستخدم غير نشط' },
        { status: 400 }
      );
    }

    // Check if user already has an active order (including shipped or review orders waiting to be completed)
    // Only count active orders defined in ACTIVE_ASSIGNMENT_STATUSES
    // Exclude 'completed' and 'removed' orders (these are kept for reporting but not active)
    const currentAssignments = await prisma.orderAssignment.count({
      where: {
        userId: user.id,
        status: {
          in: ACTIVE_ASSIGNMENT_STATUS_VALUES,
        },
      },
    });

    // If user already has an active order, don't assign a new one
    if (currentAssignments > 0) {
      log.info('User already has an active order - skipping assignment', {
        userId: user.id,
        currentAssignments,
      });

      return NextResponse.json({
        success: true,
        assigned: 0,
        totalAssignments: currentAssignments,
        message: 'لديك طلب نشط بالفعل',
      });
    }

    // Assign only ONE order at a time to prevent overlap
    const availableSlots = 1;
    const ORDERS_FETCH_BUFFER = 10;
    const MAX_FETCH_LIMIT = 50;
    const fetchLimit = Math.min(MAX_FETCH_LIMIT, Math.max(availableSlots * ORDERS_FETCH_BUFFER, 10));

    // Fetch new orders from Salla based on user's order type
    log.info('Fetching new orders for auto-assignment', {
      userId: user.id,
      availableSlots,
    });

    // Get Salla access token
    const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
    const accessToken = await getSallaAccessToken(MERCHANT_ID);

    if (!accessToken) {
      log.error('No valid Salla access token');
      return NextResponse.json(
        { error: 'فشل الاتصال بسلة' },
        { status: 500 }
      );
    }

    // Fetch order statuses to get the correct status information
    const { getSallaOrderStatuses, getStatusBySlug, getNewOrderStatusFilters } = await import('@/app/lib/salla-statuses');
    const statuses = await getSallaOrderStatuses(MERCHANT_ID);

    const { primaryStatus: newOrderStatus, queryValues: statusFilters } = getNewOrderStatusFilters(statuses);
    const filtersToQuery = statusFilters.length > 0 ? statusFilters : ['under_review', '449146439'];
    const fallbackStatusValue = filtersToQuery[0] || 'under_review';
    const preparingStatus = getStatusBySlug(statuses, 'in_progress');
    const preparingStatusId = preparingStatus?.id?.toString() || '1939592358';
    const preparingStatusSlug = preparingStatus?.slug || 'in_progress';
    const numericPreparingStatusId = Number.parseInt(preparingStatusId, 10);
    const resolvedPreparingStatusId = Number.isNaN(numericPreparingStatusId) ? 1939592358 : numericPreparingStatusId;

    log.info('Fetching orders with status filters', {
      statusFilters: filtersToQuery,
      statusName: newOrderStatus?.name || 'طلب جديد',
      statusId: newOrderStatus?.id || null,
    });

    const getOrderTimestamp = (order: any): number => {
      const candidates = [
        order?.date?.date,
        order?.created_at,
        order?.createdAt,
        order?.updated_at,
        order?.updatedAt,
      ];
      for (const candidate of candidates) {
        if (candidate) {
          const timestamp = Date.parse(candidate);
          if (!Number.isNaN(timestamp)) {
            return timestamp;
          }
        }
      }
      return 0;
    };

    const baseUrl = 'https://api.salla.dev/admin/v2';
    const { fetchSallaWithRetry } = await import('@/app/lib/fetch-with-retry');
    const allOrders: any[] = [];
    const seenOrderIds = new Set<string>();
    let successfulFetches = 0;

    for (const filterValue of filtersToQuery) {
      const url = `${baseUrl}/orders?status=${encodeURIComponent(filterValue)}&per_page=${fetchLimit}&sort_by=created_at-asc`;

      let response: Response;
      try {
        response = await fetchSallaWithRetry(url, accessToken);
      } catch (error) {
        log.warn('Failed to fetch orders from Salla after retries', {
          statusFilter: filterValue,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        log.warn('Failed to fetch orders from Salla', {
          status: response.status,
          error: errorText,
          statusFilter: filterValue,
        });
        continue;
      }

      successfulFetches += 1;
      const data = await response.json();
      const orders = Array.isArray(data.data) ? data.data : [];
      orders.forEach((order: any) => {
        const key = String(order?.id ?? order?.reference_id ?? '');
        if (!key || seenOrderIds.has(key)) {
          return;
        }
        seenOrderIds.add(key);
        allOrders.push(order);
      });
    }

    if (successfulFetches === 0) {
      return NextResponse.json(
        { error: 'فشل جلب الطلبات من سلة' },
        { status: 500 }
      );
    }

    const sortedOrders = allOrders.sort(
      (a, b) => getOrderTimestamp(a) - getOrderTimestamp(b)
    );
    const orders = sortedOrders.slice(0, fetchLimit);

    const extractOrderId = (order: any): string | null => {
      const rawId =
        order?.id ??
        order?.order_id ??
        order?.orderId ??
        order?.reference_id ??
        order?.referenceId;
      if (rawId === undefined || rawId === null) {
        return null;
      }
      const value = String(rawId).trim();
      return value ? value : null;
    };

    const orderIdsForLookup = orders
      .map((order: any) => extractOrderId(order))
      .filter((orderId): orderId is string => Boolean(orderId));

    const existingAssignments = orderIdsForLookup.length
      ? await prisma.orderAssignment.findMany({
          where: {
            merchantId: MERCHANT_ID,
            orderId: { in: orderIdsForLookup },
          },
          select: {
            orderId: true,
          },
        })
      : [];

    const assignedOrderIds = new Set(existingAssignments.map((assignment) => assignment.orderId));

    log.info('Orders fetched from Salla', {
      totalOrders: orders.length,
      uniqueOrders: sortedOrders.length,
      statusFilters: filtersToQuery,
      orderIds: orders.map((o: any) => o.id),
    });

    // Load high priority order IDs to prioritize in assignment
    const highPriorityOrders = await prisma.highPriorityOrder.findMany({
      where: { merchantId: MERCHANT_ID },
      orderBy: { createdAt: 'asc' },
      select: { orderId: true },
    });
    const priorityRank = new Map(
      highPriorityOrders.map((priorityOrder, index) => [String(priorityOrder.orderId), index]),
    );
    if (highPriorityOrders.length > 0) {
      log.info('High priority orders detected', {
        total: highPriorityOrders.length,
        orderIds: highPriorityOrders.map((order) => order.orderId),
      });
    }

    const unassignedOrders = orders.filter((order: any) => {
      const orderId = extractOrderId(order);
      if (!orderId) {
        return false;
      }
      return !assignedOrderIds.has(orderId);
    });

    log.info('Available Salla orders after filtering historical assignments', {
      beforeFilter: orders.length,
      afterFilter: unassignedOrders.length,
      skippedDueToHistory: assignedOrderIds.size,
    });

    const originalIndex = new Map<string, number>(
      unassignedOrders.map((order: any, index: number) => [String(order.id), index])
    );
    const prioritizedOrders = [...unassignedOrders].sort((a: any, b: any) => {
      const aKey = String(a.id);
      const bKey = String(b.id);
      const aRank = priorityRank.has(aKey) ? priorityRank.get(aKey)! : Number.POSITIVE_INFINITY;
      const bRank = priorityRank.has(bKey) ? priorityRank.get(bKey)! : Number.POSITIVE_INFINITY;

      if (aRank !== bRank) {
        return aRank - bRank;
      }

      return (originalIndex.get(aKey) ?? 0) - (originalIndex.get(bKey) ?? 0);
    });

    log.info('Unassigned orders after prioritization', {
      availableOrderIds: prioritizedOrders.map((o: any) => o.id),
    });

    const fetchOrderDetailsWithItems = async (order: any) => {
      try {
        const detailUrl = `${baseUrl}/orders/${order.id}`;
        const detailResponse = await fetchSallaWithRetry(detailUrl, accessToken);

        if (detailResponse.ok) {
          const detailData = await detailResponse.json();
          const orderDetail = detailData.data || order;

          try {
            const itemsUrl = `${baseUrl}/orders/items?order_id=${order.id}`;
            const itemsResponse = await fetchSallaWithRetry(itemsUrl, accessToken);

            if (itemsResponse.ok) {
              const itemsData = await itemsResponse.json();
              orderDetail.items = itemsData.data || [];
              log.info('Fetched order items', {
                orderId: order.id,
                itemsCount: orderDetail.items.length,
              });
            } else {
              const errorText = await itemsResponse.text();
              log.error('Failed to fetch order items', {
                orderId: order.id,
                status: itemsResponse.status,
                error: errorText,
              });
              orderDetail.items = [];
            }
          } catch (itemsError) {
            log.warn('Failed to fetch order items', { orderId: order.id, error: itemsError });
            orderDetail.items = [];
          }

          return orderDetail;
        }
      } catch (error) {
        log.warn('Failed to fetch order details', { orderId: order.id, error });
      }
      return { ...order, items: [] };
    };

    const assignments: Awaited<ReturnType<typeof prisma.orderAssignment.create>>[] = [];
    let skippedDueToDuplicate = 0;
    let skippedDueToStatusUpdate = 0;

    for (const order of prioritizedOrders) {
      if (assignments.length >= availableSlots) {
        break;
      }

      const orderWithDetails = await fetchOrderDetailsWithItems(order);

      const normalizedOrderId = extractOrderId(orderWithDetails) || extractOrderId(order);
      const normalizedOrderNumber = String(
        orderWithDetails.reference_id ||
        orderWithDetails.id ||
        order.reference_id ||
        order.id
      );

      if (!normalizedOrderId) {
        log.warn('Skipping order without valid ID', { order });
        continue;
      }

      try {
        const assignment = await prisma.orderAssignment.create({
          data: {
            userId: user.id,
            merchantId: MERCHANT_ID,
            orderId: normalizedOrderId,
            orderNumber: normalizedOrderNumber,
            orderData: orderWithDetails as any,
            sallaStatus:
              orderWithDetails.status?.slug ||
              orderWithDetails.status?.id?.toString() ||
              order.status?.slug ||
              order.status?.id?.toString() ||
              fallbackStatusValue,
          },
        });

        const updateUrl = `${baseUrl}/orders/${normalizedOrderId}/status`;
        let statusUpdated = false;

        try {
          const statusResponse = await fetchSallaWithRetry(updateUrl, accessToken, {
            method: 'POST',
            body: JSON.stringify({
              status_id: resolvedPreparingStatusId,
            }),
          });

          if (statusResponse.ok) {
            const updatedAssignment = await prisma.orderAssignment.update({
              where: { id: assignment.id },
              data: {
                sallaStatus: preparingStatusSlug,
                sallaUpdated: true,
              },
            });
            assignments.push(updatedAssignment);
            statusUpdated = true;
          } else {
            const errorText = await statusResponse.text();
            log.warn('Failed to update Salla status to preparing', {
              orderId: normalizedOrderId,
              userId: user.id,
              status: statusResponse.status,
              error: errorText,
            });
          }
        } catch (statusError) {
          log.warn('Error updating Salla status to preparing', {
            orderId: normalizedOrderId,
            userId: user.id,
            error: statusError instanceof Error ? statusError.message : statusError,
          });
        }

        if (!statusUpdated) {
          skippedDueToStatusUpdate += 1;
          await prisma.orderAssignment.delete({ where: { id: assignment.id } });
          continue;
        }
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          skippedDueToDuplicate += 1;
          log.warn('Order already assigned to another user during auto-assignment', {
            orderId: normalizedOrderId,
            userId: user.id,
            target: error.meta?.target,
          });
          continue;
        }
        throw error;
      }
    }

    if (skippedDueToDuplicate > 0) {
      log.info('Some orders were skipped because they were already assigned', {
        userId: user.id,
        skippedDueToDuplicate,
      });
    }

    if (skippedDueToStatusUpdate > 0) {
      log.warn('Skipped orders because Salla status could not be updated to in_progress', {
        userId: user.id,
        skippedDueToStatusUpdate,
      });
    }
    log.info('Order status updated to preparing on assignment', {
      userId: user.id,
      assignmentsUpdated: assignments.map((assignment) => assignment.orderId),
      statusId: preparingStatusId,
      statusName: preparingStatus?.name || 'جاري التجهيز',
    });
    log.info('Orders auto-assigned successfully', {
      userId: user.id,
      assignedCount: assignments.length,
    });

    return NextResponse.json({
      success: true,
      assigned: assignments.length,
      totalAssignments: currentAssignments + assignments.length,
      assignments: assignments.map(a => ({
        id: a.id,
        orderId: a.orderId,
        orderNumber: a.orderNumber,
        status: a.status,
      })),
    });

  } catch (error) {
    log.error('Error auto-assigning orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تعيين الطلبات' },
      { status: 500 }
    );
  }
}
