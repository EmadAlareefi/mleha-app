import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';
import { updateSallaOrderStatus } from '@/app/lib/salla-order-status';

export const runtime = 'nodejs';

/**
 * POST /api/order-assignments/release
 * Moves an assigned order back to an under-review status in Salla
 * and removes the assignment so it can be treated as a brand new order later.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    if (!hasServiceAccess(session, ['order-prep'])) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const body = await request.json();
    const assignmentId = body?.assignmentId as string | undefined;
    const targetStatusId = body?.targetStatusId as number | string | undefined;
    const targetStatusSlug = body?.targetStatusSlug as string | undefined;

    if (!assignmentId) {
      return NextResponse.json({ error: 'معرف الطلب مطلوب' }, { status: 400 });
    }

    if (!targetStatusId && !targetStatusSlug) {
      return NextResponse.json({ error: 'يجب تحديد الحالة الهدف' }, { status: 400 });
    }

    const assignment = await prisma.orderAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    }

    const sessionUser = session.user as any;
    const isAdmin = Array.isArray(sessionUser?.roles)
      ? sessionUser.roles.includes('admin')
      : sessionUser?.role === 'admin';

    if (!isAdmin && assignment.userId !== sessionUser.id) {
      return NextResponse.json({ error: 'لا تملك صلاحية لإدارة هذا الطلب' }, { status: 403 });
    }

    const merchantId = assignment.merchantId;
    const orderId = assignment.orderId;

    const updateResult = await updateSallaOrderStatus(merchantId, orderId, {
      statusId: targetStatusId,
      slug: targetStatusSlug,
    });

    if (!updateResult.success) {
      log.warn('Failed to update Salla status while releasing assignment', {
        assignmentId,
        orderId,
        merchantId,
        error: updateResult.error,
      });
      return NextResponse.json(
        { error: 'فشل تحديث حالة الطلب في سلة', details: updateResult.error },
        { status: 502 }
      );
    }

    await prisma.orderAssignment.delete({
      where: { id: assignmentId },
    });

    log.info('Released assignment back to under review', {
      assignmentId,
      orderId,
      merchantId,
      userId: assignment.userId,
      targetStatusId,
      targetStatusSlug,
    });

    return NextResponse.json({
      success: true,
      message: 'تم نقل الطلب إلى الحالة المطلوبة وإعادته إلى قائمة الطلبات الجديدة',
    });
  } catch (error) {
    log.error('Failed to release assignment', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء نقل الطلب للحالة الجديدة' },
      { status: 500 }
    );
  }
}
