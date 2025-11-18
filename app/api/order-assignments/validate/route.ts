import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const NEW_ORDER_STATUS_ID = '449146439'; // طلب جديد

/**
 * POST /api/order-assignments/validate
 * Validate assigned orders - remove orders that are no longer in "طلب جديد" status
 * and move them to history
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    // Get user and their assigned orders
    const user = await prisma.orderUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    const assignments = await prisma.orderAssignment.findMany({
      where: {
        userId: user.id,
        status: {
          in: ['assigned', 'preparing'],
        },
      },
    });

    if (assignments.length === 0) {
      return NextResponse.json({
        success: true,
        validated: 0,
        removed: 0,
        message: 'لا توجد طلبات للتحقق منها',
      });
    }

    // Get Salla access token
    const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
    const accessToken = await getSallaAccessToken(MERCHANT_ID);

    if (!accessToken) {
      log.error('No valid Salla access token');
      return NextResponse.json(
        { error: 'فشل الاتصال بسلة' },
        { status: 500 }
      );
    }

    const baseUrl = 'https://api.salla.dev/admin/v2';
    const removedOrders: string[] = [];

    // Check each order's current status in Salla
    for (const assignment of assignments) {
      try {
        const orderUrl = `${baseUrl}/orders/${assignment.orderId}`;
        const response = await fetch(orderUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          const order = data.data;
          const currentStatusId = order.status?.id?.toString();

          // If order is no longer in "طلب جديد" status, remove it and archive to history
          if (currentStatusId !== NEW_ORDER_STATUS_ID) {
            log.info('Order status changed - removing from assignment', {
              orderId: assignment.orderId,
              orderNumber: assignment.orderNumber,
              currentStatus: order.status?.name,
            });

            // Calculate duration
            let durationMinutes = null;
            if (assignment.startedAt) {
              const now = new Date();
              const diff = now.getTime() - assignment.startedAt.getTime();
              durationMinutes = Math.floor(diff / 60000); // Convert to minutes
            }

            // Move to history
            await prisma.orderHistory.create({
              data: {
                userId: user.id,
                userName: user.name,
                merchantId: assignment.merchantId,
                orderId: assignment.orderId,
                orderNumber: assignment.orderNumber,
                orderData: assignment.orderData,
                status: 'removed',
                assignedAt: assignment.assignedAt,
                startedAt: assignment.startedAt,
                finishedAt: new Date(),
                durationMinutes,
                finalSallaStatus: order.status?.slug || currentStatusId,
                notes: `تم إزالة الطلب - تغيرت الحالة في سلة إلى: ${order.status?.name}`,
              },
            });

            // Remove from assignments
            await prisma.orderAssignment.delete({
              where: { id: assignment.id },
            });

            removedOrders.push(assignment.orderNumber);
          }
        } else {
          log.warn('Failed to fetch order from Salla', {
            orderId: assignment.orderId,
            status: response.status,
          });
        }
      } catch (error) {
        log.error('Error validating order', {
          orderId: assignment.orderId,
          error,
        });
      }
    }

    log.info('Order validation completed', {
      userId: user.id,
      totalChecked: assignments.length,
      removed: removedOrders.length,
    });

    return NextResponse.json({
      success: true,
      validated: assignments.length,
      removed: removedOrders.length,
      removedOrders,
      message: removedOrders.length > 0
        ? `تم إزالة ${removedOrders.length} طلب`
        : 'جميع الطلبات صالحة',
    });

  } catch (error) {
    log.error('Error validating orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء التحقق من الطلبات' },
      { status: 500 }
    );
  }
}
