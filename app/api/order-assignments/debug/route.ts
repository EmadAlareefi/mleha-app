import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { getSallaOrderStatuses, getNewOrderStatusFilters } from '@/app/lib/salla-statuses';
import { log } from '@/app/lib/logger';
import { ACTIVE_ASSIGNMENT_STATUS_VALUES } from '@/lib/order-assignment-statuses';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * GET /api/order-assignments/debug?userId=xxx
 * Debug endpoint to help troubleshoot order assignment issues
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    // Get user configuration
    const user = await prisma.orderUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    // Get Salla access token
    const accessToken = await getSallaAccessToken(MERCHANT_ID);
    if (!accessToken) {
      return NextResponse.json(
        { error: 'فشل الاتصال بسلة' },
        { status: 500 }
      );
    }

    // Fetch order statuses
    const statuses = await getSallaOrderStatuses(MERCHANT_ID);
    const { primaryStatus: underReviewStatus, queryValues } = getNewOrderStatusFilters(statuses);
    const statusFilters = queryValues.length > 0 ? queryValues : ['under_review', '566146469'];
    const primaryStatusFilter = statusFilters[0] || null;
    const statusInfo = underReviewStatus;

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

    // Fetch orders from Salla with these statuses
    const baseUrl = 'https://api.salla.dev/admin/v2';
    const { fetchSallaWithRetry } = await import('@/app/lib/fetch-with-retry');
    const allOrders: any[] = [];
    const seenOrderIds = new Set<string>();
    let successfulFetches = 0;

    for (const filterValue of statusFilters) {
      const url = `${baseUrl}/orders?status=${encodeURIComponent(filterValue)}&per_page=50&sort_by=created_at-asc`;
      let response: Response;
      try {
        response = await fetchSallaWithRetry(url, accessToken);
      } catch (error) {
        log.warn('Failed to fetch debug orders from Salla after retries', {
          statusFilter: filterValue,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        log.warn('Failed to fetch debug orders from Salla', {
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
      return NextResponse.json({
        error: 'فشل جلب الطلبات من سلة',
        details: 'لم يتمكن النظام من تحميل طلبات حالة "طلب جديد"',
      }, { status: 500 });
    }

    const sortedOrders = allOrders.sort(
      (a, b) => getOrderTimestamp(a) - getOrderTimestamp(b)
    );
    const orders = sortedOrders.slice(0, 50);

    // Get currently active assigned order IDs (exclude completed/removed for reporting)
    const assignedOrders = await prisma.orderAssignment.findMany({
      where: {
        merchantId: MERCHANT_ID,
        status: {
          in: ACTIVE_ASSIGNMENT_STATUS_VALUES,
        },
      },
      select: {
        orderId: true,
        userId: true,
        status: true,
        assignedAt: true,
      },
    });

    const assignedOrderIdSet = new Set(assignedOrders.map(a => a.orderId));
    const unassignedOrders = orders.filter(
      (order: any) => !assignedOrderIdSet.has(String(order.id))
    );

    // Current user's active assignments (including shipped)
    const userAssignments = await prisma.orderAssignment.count({
      where: {
        userId: user.id,
        status: {
          in: ACTIVE_ASSIGNMENT_STATUS_VALUES,
        },
      },
    });

    return NextResponse.json({
      success: true,
      debug: {
        user: {
          id: user.id,
          name: user.name,
          autoAssign: user.autoAssign,
          isActive: user.isActive,
        },
        statusConfig: {
          statusFilter: primaryStatusFilter,
          statusFilters,
          statusId: statusInfo?.id || null,
          statusName: statusInfo?.name || 'غير معروف',
          statusSlug: statusInfo?.slug || 'unknown',
        },
        ordersInSalla: {
          total: orders.length,
          available: unassignedOrders.length,
          alreadyAssigned: orders.length - unassignedOrders.length,
          filters: statusFilters,
        },
        assignments: {
          totalAssignments: assignedOrders.length,
          userActiveAssignments: userAssignments,
          canAssignMore: userAssignments === 0,
        },
        sampleOrders: unassignedOrders.slice(0, 5).map((order: any) => ({
          id: order.id,
          orderNumber: order.reference_id || order.id,
          status: order.status?.name || 'غير معروف',
          paymentMethod: order.payment_method,
          createdAt: order.date?.date || order.created_at,
        })),
        assignedOrdersList: assignedOrders.map(a => ({
          orderId: a.orderId,
          userId: a.userId,
          status: a.status,
          assignedAt: a.assignedAt,
        })),
      },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Error in debug endpoint', { error: errorMessage });

    return NextResponse.json(
      {
        error: 'حدث خطأ أثناء جلب معلومات التشخيص',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
