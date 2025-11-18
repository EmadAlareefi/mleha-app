import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/order-assignments/update-status
 * Update order assignment status and optionally update Salla
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentId, status, updateSalla, sallaStatus } = body;

    if (!assignmentId || !status) {
      return NextResponse.json(
        { error: 'معرف الطلب والحالة مطلوبان' },
        { status: 400 }
      );
    }

    const assignment = await prisma.orderAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'الطلب غير موجود' },
        { status: 404 }
      );
    }

    // Validate status transition: only allow preparing if order is in "in_progress" status (جاري التجهيز)
    // Status ID: 1956875584 or slug: in_progress
    if (status === 'prepared' || status === 'completed') {
      const validStatuses = ['in_progress', '1956875584'];
      if (!validStatuses.includes(assignment.sallaStatus || '')) {
        return NextResponse.json(
          { error: 'يمكن تجهيز الطلبات التي في حالة "جاري التجهيز" فقط' },
          { status: 400 }
        );
      }
    }

    // Prepare update data
    const updateData: any = {
      status,
    };

    if (status === 'preparing' && !assignment.startedAt) {
      updateData.startedAt = new Date();
    }

    if (status === 'prepared' || status === 'completed') {
      updateData.completedAt = new Date();
    }

    // Update Salla status if requested
    if (updateSalla && sallaStatus) {
      try {
        const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
        const accessToken = await getSallaAccessToken(assignment.merchantId);

        if (accessToken) {
          const baseUrl = 'https://api.salla.dev/admin/v2';
          const url = `${baseUrl}/orders/${assignment.orderId}/status`;

          // Determine if sallaStatus is a slug or status_id
          const isNumeric = /^\d+$/.test(sallaStatus);
          const requestBody = isNumeric
            ? { status_id: parseInt(sallaStatus) }
            : { slug: sallaStatus };

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (response.ok) {
            updateData.sallaStatus = sallaStatus;
            updateData.sallaUpdated = true;
            log.info('Salla order status updated', {
              orderId: assignment.orderId,
              status: sallaStatus,
            });
          } else {
            log.warn('Failed to update Salla order status', {
              orderId: assignment.orderId,
              status: response.status,
            });
          }
        }
      } catch (error) {
        log.error('Error updating Salla status', { error });
        // Continue with local update even if Salla update fails
      }
    }

    // Update assignment
    const updatedAssignment = await prisma.orderAssignment.update({
      where: { id: assignmentId },
      data: updateData,
    });

    log.info('Order assignment updated', {
      assignmentId,
      status,
      updateSalla,
    });

    return NextResponse.json({
      success: true,
      assignment: updatedAssignment,
    });

  } catch (error) {
    log.error('Error updating assignment status', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث حالة الطلب' },
      { status: 500 }
    );
  }
}
