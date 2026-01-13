import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/admin/order-assignments/reassign
 * Reassign orders to a different user
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentIds, newUserId } = body;

    if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
      return NextResponse.json(
        { error: 'معرفات الطلبات مطلوبة' },
        { status: 400 }
      );
    }

    if (!newUserId) {
      return NextResponse.json(
        { error: 'معرف المستخدم الجديد مطلوب' },
        { status: 400 }
      );
    }

    // Verify the new user exists and has order role
    const newUser = await prisma.orderUser.findUnique({
      where: { id: newUserId },
      select: {
        id: true,
        isActive: true,
        servicePermissions: {
          select: { serviceKey: true },
        },
      },
    });

    if (!newUser) {
      return NextResponse.json(
        { error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    if (!newUser.isActive) {
      return NextResponse.json(
        { error: 'المستخدم غير نشط ولا يمكن تعيين الطلبات له' },
        { status: 400 }
      );
    }

    const hasOrdersPermission = newUser.servicePermissions.some(
      (permission) => permission.serviceKey === 'order-prep'
    );

    if (!hasOrdersPermission) {
      return NextResponse.json(
        { error: 'المستخدم المحدد ليس لديه صلاحية طلبات' },
        { status: 400 }
      );
    }

    // Update assignments
    const result = await prisma.orderAssignment.updateMany({
      where: {
        id: { in: assignmentIds },
      },
      data: {
        userId: newUserId,
        assignedAt: new Date(), // Update assignment time
      },
    });

    log.info('Orders reassigned', {
      assignmentIds,
      newUserId,
      count: result.count,
    });

    return NextResponse.json({
      success: true,
      reassignedCount: result.count,
      message: `تم نقل ${result.count} طلب بنجاح`,
    });

  } catch (error) {
    log.error('Error reassigning orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء نقل الطلبات' },
      { status: 500 }
    );
  }
}
