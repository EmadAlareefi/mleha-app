import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { assignOldestOrderToUser, getActiveAssignmentsForUser } from '@/app/lib/order-prep-service';
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

  const orderUser = await prisma.orderUser.findUnique({
    where: { id: user.id },
    select: { id: true, name: true },
  });

  if (!orderUser) {
    return NextResponse.json(
      { error: 'هذا الحساب غير مضاف ضمن مستخدمي التحضير. يرجى إنشاء حساب تحضير خاص بك.' },
      { status: 403 }
    );
  }
  try {
    let assignments = await getActiveAssignmentsForUser(orderUser.id);
    assignments = await ensureOrdersStillEligible(assignments);

    if (assignments.length > 0) {
      return NextResponse.json({ success: true, assignments, autoAssigned: false });
    }

    const autoAssigned = await assignOldestOrderToUser({
      id: orderUser.id,
      name: orderUser.name || user.name,
    });

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

async function ensureOrdersStillEligible(assignments: Awaited<ReturnType<typeof getActiveAssignmentsForUser>>) {
  if (assignments.length === 0) {
    return assignments;
  }

  const accessToken = await getSallaAccessToken(MERCHANT_ID);
  if (!accessToken) {
    log.warn('Unable to validate Salla status - missing token');
    return assignments;
  }

  const validAssignments = [];
  for (const assignment of assignments) {
    try {
      const stillAllowed = await isOrderStillEligible(assignment.orderId, accessToken);
      if (stillAllowed) {
        validAssignments.push(assignment);
        continue;
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
      validAssignments.push(assignment);
    }
  }

  return validAssignments;
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
