import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
export const runtime = 'nodejs';

const NON_REMOVABLE_STATUS_SET = new Set(['completed', 'removed', 'released']);
const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * POST /api/admin/order-assignments/remove
 * Remove existing order assignments so they can be reassigned later.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentIds } = body || {};

    if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
      return NextResponse.json(
        { error: 'معرفات الطلبات مطلوبة' },
        { status: 400 },
      );
    }

    const assignments = await prisma.orderAssignment.findMany({
      where: { id: { in: assignmentIds } },
      select: {
        id: true,
        orderId: true,
        orderNumber: true,
        status: true,
        userId: true,
        merchantId: true,
      },
    });

    if (assignments.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلبات المحددة' },
        { status: 404 },
      );
    }

    const removableAssignments = assignments.filter((assignment) => {
      if (!assignment.status) return true;
      const normalizedStatus = assignment.status.toLowerCase();
      return !NON_REMOVABLE_STATUS_SET.has(normalizedStatus);
    });

    const targetOrderIds = assignments.map((assignment) => assignment.orderId);
    const prepAssignments = targetOrderIds.length
      ? await prisma.orderPrepAssignment.findMany({
          where: {
            merchantId: MERCHANT_ID,
            orderId: { in: targetOrderIds },
          },
          select: {
            id: true,
            orderId: true,
            orderNumber: true,
          },
        })
      : [];
    const prepAssignmentIds = prepAssignments.map((assignment) => assignment.id);

    if (removableAssignments.length === 0 && prepAssignmentIds.length === 0) {
      return NextResponse.json(
        {
          error: 'لا يمكن إزالة هذه الطلبات لأنها ليست قيد العمل',
          skippedOrders: assignments.map((assignment) => assignment.orderNumber),
        },
        { status: 400 },
      );
    }

    const removableIds = removableAssignments.map((assignment) => assignment.id);

    let removedOrderAssignments = 0;
    let removedPrepAssignments = 0;

    if (removableIds.length > 0) {
      const removeResult = await prisma.orderAssignment.deleteMany({
        where: {
          id: {
            in: removableIds,
          },
        },
      });
      removedOrderAssignments = removeResult.count;
    }

    if (prepAssignmentIds.length > 0) {
      const prepRemoveResult = await prisma.orderPrepAssignment.deleteMany({
        where: {
          id: {
            in: prepAssignmentIds,
          },
        },
      });
      removedPrepAssignments = prepRemoveResult.count;
    }

    const removableIdSet = new Set(removableIds);
    const skippedOrders = assignments
      .filter((assignment) => !removableIdSet.has(assignment.id))
      .map((assignment) => assignment.orderNumber);

    log.info('Removed admin order assignments', {
      assignmentIds: removableIds,
      count: removedOrderAssignments,
      prepAssignmentsRemoved: removedPrepAssignments,
      skippedOrders,
    });

    return NextResponse.json({
      success: true,
      removedCount: removedOrderAssignments,
      removedPrepCount: removedPrepAssignments || undefined,
      skippedCount: skippedOrders.length || undefined,
      skippedOrders: skippedOrders.length > 0 ? skippedOrders : undefined,
      message: `تم إزالة ${removedOrderAssignments + removedPrepAssignments} طلب${skippedOrders.length ? ' (تخطى ' + skippedOrders.length + ')' : ''}`,
    });
  } catch (error) {
    log.error('Error removing admin order assignments', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إزالة الطلبات' },
      { status: 500 },
    );
  }
}
