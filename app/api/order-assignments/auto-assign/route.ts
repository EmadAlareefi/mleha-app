import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

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

    // Check if user already has an active order (including shipped orders waiting to be completed)
    // Only count active orders: 'assigned', 'preparing', 'shipped'
    // Exclude 'completed' and 'removed' orders (these are kept for reporting but not active)
    const currentAssignments = await prisma.orderAssignment.count({
      where: {
        userId: user.id,
        status: {
          in: ['assigned', 'preparing', 'shipped'],
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

    // Fetch new orders from Salla based on user's order type
    log.info('Fetching new orders for auto-assignment', {
      userId: user.id,
      orderType: user.orderType,
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
    const { getSallaOrderStatuses, getStatusBySlug } = await import('@/app/lib/salla-statuses');
    const statuses = await getSallaOrderStatuses(MERCHANT_ID);

    // ALWAYS fetch orders with status "طلب جديد" (New Order)
    // This is the parent status with ID 449146439 and slug 'under_review'
    // Find by name to ensure we get the correct parent status
    const newOrderStatus = statuses.find(s =>
      s.name === 'طلب جديد' ||
      s.id === 449146439 ||
      (s.slug === 'under_review' && !s.parent)
    );

    const statusFilter = newOrderStatus?.id.toString() || '449146439'; // Use ID 449146439 as fallback

    log.info('Fetching orders with status', {
      statusFilter,
      statusName: newOrderStatus?.name || 'طلب جديد',
      statusId: newOrderStatus?.id || statusFilter,
    });

    // Fetch orders from Salla using status ID, sorted by oldest first
    const baseUrl = 'https://api.salla.dev/admin/v2';
    const url = `${baseUrl}/orders?status=${statusFilter}&per_page=${availableSlots}&sort_by=created_at-asc`;

    // Use retry logic for fetching orders
    const { fetchSallaWithRetry } = await import('@/app/lib/fetch-with-retry');
    let response: Response;

    try {
      response = await fetchSallaWithRetry(url, accessToken);
    } catch (error) {
      log.error('Failed to fetch orders from Salla after retries', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return NextResponse.json(
        { error: 'فشل جلب الطلبات من سلة' },
        { status: 500 }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Failed to fetch orders from Salla', {
        status: response.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'فشل جلب الطلبات من سلة' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const orders = data.data || [];

    log.info('Orders fetched from Salla', {
      totalOrders: orders.length,
      orderIds: orders.map((o: any) => o.id),
    });

    // Filter orders based on payment method (COD/prepaid) if needed
    let filteredOrders = orders;

    if (user.orderType === 'cod') {
      filteredOrders = orders.filter((order: any) =>
        order.payment_method === 'cash_on_delivery' || order.payment_method === 'cod'
      );
      log.info('Filtered by COD payment method', {
        beforeFilter: orders.length,
        afterFilter: filteredOrders.length,
        filtered: orders.length - filteredOrders.length,
      });
    } else if (user.orderType === 'prepaid') {
      filteredOrders = orders.filter((order: any) =>
        order.payment_method !== 'cash_on_delivery' && order.payment_method !== 'cod'
      );
      log.info('Filtered by prepaid payment method', {
        beforeFilter: orders.length,
        afterFilter: filteredOrders.length,
        filtered: orders.length - filteredOrders.length,
      });
    }

    // Get already assigned order IDs for this merchant (only active assignments)
    // This prevents assigning orders that are actively being worked on by other users
    const assignedOrderIds = await prisma.orderAssignment.findMany({
      where: {
        merchantId: MERCHANT_ID,
        status: {
          in: ['assigned', 'preparing', 'shipped'],
        },
      },
      select: {
        orderId: true,
      },
    });

    const assignedOrderIdSet = new Set(assignedOrderIds.map(a => a.orderId));

    log.info('Active assignments by others', {
      count: assignedOrderIdSet.size,
      orderIds: Array.from(assignedOrderIdSet),
    });

    // Also get orders already assigned to THIS user (regardless of status)
    // This prevents unique constraint violations on (userId, orderId)
    const userAssignedOrders = await prisma.orderAssignment.findMany({
      where: {
        userId: user.id,
      },
      select: {
        orderId: true,
      },
    });

    const userAssignedOrderIdSet = new Set(userAssignedOrders.map(a => a.orderId));

    log.info('Orders already assigned to this user', {
      count: userAssignedOrderIdSet.size,
      orderIds: Array.from(userAssignedOrderIdSet),
    });

    // Filter out already assigned orders (both active assignments by others and any assignment by this user)
    const unassignedOrders = filteredOrders.filter(
      (order: any) => !assignedOrderIdSet.has(String(order.id)) && !userAssignedOrderIdSet.has(String(order.id))
    );

    log.info('Unassigned orders after filtering', {
      beforeFilter: filteredOrders.length,
      afterFilter: unassignedOrders.length,
      filteredByActiveAssignments: filteredOrders.filter((o: any) => assignedOrderIdSet.has(String(o.id))).length,
      filteredByUserAssignments: filteredOrders.filter((o: any) => userAssignedOrderIdSet.has(String(o.id))).length,
      availableOrderIds: unassignedOrders.map((o: any) => o.id),
    });

    // Limit to available slots
    const ordersToAssign = unassignedOrders.slice(0, availableSlots);

    // Fetch complete order details including items for each order
    const ordersWithDetails = await Promise.all(
      ordersToAssign.map(async (order: any) => {
        try {
          // Fetch order details with retry logic
          const detailUrl = `${baseUrl}/orders/${order.id}`;
          const detailResponse = await fetchSallaWithRetry(detailUrl, accessToken);

          if (detailResponse.ok) {
            const detailData = await detailResponse.json();
            const orderDetail = detailData.data || order;

            // Fetch order items separately using query parameter with retry logic
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
        return { ...order, items: [] }; // Fallback to basic order data with empty items
      })
    );

    // Create assignments with complete order data
    const assignments = await Promise.all(
      ordersWithDetails.map((order: any) =>
        prisma.orderAssignment.create({
          data: {
            userId: user.id,
            merchantId: MERCHANT_ID,
            orderId: String(order.id),
            orderNumber: String(order.reference_id || order.id),
            orderData: order as any, // Now includes full product details with SKU
            sallaStatus: order.status?.slug || order.status?.id?.toString() || statusFilter,
          },
        })
      )
    );

    // Update Salla status to "جاري التجهيز" (processing/preparing) for newly assigned orders
    // This prevents overlap between users as the order is immediately marked as being processed
    // Use dynamic lookup instead of hardcoded ID
    const preparingStatus = getStatusBySlug(statuses, 'in_progress');
    const preparingStatusId = preparingStatus?.id.toString() || '1939592358'; // Fallback to default ID

    for (const assignment of assignments) {
      try {
        const updateUrl = `${baseUrl}/orders/${assignment.orderId}/status`;
        const response = await fetch(updateUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status_id: parseInt(preparingStatusId), // جاري التجهيز - use status_id as number
          }),
        });

        if (response.ok) {
          // Update the assignment record with the new Salla status
          await prisma.orderAssignment.update({
            where: { id: assignment.id },
            data: {
              sallaStatus: preparingStatus?.slug || preparingStatusId,
              sallaUpdated: true,
            },
          });

          log.info('Order status updated to preparing on assignment', {
            orderId: assignment.orderId,
            statusId: preparingStatusId,
            statusName: preparingStatus?.name || 'جاري التجهيز',
          });
        }
      } catch (error) {
        log.warn('Failed to update Salla status on assignment', { orderId: assignment.orderId, error });
      }
    }

    log.info('Orders auto-assigned successfully', {
      userId: user.id,
      assignedCount: assignments.length,
    });

    return NextResponse.json({
      success: true,
      assigned: assignments.length,
      totalAssignments: currentAssignments + assignments.length,
      batchSize: user.maxOrders,
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
