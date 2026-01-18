import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { Prisma } from '@prisma/client';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';

export const runtime = 'nodejs';
const READY_FOR_PICKUP_SLUG = 'ready_for_pickup';
const SALLA_API_BASE_URL = 'https://api.salla.dev/admin/v2';

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

    // Attempt to update the order status in Salla so it never returns to the prep queue
    let finalSallaStatus = assignment.sallaStatus || null;
    let sallaStatusUpdated = false;
    try {
      const accessToken = await getSallaAccessToken(assignment.merchantId);

      if (accessToken) {
        const response = await fetch(`${SALLA_API_BASE_URL}/orders/${assignment.orderId}/status`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ slug: READY_FOR_PICKUP_SLUG }),
        });

        if (response.ok) {
          finalSallaStatus = READY_FOR_PICKUP_SLUG;
          sallaStatusUpdated = true;
          log.info('Salla order marked as ready_for_pickup on completion', {
            assignmentId,
            orderId: assignment.orderId,
          });
        } else {
          const errorText = await response.text();
          log.warn('Failed to update Salla status during completion', {
            assignmentId,
            orderId: assignment.orderId,
            status: response.status,
            error: errorText,
          });
        }
      } else {
        log.warn('Missing Salla access token when completing order', {
          assignmentId,
          orderId: assignment.orderId,
        });
      }
    } catch (sallaError) {
      log.error('Error updating Salla status on completion', {
        assignmentId,
        orderId: assignment.orderId,
        error: sallaError instanceof Error ? sallaError.message : sallaError,
      });
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

    // Move to history (for reporting)
    await prisma.orderHistory.create({
      data: {
        userId: assignment.userId,
        userName: assignment.user.name,
        merchantId: assignment.merchantId,
        orderId: assignment.orderId,
        orderNumber: assignment.orderNumber,
        orderData: assignment.orderData ?? Prisma.JsonNull,
        status: 'completed',
        assignedAt: assignment.assignedAt,
        startedAt: assignment.startedAt,
        finishedAt: new Date(),
        durationMinutes,
        finalSallaStatus,
        notes: assignment.notes,
      },
    });

    // Update assignment status to 'completed' instead of deleting (keep for reports)
    await prisma.orderAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        sallaStatus: finalSallaStatus,
        sallaUpdated: assignment.sallaUpdated || sallaStatusUpdated,
      },
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
