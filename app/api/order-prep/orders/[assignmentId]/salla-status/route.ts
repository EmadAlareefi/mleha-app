import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { createSallaOrderHistoryEntry, updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

const TARGET_STATUSES = {
  under_review_a: {
    id: 1065456688,
    label: 'تحت المراجعة',
  },
  under_review_reservation: {
    id: 1576217163,
    label: 'تحت المراجعة حجز قطعة',
  },
  under_review_inner: {
    id: 1882207425,
    label: 'تحت المراجعة ا',
  },
} as const;

type TargetKey = keyof typeof TARGET_STATUSES;

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
    const target = body?.target as TargetKey | undefined;
    const note =
      typeof body?.note === 'string'
        ? body.note.trim().slice(0, 500)
        : '';

    if (!target || !(target in TARGET_STATUSES)) {
      return NextResponse.json({ error: 'حالة سلة غير مدعومة' }, { status: 400 });
    }

    const assignment = await prisma.orderPrepAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment || assignment.userId !== user.id) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب أو لا تملك إذن تحديثه' },
        { status: 404 }
      );
    }

    const statusConfig = TARGET_STATUSES[target];

    const result = await updateSallaOrderStatus(MERCHANT_ID, assignment.orderId, {
      statusId: statusConfig.id,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'تعذر تحديث حالة الطلب في سلة' },
        { status: 502 }
      );
    }

    if (note) {
      const actorName =
        (typeof user.name === 'string' && user.name.trim()) ||
        (typeof user.email === 'string' && user.email.trim()) ||
        'عضو فريق التجهيز';
      const historyComment = `تم تحويل الطلب إلى "${statusConfig.label}" بواسطة ${actorName}.\nالملاحظة: ${note}`;
      const historyResult = await createSallaOrderHistoryEntry(
        MERCHANT_ID,
        assignment.orderId,
        historyComment,
      );
      if (!historyResult.success) {
        return NextResponse.json(
          { error: historyResult.error || 'تعذر حفظ الملاحظة في سجل الطلب في سلة' },
          { status: 502 },
        );
      }
    }

    await prisma.orderPrepAssignment.delete({
      where: { id: assignment.id },
    });

    await prisma.orderAssignment.deleteMany({
      where: { merchantId: assignment.merchantId, orderId: assignment.orderId },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    log.error('Failed to update Salla status from order prep', {
      assignmentId,
      userId: user.id,
      error,
    });
    return NextResponse.json(
      { error: 'تعذر تحديث حالة الطلب في سلة' },
      { status: 500 }
    );
  }
}
