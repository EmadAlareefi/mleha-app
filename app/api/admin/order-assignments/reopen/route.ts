import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';

export const runtime = 'nodejs';

/**
 * POST /api/admin/order-assignments/reopen
 * Reopen orders by changing their status back to "New Order"
 * This is used for orders in "Under Review" or "Parts Reservation" status
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentIds } = body;

    if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
      return NextResponse.json(
        { error: 'معرفات الطلبات مطلوبة' },
        { status: 400 }
      );
    }

    // Fetch assignments to reopen
    const assignments = await prisma.orderAssignment.findMany({
      where: {
        id: { in: assignmentIds },
      },
      select: {
        id: true,
        orderId: true,
        orderNumber: true,
        merchantId: true,
        sallaStatus: true,
        status: true,
      },
    });

    if (assignments.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلبات' },
        { status: 404 }
      );
    }

    let successCount = 0;
    const errors: string[] = [];

    for (const assignment of assignments) {
      try {
        // Update Salla status to "New Order" (طلب جديد) - ID: 449146439
        const accessToken = await getSallaAccessToken(assignment.merchantId);

        if (accessToken) {
          const baseUrl = 'https://api.salla.dev/admin/v2';
          const url = `${baseUrl}/orders/${assignment.orderId}/status`;

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status_id: 449146439, // طلب جديد (New Order)
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            log.warn('Failed to update Salla status for order', {
              orderId: assignment.orderId,
              status: response.status,
              error: errorText,
            });
            errors.push(`${assignment.orderNumber}: فشل تحديث حالة سلة`);
            continue;
          }
        }

        // Delete the assignment to make it available again
        await prisma.orderAssignment.delete({
          where: { id: assignment.id },
        });

        successCount++;

        log.info('Order reopened', {
          assignmentId: assignment.id,
          orderId: assignment.orderId,
          orderNumber: assignment.orderNumber,
        });

      } catch (error) {
        log.error('Error reopening order', {
          assignmentId: assignment.id,
          orderId: assignment.orderId,
          error,
        });
        errors.push(`${assignment.orderNumber}: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
      }
    }

    return NextResponse.json({
      success: successCount > 0,
      reopenedCount: successCount,
      totalRequested: assignmentIds.length,
      errors: errors.length > 0 ? errors : undefined,
      message: successCount > 0
        ? `تم إعادة فتح ${successCount} من ${assignmentIds.length} طلب`
        : 'فشل إعادة فتح الطلبات',
    });

  } catch (error) {
    log.error('Error reopening orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إعادة فتح الطلبات' },
      { status: 500 }
    );
  }
}
