import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { log } from '@/app/lib/logger';
import { updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { fetchSallaWithRetry } from '@/app/lib/fetch-with-retry';

export const runtime = 'nodejs';
const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

async function waitForSallaStatusUpdate(options: {
  merchantId: string;
  orderId: string;
  expectedStatusId?: string | null;
  expectedSlug?: string | null;
  attempts?: number;
  delayMs?: number;
}): Promise<boolean> {
  const {
    merchantId,
    orderId,
    expectedStatusId,
    expectedSlug,
    attempts = 5,
    delayMs = 1000,
  } = options;

  if (!expectedStatusId && !expectedSlug) {
    return true;
  }

  const accessToken = await getSallaAccessToken(merchantId);
  if (!accessToken) {
    return false;
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchSallaWithRetry(
        `${SALLA_API_BASE}/orders/${orderId}`,
        accessToken,
        { method: 'GET' }
      );

      if (response.ok) {
        const data = await response.json();
        const status = data?.data?.status;
        const slug = status?.sub_status?.slug || status?.slug;
        const statusId = status?.sub_status?.id || status?.id;
        const normalizedId = statusId ? statusId.toString() : null;

        if (
          (expectedStatusId && normalizedId === expectedStatusId) ||
          (expectedSlug && slug === expectedSlug)
        ) {
          return true;
        }
      }
    } catch (error) {
      log.warn('Failed to confirm Salla status update', {
        orderId,
        attempt,
        error: error instanceof Error ? error.message : error,
      });
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

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

    const normalizedTargetId =
      typeof targetStatusId === 'number'
        ? targetStatusId.toString()
        : typeof targetStatusId === 'string'
          ? targetStatusId
          : null;
    const normalizedTargetSlug = targetStatusSlug || null;

    const statusConfirmed = await waitForSallaStatusUpdate({
      merchantId,
      orderId,
      expectedStatusId: normalizedTargetId,
      expectedSlug: normalizedTargetSlug,
    });

    if (!statusConfirmed) {
      log.warn('Salla status did not confirm release within timeout', {
        assignmentId,
        merchantId,
        orderId,
        targetStatusId: normalizedTargetId,
        targetStatusSlug: normalizedTargetSlug,
      });
    }

    const now = new Date();
    await prisma.orderAssignment.update({
      where: { id: assignmentId },
      data: {
        status: 'released',
        removedAt: now,
        sallaStatus:
          targetStatusSlug ||
          (typeof targetStatusId === 'number'
            ? targetStatusId.toString()
            : (targetStatusId as string | null)) ||
          assignment.sallaStatus,
      },
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
      message: statusConfirmed
        ? 'تم نقل الطلب إلى الحالة المطلوبة وإعادته إلى قائمة الطلبات الجديدة'
        : 'تم إرسال الطلب للحالة المطلوبة، قد يستغرق الأمر لحظات قبل أن يظهر في قائمة الطلبات الجديدة',
    });
  } catch (error) {
    log.error('Failed to release assignment', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء نقل الطلب للحالة الجديدة' },
      { status: 500 }
    );
  }
}
