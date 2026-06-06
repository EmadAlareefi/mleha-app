import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const DEFAULT_ASSIGNMENTS_LIMIT = 200;
const MAX_ASSIGNMENTS_LIMIT = 500;

function getPagination(searchParams: URLSearchParams) {
  const pageParam = Number.parseInt(searchParams.get('page') || '', 10);
  const limitParam = Number.parseInt(searchParams.get('limit') || '', 10);

  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const requestedLimit =
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_ASSIGNMENTS_LIMIT;
  const limit = Math.min(requestedLimit, MAX_ASSIGNMENTS_LIMIT);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

/**
 * GET /api/admin/order-assignments/list
 * List order assignments with filters for admin
 */
export async function GET(request: NextRequest) {
  const requestStartedAt = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const timeFilter = searchParams.get('timeFilter') || 'active'; // Default to active
    const statusFilter = searchParams.get('statusFilter') || 'all';
    const includeOrderData = searchParams.get('includeOrderData') === 'true';
    const { page, limit, skip } = getPagination(searchParams);

    // Build filter conditions
    const whereConditions: any = {};

    // Apply time filter
    let completedAtFilter: any;
    if (timeFilter === 'active') {
      // Show all active (non-completed) orders regardless of date
      completedAtFilter = null;
    } else {
      // For historical views (today/week/month), filter by completion date
      const now = new Date();
      let startDate: Date;

      switch (timeFilter) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      }

      completedAtFilter = {
        gte: startDate,
      };
    }

    // Apply status filter on top of time filter
    if (statusFilter === 'active') {
      completedAtFilter = null;
    } else if (statusFilter === 'completed') {
      completedAtFilter = {
        ...(completedAtFilter && typeof completedAtFilter === 'object' ? completedAtFilter : {}),
        not: null,
      };
    } else if (statusFilter === 'under_review') {
      whereConditions.sallaStatus = {
        in: ['1065456688', '1882207425', '2046404155'],
      }; // تحت المراجعة
    } else if (statusFilter === 'reservation') {
      whereConditions.sallaStatus = '1576217163'; // تحت المراجعة حجز قطع
    }

    if (completedAtFilter !== undefined) {
      whereConditions.completedAt = completedAtFilter;
    }

    // Fetch one extra row so callers can page without paying for a full count query.
    const queryStartedAt = Date.now();
    const assignmentsPage = await prisma.orderAssignment.findMany({
      where: whereConditions,
      select: {
        id: true,
        orderId: true,
        orderNumber: true,
        status: true,
        sallaStatus: true,
        userId: true,
        assignedAt: true,
        startedAt: true,
        completedAt: true,
        notes: true,
        ...(includeOrderData ? { orderData: true } : {}),
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        assignedAt: 'desc',
      },
      skip,
      take: limit + 1,
    });
    const queryDurationMs = Date.now() - queryStartedAt;

    const hasMore = assignmentsPage.length > limit;
    const assignments = hasMore ? assignmentsPage.slice(0, limit) : assignmentsPage;

    // Format response
    const formattedAssignments = assignments.map((assignment) => ({
      id: assignment.id,
      orderId: assignment.orderId,
      orderNumber: assignment.orderNumber,
      status: assignment.status,
      sallaStatus: assignment.sallaStatus,
      assignedUserId: assignment.userId,
      assignedUserName: (assignment.user as any)?.name || 'Unknown',
      assignedAt: assignment.assignedAt.toISOString(),
      startedAt: assignment.startedAt?.toISOString() || null,
      completedAt: assignment.completedAt?.toISOString() || null,
      orderData: includeOrderData ? (assignment as any).orderData : null,
      notes: assignment.notes,
    }));

    log.info('Admin order assignments list query completed', {
      durationMs: Date.now() - requestStartedAt,
      queryDurationMs,
      page,
      limit,
      count: formattedAssignments.length,
      hasMore,
      timeFilter,
      statusFilter,
      includeOrderData,
    });

    return NextResponse.json({
      success: true,
      assignments: formattedAssignments,
      count: formattedAssignments.length,
      pagination: {
        page,
        limit,
        count: formattedAssignments.length,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
      },
    });

  } catch (error) {
    log.error('Error listing order assignments', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الطلبات' },
      { status: 500 }
    );
  }
}
