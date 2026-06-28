import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  archivePurchaseRequest,
  deletePurchaseRequest,
  incrementPurchaseRequestQuantity,
  movePurchaseRequestOnTheWay,
} from '@/app/lib/salla-purchase-requests';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type RouteContext = {
  params: { id: string } | Promise<{ id: string }>;
};

function actorName(session: any): string {
  return (session.user as any)?.name || session.user?.email || 'مستخدم';
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول لتحديث الطلب' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'رقم الطلب غير معروف' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new Error('تنسيق البيانات غير صالح');
    }

    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'increment') {
      const by = Number.parseInt(body.by, 10);
      if (!Number.isFinite(by) || by <= 0) {
        throw new Error('قيمة الزيادة يجب أن تكون أكبر من صفر');
      }
      const updated = await incrementPurchaseRequestQuantity(id, by);
      return NextResponse.json({ success: true, request: updated });
    }

    if (action === 'move_on_the_way') {
      if (!hasServiceAccess(session, ['salla-purchase-requests-manage'])) {
        return NextResponse.json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء' }, { status: 403 });
      }
      const updated = await movePurchaseRequestOnTheWay(id, actorName(session));
      return NextResponse.json({ success: true, request: updated });
    }

    throw new Error('إجراء غير معروف');
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'تعذر تحديث الطلب' },
      { status: 400 }
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول لإزالة الطلب' }, { status: 401 });
  }

  if (!hasServiceAccess(session, ['salla-purchase-requests-manage'])) {
    return NextResponse.json({ error: 'لا تملك صلاحية تنفيذ هذا الإجراء' }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'رقم الطلب غير معروف' }, { status: 400 });
  }

  try {
    const existing = await prisma.sallaPurchaseRequest.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'لم يتم العثور على طلب الشراء' }, { status: 404 });
    }

    if (existing.status === 'requested') {
      const deleted = await deletePurchaseRequest(id);
      return NextResponse.json({ success: true, request: deleted, deleted: true });
    }

    const updated = await archivePurchaseRequest(id, actorName(session));
    return NextResponse.json({ success: true, request: updated, deleted: false });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'تعذر إزالة الطلب' },
      { status: 400 }
    );
  }
}
