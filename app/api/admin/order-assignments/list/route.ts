import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/admin/order-assignments/list
 * List order assignments with filters for admin
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeFilter = searchParams.get('timeFilter') || 'active'; // Default to active
    const statusFilter = searchParams.get('statusFilter') || 'all';

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

    // Fetch assignments
    const assignments = await prisma.orderAssignment.findMany({
      where: whereConditions,
      include: {
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
    });

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
      orderData: assignment.orderData,
      notes: assignment.notes,
    }));

    return NextResponse.json({
      success: true,
      assignments: formattedAssignments,
      count: formattedAssignments.length,
    });

  } catch (error) {
    log.error('Error listing order assignments', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الطلبات' },
      { status: 500 }
    );
  }
}
