import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { assignOldestOrderToUser, getActiveAssignmentsForUser, sortByPrepPriority } from '@/app/lib/order-prep-service';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { fetchSallaWithRetry } from '@/app/lib/fetch-with-retry';
import { extractSallaStatus, isOrderStatusEligible } from '@/app/lib/order-prep-status-guard';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!hasServiceAccess(session, ['order-prep'])) {
    return NextResponse.json({ error: 'ليست لديك صلاحية للوصول' }, { status: 403 });
  }

  const user = session.user as any;

  try {
    // These three are independent; run them together instead of back-to-back.
    // Assignments are keyed by the orderUser id (=== session user id), so a
    // non-prep account simply gets an empty list here and is rejected below.
    const [orderUser, activeAssignments, accessToken] = await Promise.all([
      prisma.orderUser.findUnique({
        where: { id: user.id },
        select: { id: true, name: true },
      }),
      getActiveAssignmentsForUser(user.id),
      getSallaAccessToken(MERCHANT_ID),
    ]);

    if (!orderUser) {
      return NextResponse.json(
        { error: 'هذا الحساب غير مضاف ضمن مستخدمي التحضير. يرجى إنشاء حساب تحضير خاص بك.' },
        { status: 403 }
      );
    }

    const assignments = await ensureOrdersStillEligible(activeAssignments, accessToken);

    if (assignments.length > 0) {
      return NextResponse.json({ success: true, assignments, autoAssigned: false });
    }

    const autoAssigned = await assignOldestOrderToUser(
      {
        id: orderUser.id,
        name: orderUser.name || user.name,
      },
      { accessToken },
    );

    return NextResponse.json({
      success: true,
      assignments: autoAssigned ? [autoAssigned] : [],
      autoAssigned: Boolean(autoAssigned),
    });
  } catch (error) {
    log.error('Failed to load order prep assignments', { userId: user.id, error });
    return NextResponse.json({ error: 'تعذر تحميل الطلبات' }, { status: 500 });
  }
}

async function ensureOrdersStillEligible(
  assignments: Awaited<ReturnType<typeof getActiveAssignmentsForUser>>,
  accessToken: string | null,
) {
  if (assignments.length === 0) {
    return assignments;
  }

  if (!accessToken) {
    log.warn('Unable to validate Salla status - missing token');
    return assignments;
  }

  // The page shows one order, so check them in the order it picks and stop at
  // the first that is still eligible. Checking every held order with Salla one
  // by one took ~30s for a preparer holding 40.
  const ordered = sortByPrepPriority(assignments);
  for (let index = 0; index < ordered.length; index += 1) {
    const assignment = ordered[index];
    try {
      const stillAllowed = await isOrderStillEligible(assignment.orderId, accessToken);
      if (stillAllowed) {
        return ordered.slice(index);
      }

      await prisma.orderPrepAssignment.delete({
        where: { id: assignment.id },
      });

      log.info('Removed order prep assignment due to status change', {
        assignmentId: assignment.id,
        orderId: assignment.orderId,
      });
    } catch (error) {
      log.warn('Failed to validate Salla status for assignment', {
        assignmentId: assignment.id,
        orderId: assignment.orderId,
        error: error instanceof Error ? error.message : error,
      });
      // Can't tell: keep it, as before, rather than drop the preparer's order.
      return ordered.slice(index);
    }
  }

  return [];
}

async function isOrderStillEligible(orderId: string, accessToken: string) {
  const response = await fetchSallaWithRetry(
    `${SALLA_API_BASE}/orders/${encodeURIComponent(orderId)}`,
    accessToken,
    { timeoutMs: 12000 },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch order ${orderId} from Salla (status ${response.status})`);
  }

  const data = await response.json();
  const { status, subStatus } = extractSallaStatus(data?.data);
  return isOrderStatusEligible(status, subStatus);
}
