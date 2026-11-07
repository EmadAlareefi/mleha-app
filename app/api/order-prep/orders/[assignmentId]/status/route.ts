import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { updateAssignmentStatus } from '@/app/lib/order-prep-service';
import { log } from '@/app/lib/logger';
import { prisma } from '@/lib/prisma';
import { promoLimitBlock } from '@/app/lib/promo-limit';

export const runtime = 'nodejs';

const ALLOWED_STATUSES = ['preparing', 'waiting', 'completed'] as const;

type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  if (!hasServiceAccess(session, ['order-prep'])) {
    return NextResponse.json({ error: 'ليست لديك صلاحية للوصول' }, { status: 403 });
  }

  const user = session.user as any;
  const { assignmentId } = await context.params;

  try {
    const body = await request.json().catch(() => ({}));
    const status = body?.status as AllowedStatus | undefined;
    const skipSallaSync = Boolean(body?.skipSallaSync);
    const itemStatuses = Array.isArray(body?.itemStatuses) ? body.itemStatuses : undefined;

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: 'حالة غير مدعومة' },
        { status: 400 }
      );
    }

    // Load once: the promo guard and the status update both need it.
    const assignment = await prisma.orderPrepAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.userId !== user.id) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب أو لا تملك إذن تحديثه' },
        { status: 404 }
      );
    }

    if (status === 'completed') {
      const blocked = await guardPromoLimit(assignment, user);
      if (blocked) return blocked;
    }

    const result = await updateAssignmentStatus({
      assignmentId,
      userId: user.id,
      targetStatus: status,
      skipSallaSync,
      itemStatuses,
      preloaded: assignment,
    });

    if (!result) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب أو لا تملك إذن تحديثه' },
        { status: 404 }
      );
    }

    if (result.blocked) {
      return NextResponse.json(
        { error: result.sallaError || 'تعذر تحديث حالة الطلب في سلة' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      assignment: result.assignment,
      sallaStatusSynced: result.sallaStatusSynced,
      sallaError: result.sallaError ?? null,
      isInternational: Boolean(result.isInternational),
    });
  } catch (error) {
    log.error('Failed to update order prep status', {
      userId: user.id,
      assignmentId,
      error,
    });
    return NextResponse.json({ error: 'تعذر تحديث حالة الطلب' }, { status: 500 });
  }
}

/**
 * Refuses to complete an order that breaks the 1 SAR promo limit. No override:
 * the order has to be corrected in Salla first.
 */
async function guardPromoLimit(
  assignment: { merchantId: string; orderId: string; orderNumber: string | null; orderData: unknown },
  user: { id?: string },
) {
  const block = await promoLimitBlock({
    merchantId: assignment.merchantId,
    orderId: assignment.orderId,
    orderNumber: assignment.orderNumber,
    orderData: assignment.orderData,
    context: 'order-prep.complete',
    userId: user.id ?? null,
  });
  return block ? NextResponse.json(block, { status: 409 }) : null;
}
