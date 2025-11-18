import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/order-assignments/complete
 * Complete an order assignment and move it to history
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentId } = body;

    if (!assignmentId) {
      return NextResponse.json(
        { error: 'معرف الطلب مطلوب' },
        { status: 400 }
      );
    }

    const assignment = await prisma.orderAssignment.findUnique({
      where: { id: assignmentId },
      include: { user: true },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'الطلب غير موجود' },
        { status: 404 }
      );
    }

    // Calculate duration
    let durationMinutes = null;
    if (assignment.startedAt) {
      const now = new Date();
      const diff = now.getTime() - assignment.startedAt.getTime();
      durationMinutes = Math.floor(diff / 60000); // Convert to minutes
    } else if (assignment.assignedAt) {
      // If never started, calculate from assignment time
      const now = new Date();
      const diff = now.getTime() - assignment.assignedAt.getTime();
      durationMinutes = Math.floor(diff / 60000);
    }

    // Move to history
    await prisma.orderHistory.create({
      data: {
        userId: assignment.userId,
        userName: assignment.user.name,
        merchantId: assignment.merchantId,
        orderId: assignment.orderId,
        orderNumber: assignment.orderNumber,
        orderData: assignment.orderData,
        status: 'completed',
        assignedAt: assignment.assignedAt,
        startedAt: assignment.startedAt,
        finishedAt: new Date(),
        durationMinutes,
        finalSallaStatus: assignment.sallaStatus,
        notes: assignment.notes,
      },
    });

    // Delete from assignments
    await prisma.orderAssignment.delete({
      where: { id: assignmentId },
    });

    log.info('Order completed and moved to history', {
      assignmentId,
      orderId: assignment.orderId,
      userId: assignment.userId,
      durationMinutes,
    });

    return NextResponse.json({
      success: true,
      message: 'تم إكمال الطلب بنجاح',
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';

    log.error('Error completing order', {
      error: errorMessage,
      stack: errorStack,
      assignmentId: request.body,
    });

    return NextResponse.json(
      {
        error: 'حدث خطأ أثناء إكمال الطلب',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}
