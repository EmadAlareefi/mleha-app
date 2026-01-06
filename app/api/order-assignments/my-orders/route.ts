import { NextRequest, NextResponse} from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import type { HighPriorityOrder, OrderGiftFlag } from '@prisma/client';

export const runtime = 'nodejs';
const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * GET /api/order-assignments/my-orders
 * Get orders assigned to a specific user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // optional filter

    if (!userId) {
      return NextResponse.json(
        { error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    const where: any = {
      userId,
    };

    if (status) {
      where.status = status;
    } else {
      // Default: show active assignments including shipped orders
      where.status = {
        in: ['assigned', 'preparing', 'shipped'],
      };
    }

    const assignments = await prisma.orderAssignment.findMany({
      where,
      orderBy: {
        assignedAt: 'asc', // Oldest first (FIFO)
      },
    });

    const orderIds = assignments.map((assignment) => assignment.orderId);
    let priorityMap = new Map<string, HighPriorityOrder>();
    let giftFlagMap = new Map<string, OrderGiftFlag>();

    if (orderIds.length > 0) {
      const priorityOrders = await prisma.highPriorityOrder.findMany({
        where: {
          merchantId: MERCHANT_ID,
          orderId: { in: orderIds },
        },
      });
      priorityMap = new Map(priorityOrders.map((order) => [order.orderId, order]));
    }

    if (orderIds.length > 0) {
      const giftFlags = await prisma.orderGiftFlag.findMany({
        where: {
          merchantId: MERCHANT_ID,
          orderId: { in: orderIds },
        },
      });
      giftFlagMap = new Map(giftFlags.map((flag) => [flag.orderId, flag]));
    }

    const enrichedAssignments = assignments
      .map((assignment) => {
        const priority = priorityMap.get(assignment.orderId);
        const giftFlag = giftFlagMap.get(assignment.orderId);
        return {
          ...assignment,
          isHighPriority: Boolean(priority),
          highPriorityReason: priority?.reason || null,
          highPriorityNotes: priority?.notes || null,
          highPriorityMarkedAt: priority?.createdAt || null,
          highPriorityMarkedBy: priority?.createdByName || priority?.createdByUsername || null,
          hasGiftFlag: Boolean(giftFlag),
          giftFlagReason: giftFlag?.reason || null,
          giftFlagNotes: giftFlag?.notes || null,
          giftFlagMarkedAt: giftFlag?.createdAt || null,
          giftFlagMarkedBy: giftFlag?.createdByName || giftFlag?.createdByUsername || null,
        };
      })
      .sort((a, b) => {
        if (a.isHighPriority && !b.isHighPriority) return -1;
        if (!a.isHighPriority && b.isHighPriority) return 1;
        return new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();
      });

    return NextResponse.json({
      success: true,
      assignments: enrichedAssignments,
    });

  } catch (error) {
    log.error('Error fetching user orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الطلبات' },
      { status: 500 }
    );
  }
}
