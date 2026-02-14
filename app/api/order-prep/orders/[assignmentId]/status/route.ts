import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { updateAssignmentStatus } from '@/app/lib/order-prep-service';
import { log } from '@/app/lib/logger';

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

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: 'حالة غير مدعومة' },
        { status: 400 }
      );
    }

    const result = await updateAssignmentStatus({
      assignmentId,
      userId: user.id,
      targetStatus: status,
      skipSallaSync,
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
