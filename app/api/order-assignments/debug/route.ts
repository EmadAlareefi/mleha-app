import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { getSallaOrderStatuses, getStatusBySlug } from '@/app/lib/salla-statuses';
import { log } from '@/app/lib/logger';
import { ACTIVE_ASSIGNMENT_STATUSES } from '@/lib/order-assignment-statuses';

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

    // Determine which status to look for
    let statusFilter: string;
    let statusInfo: any;

    if (user.orderType === 'specific_status' && user.specificStatus) {
      statusFilter = user.specificStatus;
      statusInfo = statuses.find(s => s.id.toString() === statusFilter);
    } else {
      const underReviewStatus = getStatusBySlug(statuses, 'under_review');
      statusFilter = underReviewStatus?.id.toString() || '566146469';
      statusInfo = underReviewStatus;
    }

    // Fetch orders from Salla with this status
    const baseUrl = 'https://api.salla.dev/admin/v2';
    const url = `${baseUrl}/orders?status=${statusFilter}&per_page=50&sort_by=created_at-asc`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({
        error: 'فشل جلب الطلبات من سلة',
        details: errorText,
      }, { status: 500 });
    }

    const data = await response.json();
    const orders = data.data || [];

    // Filter by payment method if needed
    let filteredOrders = orders;
    if (user.orderType === 'cod') {
      filteredOrders = orders.filter((order: any) =>
        order.payment_method === 'cash_on_delivery' || order.payment_method === 'cod'
      );
    } else if (user.orderType === 'prepaid') {
      filteredOrders = orders.filter((order: any) =>
        order.payment_method !== 'cash_on_delivery' && order.payment_method !== 'cod'
      );
    }

    // Get currently active assigned order IDs (exclude completed/removed for reporting)
    const assignedOrders = await prisma.orderAssignment.findMany({
      where: {
        merchantId: MERCHANT_ID,
        status: {
          in: ACTIVE_ASSIGNMENT_STATUSES,
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
    const unassignedOrders = filteredOrders.filter(
      (order: any) => !assignedOrderIdSet.has(String(order.id))
    );

    // Current user's active assignments (including shipped)
    const userAssignments = await prisma.orderAssignment.count({
      where: {
        userId: user.id,
        status: {
          in: ACTIVE_ASSIGNMENT_STATUSES,
        },
      },
    });

    return NextResponse.json({
      success: true,
      debug: {
        user: {
          id: user.id,
          name: user.name,
          orderType: user.orderType,
          specificStatus: user.specificStatus,
          autoAssign: user.autoAssign,
          isActive: user.isActive,
        },
        statusConfig: {
          statusFilter: statusFilter,
          statusId: statusInfo?.id || null,
          statusName: statusInfo?.name || 'غير معروف',
          statusSlug: statusInfo?.slug || 'unknown',
        },
        ordersInSalla: {
          total: orders.length,
          afterPaymentFilter: filteredOrders.length,
          available: unassignedOrders.length,
          alreadyAssigned: filteredOrders.length - unassignedOrders.length,
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
