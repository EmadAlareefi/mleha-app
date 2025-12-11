import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * POST /api/order-assignments/reset
 * Remove/reset all assigned orders for a user
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

    // Get user
    const user = await prisma.orderUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    // Get all active assignments for this user (exclude completed/removed as they're for reporting)
    const assignments = await prisma.orderAssignment.findMany({
      where: {
        userId: user.id,
        status: {
          in: ['assigned', 'preparing', 'prepared', 'shipped'],
        },
      },
    });

    // Get Salla access token
    const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
    const accessToken = await getSallaAccessToken(MERCHANT_ID);

    if (accessToken) {
      // Revert Salla orders back to "under_review" status
      const baseUrl = 'https://api.salla.dev/admin/v2';

      for (const assignment of assignments) {
        try {
          const updateUrl = `${baseUrl}/orders/${assignment.orderId}/status`;
          await fetch(updateUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              status: 'under_review', // Revert to تحت المراجعة
            }),
          });
          log.info('Order status reverted to under_review on reset', {
            orderId: assignment.orderId,
            userId: user.id,
          });
        } catch (error) {
          log.warn('Failed to revert Salla status on reset', {
            orderId: assignment.orderId,
            error
          });
        }
      }
    }

    // Delete all active assignments for this user (keep completed/removed for reporting)
    const deleteResult = await prisma.orderAssignment.deleteMany({
      where: {
        userId: user.id,
        status: {
          in: ['assigned', 'preparing', 'prepared', 'shipped'],
        },
      },
    });

    log.info('User orders reset successfully', {
      userId: user.id,
      deletedCount: deleteResult.count,
    });

    return NextResponse.json({
      success: true,
      deletedCount: deleteResult.count,
      message: `تم حذف ${deleteResult.count} طلب بنجاح`,
    });

  } catch (error) {
    log.error('Error resetting user orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إعادة تعيين الطلبات' },
      { status: 500 }
    );
  }
}
