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
const sanitizeIdentifiers = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => {
          if (value === null || value === undefined) return '';
          if (typeof value === 'string') return value.trim();
          return String(value).trim();
        })
        .filter((value) => value.length > 0),
    ),
  );

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const assignmentIdsInput = Array.isArray(body?.assignmentIds) ? body.assignmentIds : [];
    const orderIdsInput = Array.isArray(body?.orderIds) ? body.orderIds : [];
    const assignmentIds = sanitizeIdentifiers(assignmentIdsInput);
    const orderIds = sanitizeIdentifiers(orderIdsInput);

    if (assignmentIds.length === 0 && orderIds.length === 0) {
      return NextResponse.json(
        { error: 'معرفات الطلبات أو أرقام الطلبات مطلوبة' },
        { status: 400 },
      );
    }

    const assignmentFilters = [];
    if (assignmentIds.length > 0) {
      assignmentFilters.push({ id: { in: assignmentIds } });
    }
    if (orderIds.length > 0) {
      assignmentFilters.push({ orderId: { in: orderIds } });
    }

    const assignmentWhere =
      assignmentFilters.length > 1
        ? { OR: assignmentFilters }
        : assignmentFilters[0] || undefined;

    const assignments = assignmentWhere
      ? await prisma.orderAssignment.findMany({
          where: assignmentWhere,
          select: {
            id: true,
            orderId: true,
            orderNumber: true,
            status: true,
            userId: true,
            merchantId: true,
          },
        })
      : [];

    const targetOrderIds = new Set<string>();
    orderIds.forEach((orderId) => targetOrderIds.add(orderId));
    assignments.forEach((assignment) => {
      if (assignment.orderId) {
        targetOrderIds.add(assignment.orderId);
      }
    });

    const removableAssignments = assignments.filter((assignment) => {
      if (!assignment.status) return true;
      const normalizedStatus = assignment.status.toLowerCase();
      return !NON_REMOVABLE_STATUS_SET.has(normalizedStatus);
    });

    const removableIds = removableAssignments.map((assignment) => assignment.id);
    const blockedOrderIds = new Set(
      assignments
        .filter((assignment) => assignment.orderId && !removableIds.includes(assignment.id))
        .map((assignment) => assignment.orderId as string),
    );

    const orderIdsForPrepRemoval = Array.from(targetOrderIds).filter(
      (orderId) => !blockedOrderIds.has(orderId),
    );

    if (assignments.length === 0 && orderIdsForPrepRemoval.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلبات المحددة' },
        { status: 404 },
      );
    }

    const prepAssignments = targetOrderIds.size
      ? await prisma.orderPrepAssignment.findMany({
          where: {
            merchantId: MERCHANT_ID,
            orderId: { in: orderIdsForPrepRemoval },
          },
          select: {
            id: true,
            orderId: true,
            orderNumber: true,
          },
        })
      : [];

    if (assignments.length === 0 && prepAssignments.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلبات المحددة' },
        { status: 404 },
      );
    }

    let removedOrderAssignments = 0;
    let removedPrepAssignments = 0;

    if (removableAssignments.length === 0 && prepAssignments.length === 0) {
      const skipped = assignments.map((assignment) => assignment.orderNumber || assignment.orderId);
      return NextResponse.json(
        {
          error: 'لا يمكن إزالة هذه الطلبات لأنها ليست قيد العمل',
          skippedOrders: skipped.length > 0 ? skipped : undefined,
        },
        { status: 400 },
      );
    }

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

    const prepAssignmentIds = prepAssignments.map((assignment) => assignment.id);
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
      .map((assignment) => assignment.orderNumber || assignment.orderId);

    const removedAssignmentOrderIds = new Set(
      removableAssignments
        .map((assignment) => assignment.orderId)
        .filter((orderId): orderId is string => Boolean(orderId)),
    );
    const removedPrepOrderIds = new Set(prepAssignments.map((assignment) => assignment.orderId));
    orderIds.forEach((orderId) => {
      if (!removedAssignmentOrderIds.has(orderId) && !removedPrepOrderIds.has(orderId)) {
        skippedOrders.push(orderId);
      }
    });

    log.info('Removed admin order assignments', {
      assignmentIds: removableIds,
      count: removedOrderAssignments,
      prepAssignmentsRemoved: removedPrepAssignments,
      ordersRequested: orderIds,
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
